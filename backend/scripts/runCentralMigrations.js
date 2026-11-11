const {
  manifest, registeredManifest, writerManifest, reconciliationManifest, prearchiveManifest, knownManifest, catalogReadManifest,
  migrationRecordMatches, migrationSql, requiredCentralMigrations
} = require("../src/security/centralMigrationManifest");

async function assertCentralMarker(client) {
  const marker = await client.query(
    `SELECT to_regclass($1) IS NOT NULL AS marker_exists`,
    ["public.c4g_database_identity"]
  );
  if (!marker.rows[0] || marker.rows[0].marker_exists !== true) throw new Error("Central database identity marker is missing.");
  const identity = await client.query(
    `SELECT EXISTS (
       SELECT 1 FROM public.c4g_database_identity
        WHERE product_code = $1 AND database_role = $2
     ) AS matches`,
    ["C4G", "CENTRAL"]
  );
  if (!identity.rows[0] || identity.rows[0].matches !== true) throw new Error("Database is not identified as C4G CENTRAL.");
}

async function ensureLedger(client) {
  await client.query(`CREATE TABLE IF NOT EXISTS public.c4g_schema_migration (
    version TEXT PRIMARY KEY,
    checksum_sha256 TEXT NOT NULL,
    irreversible BOOLEAN NOT NULL,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);
}

// Every pending migration runs in one transaction, so no wait may be unbounded: a busy migration lock is
// refused at once and any other lock wait gives up after this long.
const MIGRATION_LOCK = 42420002;
const LOCK_TIMEOUT_MS = 30000;

function migrationFailure(code, message) {
  return Object.assign(new Error(message), { code });
}

// A migration may SET ROLE for its own statements but must RESET ROLE: otherwise every later migration
// in this transaction would silently run as the wrong role.
async function assertSessionRoleRestored(client, version) {
  const { rows } = await client.query("SELECT current_user = session_user AS plain");
  if (rows[0]?.plain !== true) {
    throw migrationFailure("MIGRATION_ROLE_NOT_RESET", `Migration ${version} left the session role changed; the transaction was refused.`);
  }
}

async function inTransaction(pool, operation) {
  const client = await pool.connect();
  let broken;
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('lock_timeout', $1, true)", [`${LOCK_TIMEOUT_MS}ms`]);
    const lock = await client.query("SELECT pg_try_advisory_xact_lock($1) AS acquired", [MIGRATION_LOCK]);
    if (lock.rows[0]?.acquired !== true) throw migrationFailure("MIGRATION_IN_PROGRESS", "Another central migration is in progress.");
    await assertCentralMarker(client);
    await ensureLedger(client);
    const result = await operation(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    // A connection whose ROLLBACK failed is in an unknown state: destroy it instead of pooling it.
    try { await client.query("ROLLBACK"); } catch (rollbackError) { broken = rollbackError; }
    throw error;
  } finally {
    client.release(broken);
  }
}

function requirementsFor(entries, loadMigration) {
  return entries.map(entry => { const migration=loadMigration(entry.version,"up");return {version:entry.version,checksum:migration.checksum,acceptedChecksums:migration.acceptedChecksums||[migration.checksum],irreversible:entry.irreversible}; });
}

function centralLedgerBranch(rows) {
  const { receiptManifest, replayCapacityManifest, failureCapacityManifest } = require('../src/security/centralMigrationManifest');
  if (rows.some(row => row.version === failureCapacityManifest.at(-1).version)) return failureCapacityManifest;
  if (rows.some(row => row.version === replayCapacityManifest.at(-1).version)) return replayCapacityManifest;
  return rows.some(row => row.version === receiptManifest.at(-1).version) ? receiptManifest : knownManifest;
}

function validateAppliedMigrationLedger(rows, refusal = "migration operation refused", entries = centralLedgerBranch(rows), expected = requiredCentralMigrations(entries)) {
  const records = new Map(rows.map(row => [row.version, row]));
  const unexpected = rows.find(row => !entries.some(item => item.version === row.version));
  if (unexpected) throw new Error(`Unknown applied migration ${unexpected.version}; ${refusal}.`);

  let missingPredecessor = false;
  for (const requirement of expected) {
    const record = records.get(requirement.version);
    if (!record) {
      missingPredecessor = true;
      continue;
    }
    if (missingPredecessor) {
      throw new Error(`Applied migration sequence has a gap before ${requirement.version}; ${refusal}.`);
    }
    if (!migrationRecordMatches(record, requirement)) {
      throw new Error(`Applied migration metadata differs for ${requirement.version}; ${refusal}.`);
    }
  }
  return records;
}

async function applyCentralMigrationsWithManifest(pool, entries, loadMigration, {
  afterSql = null, beforeBaseline = null, ledgerEntries = entries, requiredBaseVersion = null
} = {}) {
  return inTransaction(pool, async client => {
    const ledger = await client.query(
      `SELECT version, checksum_sha256, irreversible
         FROM public.c4g_schema_migration`
    );
    if (entries === manifest && ledgerEntries === knownManifest) ledgerEntries = centralLedgerBranch(ledger.rows);
    const expected=requirementsFor(ledgerEntries,loadMigration);const records = validateAppliedMigrationLedger(ledger.rows,"migration operation refused",ledgerEntries,expected);
    if (requiredBaseVersion) {
      const latest = ledgerEntries.filter(entry => records.has(entry.version)).at(-1)?.version;
      if (![requiredBaseVersion, entries.at(-1).version].includes(latest)) throw new Error('Registered migration package baseline mismatch.');
      if (beforeBaseline) await beforeBaseline(client, latest);
      await require('../src/security/centralSchemaManifest').assertCentralSchema(client,latest);
    }
    const applied = [];
    for (const entry of entries) {
      const migration = loadMigration(entry.version, "up");
      if (records.has(entry.version)) continue;
      if (entry.requiresPreflightVersion) {
        const latest = entries.filter(item => records.has(item.version) || applied.includes(item.version)).at(-1);
        if (latest?.version !== entry.requiresPreflightVersion) throw new Error('Central correction predecessor mismatch.');
        await require('../src/security/centralSchemaManifest').assertCentralSchema(client,entry.requiresPreflightVersion);
        if (entry.requiresCatalogSecurityFingerprint) await require('../src/security/catalogSecurityManifest').assertCatalogSecurity(client,entry.requiresCatalogSecurityFingerprint);
      }
      await client.query(migration.sql);
      await assertSessionRoleRestored(client, entry.version);
      if (afterSql) await afterSql({ client, entry });
      if (entry.catalogSecurityFingerprint) {
        await require('../src/security/centralSchemaManifest').assertCentralSchema(client,entry.version);
      }
      await client.query(
        `INSERT INTO public.c4g_schema_migration(version, checksum_sha256, irreversible)
         VALUES ($1, $2, $3)`,
        [entry.version, migration.checksum, entry.irreversible]
      );
      applied.push(entry.version);
    }
    return applied;
  });
}

async function applyCentralMigrations(pool) { return applyCentralMigrationsWithManifest(pool,manifest,migrationSql,{ledgerEntries:knownManifest}); }

async function applyRegisteredCentralPackage(pool, packageId) {
  const pkg = require('../src/security/opportunityV2MigrationPackage');
  pkg.assertPackageId(packageId);
  return applyCentralMigrationsWithManifest(pool,registeredManifest,migrationSql,{requiredBaseVersion:pkg.CENTRAL_BASELINE});
}

async function applyRegisteredEuWriterPackage(pool, packageId) {
  const pkg = require('../src/security/opportunityEuWriterMigrationPackage');
  pkg.assertPackageId(packageId);
  return applyCentralMigrationsWithManifest(pool,writerManifest,migrationSql,{requiredBaseVersion:pkg.CENTRAL_BASELINE,ledgerEntries:knownManifest});
}

async function applyRegisteredEuReconciliationPackage(pool,packageId){
  const pkg=require('../src/security/opportunityEuReconciliationMigrationPackage');
  pkg.assertPackageId(packageId);
  return applyCentralMigrationsWithManifest(pool,reconciliationManifest,migrationSql,
    {requiredBaseVersion:pkg.CENTRAL_BASELINE,ledgerEntries:knownManifest});
}

async function applyRegisteredEuLegacyPrearchivePackage(pool, packageId) {
  const pkg = require('../src/security/opportunityEuLegacyPrearchiveMigrationPackage');
  pkg.assertPackageId(packageId);
  return applyCentralMigrationsWithManifest(pool,prearchiveManifest,migrationSql,
    {requiredBaseVersion:pkg.CENTRAL_BASELINE,ledgerEntries:knownManifest});
}

function resolveRollbackTarget(target) {
  const entry = manifest.find(item => item.version === target || item.version.startsWith(`${target}_`));
  if (!entry) throw new Error("Rollback target is not an allowlisted central migration.");
  if (entry.irreversible) throw new Error(`${entry.version} is irreversible.`);
  return entry;
}

function resolveRollbackTargetFrom(entries,target) {const entry=entries.find(item=>item.version===target||item.version.startsWith(`${target}_`));if(!entry)throw new Error("Rollback target is not an allowlisted central migration.");if(entry.irreversible)throw new Error(`${entry.version} is irreversible.`);return entry;}

async function rollbackCentralMigrationWithManifest(pool, target, entries, loadMigration) {
  const entry = resolveRollbackTargetFrom(entries,target);
  const migration = loadMigration(entry.version, "down");
  return inTransaction(pool, async client => {
    const expected = requirementsFor(entries,loadMigration);
    const applied = await client.query(
      `SELECT version, checksum_sha256, irreversible
         FROM public.c4g_schema_migration`
    );
    const records = validateAppliedMigrationLedger(applied.rows, "rollback refused",entries,expected);
    const targetIndex = entries.findIndex(item => item.version === entry.version);
    for (const [index, requirement] of expected.entries()) {
      if (index <= targetIndex && !records.has(requirement.version)) {
        throw new Error(`Required migration ${requirement.version} is not applied; rollback refused.`);
      }
    }
    const appliedVersions = entries.filter(item => applied.rows.some(row => row.version === item.version));
    const latest = appliedVersions.at(-1);
    if (!latest || latest.version !== entry.version) {
      throw new Error("Only the latest applied reversible central migration can be rolled back.");
    }
    await client.query(migration.sql);
    await assertSessionRoleRestored(client, migration.entry.version);
    await client.query("DELETE FROM public.c4g_schema_migration WHERE version = $1", [migration.entry.version]);
    return migration.entry.version;
  });
}

async function rollbackCentralMigration(pool,target){return rollbackCentralMigrationWithManifest(pool,target,manifest,migrationSql);}

async function rollbackF2Sessions(pool, target = "001_f2_oidc_sessions") {
  if (target !== "001" && target !== "001_f2_oidc_sessions") throw new Error("Only rollback of 001_f2_oidc_sessions is permitted.");
  return rollbackCentralMigration(pool, target);
}

async function status(pool) {
  const client = await pool.connect();
  try {
    await assertCentralMarker(client);
    await ensureLedger(client);
    const result = await client.query("SELECT version, checksum_sha256, irreversible, applied_at FROM public.c4g_schema_migration ORDER BY version");
    validateAppliedMigrationLedger(result.rows, "status refused");
    return result.rows;
  } finally {
    client.release();
  }
}

async function main() {
  const action = process.argv[2];
  const target = process.argv[3];
  if (!['up', 'down', 'status'].includes(action) || (action === "down" && !target)) {
    throw new Error("Usage: runCentralMigrations.js up|down <allowlisted-version>|status");
  }
  // Migrations may run long statements; the runtime backstops apply only when set explicitly.
  process.env.CENTRAL_DB_STATEMENT_TIMEOUT_MS ??= '0';
  process.env.CENTRAL_DB_IDLE_IN_TRANSACTION_TIMEOUT_MS ??= '0';
  const pool = require("../src/config/centralDb");
  try {
    if (action === "up") await applyCentralMigrations(pool);
    else if (action === "down") await rollbackCentralMigration(pool, target);
    else await status(pool);
    console.log(`Central migration action completed: ${action}.`);
  } finally {
    await pool.end();
  }
}

if (require.main === module) {
  main().catch(error => {
    console.error(`Central migration action failed: ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = {
  applyCentralMigrations, applyRegisteredCentralPackage, applyRegisteredEuWriterPackage,
  applyRegisteredEuReconciliationPackage, applyRegisteredEuLegacyPrearchivePackage,
  applyCentralMigrationsWithManifest, assertCentralMarker, manifest, migrationSql, resolveRollbackTarget,
  rollbackCentralMigration, rollbackCentralMigrationWithManifest, rollbackF2Sessions, status, validateAppliedMigrationLedger
};

// Explicit package operation; never called by startup or the default migrator.
async function applyRegisteredCatalogReadPackage(pool,packageId){
 if(packageId!=='catalog-read-v1')throw Error('CATALOG_READ_PACKAGE_NOT_REGISTERED');
 return applyCentralMigrationsWithManifest(pool,catalogReadManifest,migrationSql,{requiredBaseVersion:prearchiveManifest.at(-1).version,ledgerEntries:knownManifest});
}
module.exports.applyRegisteredCatalogReadPackage=applyRegisteredCatalogReadPackage;

// Explicit opt-in only; startup and default `up` never install this package.
async function applyRegisteredCentralImportPackage(pool,packageId){
 const {PACKAGE_ID,CENTRAL_BASELINE}=require('../src/security/centralImportMigrationPackage');
 if(packageId!==PACKAGE_ID)throw Error('CENTRAL_IMPORT_PACKAGE_NOT_REGISTERED');
 return applyCentralMigrationsWithManifest(pool,require('../src/security/centralMigrationManifest').centralImportManifest,migrationSql,{requiredBaseVersion:CENTRAL_BASELINE,ledgerEntries:knownManifest});
}
module.exports.applyRegisteredCentralImportPackage=applyRegisteredCentralImportPackage;

// Billing PDF installation is explicit; existing package entrypoints never apply it.
async function applyRegisteredBillingPdfsPackage(pool,packageId){
 const {PACKAGE_ID,CENTRAL_BASELINE}=require('../src/security/billingPdfMigrationPackage');
 if(packageId!==PACKAGE_ID)throw Error('BILLING_PDF_PACKAGE_NOT_REGISTERED');
 return applyCentralMigrationsWithManifest(pool,knownManifest,migrationSql,{requiredBaseVersion:CENTRAL_BASELINE,ledgerEntries:knownManifest});
}
module.exports.applyRegisteredBillingPdfsPackage=applyRegisteredBillingPdfsPackage;

async function applyRegisteredF12ReceiptPackage(pool) {
  const { receiptManifest } = require('../src/security/centralMigrationManifest');
  return applyCentralMigrationsWithManifest(pool, receiptManifest, migrationSql, {
    requiredBaseVersion: manifest.at(-1).version
  });
}
module.exports.applyRegisteredF12ReceiptPackage = applyRegisteredF12ReceiptPackage;

async function applyRegisteredF12ReplayCapacityPackage(pool) {
  const { receiptManifest, replayCapacityManifest } = require('../src/security/centralMigrationManifest');
  const baseline = receiptManifest.at(-1).version;
  return applyCentralMigrationsWithManifest(pool, replayCapacityManifest, migrationSql, {
    requiredBaseVersion: baseline,
    async beforeBaseline(client, version) {
      if (version !== baseline) return;
      // The earlier worker provisioning added grants on authority-protected
      // objects. Reinstall the same closed profile as part of 037.
      const { rows } = await client.query("SELECT 1 FROM pg_roles WHERE rolname='c4g_f12_worker_directory'");
      if (rows.length) {
        await client.query(`REVOKE USAGE ON SCHEMA public,async_exec FROM c4g_f12_worker_directory;
          REVOKE SELECT ON public.organization,public.tenant,public.organization_provisioning,
            public.tenant_workload_binding,public.tenant_workload_connection_version,public.organization_connection_version,
            public.tenant_database_generation,public.tenant_schema_state,public.tenant_health_observation FROM c4g_f12_worker_directory;
          REVOKE SELECT,INSERT ON async_exec.execution,async_exec.dead_letter FROM c4g_f12_worker_directory`);
      }
    }
  });
}
module.exports.applyRegisteredF12ReplayCapacityPackage = applyRegisteredF12ReplayCapacityPackage;

async function applyRegisteredF12FailureCapacityPackage(pool) {
  const { replayCapacityManifest, failureCapacityManifest } = require('../src/security/centralMigrationManifest');
  return applyCentralMigrationsWithManifest(pool, failureCapacityManifest, migrationSql, {
    requiredBaseVersion: replayCapacityManifest.at(-1).version
  });
}
module.exports.applyRegisteredF12FailureCapacityPackage = applyRegisteredF12FailureCapacityPackage;
