const {
  manifest, registeredManifest, migrationSql, requiredTenantMigrations, validateTenantLedger, validateTenantMigrationManifest,
  SUPPORTED_TENANT_DOWNGRADE, COMPETENCY_TENANT_DOWNGRADE, FINANCIAL_TENANT_DOWNGRADE, OPERATIONAL_TENANT_DOWNGRADE, POPULATION_TENANT_DOWNGRADE, METADATA_TENANT_DOWNGRADE, IMPORT_TENANT_DOWNGRADE, EDITORIAL_TENANT_DOWNGRADE, CRITERIA_TENANT_DOWNGRADE, PQ1_TENANT_DOWNGRADE, PQ1_ACTIVATION_TENANT_DOWNGRADE, PQ1_DECISION_TENANT_DOWNGRADE, APPLICATION_TENANT_DOWNGRADE, APPLICATION_WORK_TENANT_DOWNGRADE, APPLICATION_DOCUMENT_TENANT_DOWNGRADE, DOCUMENT_TRANSPORT_TENANT_DOWNGRADE, DOCUMENT_WORKER_TENANT_DOWNGRADE
} = require('./tenantMigrationManifest');
const {
  aggregateTenantMigrationFailures, isTenantMigrationFailure, tenantMigrationFailure
} = require('./tenantMigrationErrors');
const {
  preflightTenant, preflightTenantClient, validateDatabaseContract
} = require('./tenantMigrationPreflight');
const { tenantSchemaFingerprint, tenantSchemaSnapshot } = require('./tenantSchemaFingerprint');

const TENANT_MIGRATION_LOCK = 43000001;
const TENANT_MIGRATION_OWNERSHIP = Object.freeze({
  '005_f9_execution_lineage': Object.freeze({
    alter: 'ALTER FUNCTION async_exec.guard_outbox_lineage_v1() OWNER TO c4g_tenant_owner',
    role: 'c4g_tenant_owner',
    functionIdentity: 'async_exec.guard_outbox_lineage_v1()'
  })
});

async function enforceMigrationOwnership(client, migrationId) {
  const contract = TENANT_MIGRATION_OWNERSHIP[migrationId];
  if (!contract) return;
  await client.query(contract.alter);
  await client.query(`SET LOCAL ROLE ${contract.role}`);
  const observed = (await client.query(`
    SELECT current_user AS selected_role,
           pg_catalog.pg_get_userbyid(p.proowner) AS owner_name,
           l.lanname AS language,
           p.prosecdef AS security_definer,
           COALESCE(pg_catalog.array_to_string(p.proconfig, ','), '') AS configuration
      FROM pg_catalog.pg_proc p
      JOIN pg_catalog.pg_language l ON l.oid = p.prolang
     WHERE p.oid = pg_catalog.to_regprocedure($1)`, [contract.functionIdentity])).rows[0];
  await client.query('RESET ROLE');
  if (!observed || observed.selected_role !== contract.role || observed.owner_name !== contract.role
      || observed.language !== 'plpgsql' || observed.security_definer !== false
      || observed.configuration !== 'search_path=pg_catalog, async_exec') {
    throw tenantMigrationFailure('TENANT_MIGRATION_OWNER_MISMATCH');
  }
}

function validInput(input) {
  return input && typeof input === 'object' && Object.getPrototypeOf(input) === Object.prototype
    && typeof input.tenantId === 'string' && input.tenantId.length > 0
    && typeof input.databaseGenerationId === 'string' && input.databaseGenerationId.length > 0
    && Number.isSafeInteger(input.expectedRevision) && input.expectedRevision > 0
    && typeof input.correlationId === 'string' && input.correlationId.length > 0
    && typeof input.idempotencyKey === 'string' && input.idempotencyKey.length > 0;
}

function sanitizedFailure(error, code = 'TENANT_MIGRATION_FAILED') {
  return isTenantMigrationFailure(error) ? error : tenantMigrationFailure(code);
}

async function boundedTask(factory, { timeoutMs, scheduler, timeoutCode, onLateSuccess = null }) {
  let expired = false;
  let timer;
  const work = Promise.resolve().then(factory);
  work.then(value => {
    if (expired && onLateSuccess) Promise.resolve().then(() => onLateSuccess(value)).catch(() => {});
  }, () => {});
  const deadline = new Promise((resolve, reject) => {
    timer = scheduler.setTimeout(() => {
      expired = true;
      reject(tenantMigrationFailure(timeoutCode));
    }, timeoutMs);
  });
  try { return await Promise.race([work, deadline]); }
  finally { scheduler.clearTimeout(timer); }
}

function createTenantMigrationRunner({
  pool,
  observationPublisher,
  entries = manifest,
  loadMigration = migrationSql,
  requiredBaseVersion = null,
  timeoutMs,
  scheduler,
  runPreflight = preflightTenant,
  runPreflightClient = preflightTenantClient,
  validateDatabase = validateDatabaseContract,
  fingerprintSchema = async client => tenantSchemaFingerprint(await tenantSchemaSnapshot(client))
}) {
  if (!pool || typeof pool.connect !== 'function' || !observationPublisher
      || typeof observationPublisher.publish !== 'function'
      || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1
      || !scheduler || typeof scheduler.setTimeout !== 'function' || typeof scheduler.clearTimeout !== 'function'
      || typeof runPreflight !== 'function' || typeof runPreflightClient !== 'function'
      || typeof validateDatabase !== 'function' || typeof fingerprintSchema !== 'function') {
    throw new TypeError('Tenant migration runner dependencies are invalid.');
  }
  validateTenantMigrationManifest(entries, loadMigration);
  const requirements = requiredTenantMigrations(entries, loadMigration);
  const knownEntries = entries === manifest ? registeredManifest : entries;

  async function publish(input, evidence) {
    try {
      await boundedTask(() => observationPublisher.publish({
        expectedRevision: input.expectedRevision,
        correlationId: input.correlationId,
        idempotencyKey: input.idempotencyKey,
        evidence
      }), { timeoutMs, scheduler, timeoutCode: 'CENTRAL_OBSERVATION_TIMEOUT' });
    } catch (error) {
      throw sanitizedFailure(error, 'CENTRAL_OBSERVATION_FAILED');
    }
  }

  async function reconcile(input, targetEntries = entries) {
    let evidence;
    try {
      evidence = await boundedTask(() => runPreflight(pool, {
        tenantId: input.tenantId,
        databaseGenerationId: input.databaseGenerationId
      }, targetEntries, { timeoutMs, loadMigration }), { timeoutMs, scheduler, timeoutCode: 'TENANT_POSTCHECK_TIMEOUT' });
    } catch (error) {
      if (isTenantMigrationFailure(error)) throw error;
      throw tenantMigrationFailure('RECONCILIATION_REQUIRED');
    }
    if (evidence.currentVersion !== targetEntries.at(-1).version) {
      throw tenantMigrationFailure('RECONCILIATION_REQUIRED');
    }
    await publish(input, evidence);
    return Object.freeze({ appliedVersions: Object.freeze([]), evidence, reconciled: true });
  }

    async function run(input, downgrade = false) {
      const downgradeContract=entries.at(-1).version===DOCUMENT_WORKER_TENANT_DOWNGRADE.fromVersion?DOCUMENT_WORKER_TENANT_DOWNGRADE:entries.at(-1).version===DOCUMENT_TRANSPORT_TENANT_DOWNGRADE.fromVersion?DOCUMENT_TRANSPORT_TENANT_DOWNGRADE:entries.at(-1).version===APPLICATION_DOCUMENT_TENANT_DOWNGRADE.fromVersion?APPLICATION_DOCUMENT_TENANT_DOWNGRADE:entries.at(-1).version===APPLICATION_WORK_TENANT_DOWNGRADE.fromVersion?APPLICATION_WORK_TENANT_DOWNGRADE:entries.at(-1).version===APPLICATION_TENANT_DOWNGRADE.fromVersion?APPLICATION_TENANT_DOWNGRADE:entries.at(-1).version===PQ1_DECISION_TENANT_DOWNGRADE.fromVersion?PQ1_DECISION_TENANT_DOWNGRADE:entries.at(-1).version===PQ1_ACTIVATION_TENANT_DOWNGRADE.fromVersion?PQ1_ACTIVATION_TENANT_DOWNGRADE:entries.at(-1).version===PQ1_TENANT_DOWNGRADE.fromVersion?PQ1_TENANT_DOWNGRADE:entries.at(-1).version===CRITERIA_TENANT_DOWNGRADE.fromVersion?CRITERIA_TENANT_DOWNGRADE:entries.at(-1).version===EDITORIAL_TENANT_DOWNGRADE.fromVersion?EDITORIAL_TENANT_DOWNGRADE:entries.at(-1).version===IMPORT_TENANT_DOWNGRADE.fromVersion?IMPORT_TENANT_DOWNGRADE:entries.at(-1).version===METADATA_TENANT_DOWNGRADE.fromVersion?METADATA_TENANT_DOWNGRADE:entries.at(-1).version===POPULATION_TENANT_DOWNGRADE.fromVersion?POPULATION_TENANT_DOWNGRADE:entries.at(-1).version===OPERATIONAL_TENANT_DOWNGRADE.fromVersion?OPERATIONAL_TENANT_DOWNGRADE:entries.at(-1).version===FINANCIAL_TENANT_DOWNGRADE.fromVersion?FINANCIAL_TENANT_DOWNGRADE:entries.at(-1).version===COMPETENCY_TENANT_DOWNGRADE.fromVersion?COMPETENCY_TENANT_DOWNGRADE:SUPPORTED_TENANT_DOWNGRADE;
      if (!validInput(input)) throw new TypeError('Tenant migration request is invalid.');
      if (downgrade && (input.targetVersion !== downgradeContract.targetVersion
          || entries.at(-1).version !== downgradeContract.fromVersion)) {
        throw new TypeError('Tenant downgrade is not supported.');
      }
      let targetEntries = downgrade ? Object.freeze(entries.slice(0, -1)) : entries;
      let client;
      let began = false;
      let commitAttempted = false;
      let stage = 'CONNECT';
      const appliedVersions = [];
      try {
        client = await boundedTask(() => pool.connect(), {
          timeoutMs, scheduler, timeoutCode: 'TENANT_MIGRATION_CONNECT_TIMEOUT',
          onLateSuccess: lateClient => { try { lateClient.release(); } catch { /* sanitized observer */ } }
        });
        stage = 'BEGIN';
        await client.query('BEGIN');
        began = true;
        await client.query("SELECT set_config('statement_timeout', $1, true)", [`${timeoutMs}ms`]);
        await client.query("SELECT set_config('lock_timeout', $1, true)", [`${timeoutMs}ms`]);
        const lock = await client.query('SELECT pg_try_advisory_xact_lock($1) AS acquired', [TENANT_MIGRATION_LOCK]);
        if (!lock.rows[0] || lock.rows[0].acquired !== true) throw tenantMigrationFailure('LOCK_CONFLICT');
        const presence = await client.query(`
          SELECT to_regclass('c4g_system.tenant_identity') IS NOT NULL AS marker_exists,
                 to_regclass('c4g_system.schema_migration') IS NOT NULL AS ledger_exists`);
        const markerExists = presence.rows[0] && presence.rows[0].marker_exists === true;
        const ledgerExists = presence.rows[0] && presence.rows[0].ledger_exists === true;
        if (markerExists !== ledgerExists) throw tenantMigrationFailure('TENANT_BASELINE_AMBIGUOUS');
        let pendingRequirements = requirements;
        if (markerExists) {
          stage = 'PREFLIGHT';
          const existing = await runPreflightClient(client, {
            tenantId: input.tenantId,
            databaseGenerationId: input.databaseGenerationId
          }, knownEntries, loadMigration);
          const ledgerRows = await client.query(`
            SELECT migration_id, ordinal, checksum_sha256, irreversible, resulting_fingerprint
              FROM c4g_system.schema_migration
             ORDER BY ordinal`);
          const { receiptManifest, failureReceiptManifest, assignedReviewManifest, applicationChatManifest, organizationStrategyManifest, applicationTaskDetailsManifest, documentDeletionManifest } = require('./tenantMigrationManifest');
          const observedEntries = (entries === manifest && [documentDeletionManifest, applicationTaskDetailsManifest, organizationStrategyManifest, applicationChatManifest, assignedReviewManifest, failureReceiptManifest, receiptManifest]
            .find(candidate => candidate.at(-1).version === existing.currentVersion)) || knownEntries;
          let ledger;
          try { ledger = validateTenantLedger(ledgerRows.rows, observedEntries, loadMigration); }
          catch { throw tenantMigrationFailure('TENANT_LEDGER_MISMATCH'); }
          if (existing.currentVersion !== ledger.currentVersion
              || existing.schemaFingerprint !== observedEntries[ledger.appliedVersions.length - 1]?.schemaFingerprint) {
            throw tenantMigrationFailure('TENANT_SCHEMA_FINGERPRINT_MISMATCH');
          }
          pendingRequirements = requirements.slice(ledger.appliedVersions.length);
          if (requiredBaseVersion && ![requiredBaseVersion,entries.at(-1).version].includes(existing.currentVersion)) {
            throw tenantMigrationFailure('TENANT_PACKAGE_BASELINE_MISMATCH');
          }
          // The ordinary runner never installs a registered package implicitly and
          // never publishes a lower target after that package has been applied.
          if (!downgrade && entries === manifest && ledger.appliedVersions.length > entries.length) {
            targetEntries = Object.freeze(observedEntries.slice(0,ledger.appliedVersions.length));
          }
          if (downgrade) {
            if (![downgradeContract.fromVersion, downgradeContract.targetVersion].includes(ledger.currentVersion)) {
              throw tenantMigrationFailure('TENANT_DOWNGRADE_BASELINE_MISMATCH');
            }
            pendingRequirements = [];
            if (ledger.currentVersion === downgradeContract.fromVersion) {
              stage = 'DOWNGRADE_SQL';
              const down = loadMigration(downgradeContract.fromVersion, 'down');
              if (down.checksum !== downgradeContract.downChecksum) {
                throw tenantMigrationFailure('MIGRATION_CHECKSUM_MISMATCH');
              }
              await client.query(down.sql);
              if (await fingerprintSchema(client) !== targetEntries.at(-1).schemaFingerprint) {
                throw tenantMigrationFailure('TENANT_SCHEMA_FINGERPRINT_MISMATCH');
              }
              stage = 'LEDGER';
              await client.query('SET LOCAL ROLE c4g_tenant_owner');
              // Owner-only exception under the migration lock, restored before preflight.
              // Runtime remains SELECT-only; any failure rolls back SQL, ledger and trigger state.
              await client.query('ALTER TABLE c4g_system.schema_migration DISABLE TRIGGER schema_migration_append_only');
              const removed = await client.query('DELETE FROM c4g_system.schema_migration WHERE migration_id=$1 AND ordinal=$2',
                [downgradeContract.fromVersion, entries.at(-1).ordinal]);
              if (removed.rowCount !== 1) throw tenantMigrationFailure('TENANT_LEDGER_MISMATCH');
              await client.query('ALTER TABLE c4g_system.schema_migration ENABLE TRIGGER schema_migration_append_only');
              await client.query('RESET ROLE');
              appliedVersions.push(downgradeContract.fromVersion);
            }
          }
        } else {
          if (requiredBaseVersion) throw tenantMigrationFailure('TENANT_PACKAGE_BASELINE_MISMATCH');
          if (downgrade) throw tenantMigrationFailure('TENANT_DOWNGRADE_BASELINE_MISMATCH');
          stage = 'DATABASE_CONTRACT';
          await validateDatabase(client);
        }
        for (const requirement of pendingRequirements) {
            stage = 'MIGRATION_SQL';
            const migration = loadMigration(requirement.migrationId, 'up');
            if (migration.checksum !== requirement.checksum) {
              throw tenantMigrationFailure('MIGRATION_CHECKSUM_MISMATCH');
            }
            const controlOwned = requirement.ordinal <= 1;
            if (controlOwned) await client.query('SET LOCAL ROLE c4g_tenant_owner');
            await client.query(migration.sql);
            if (controlOwned) await client.query('RESET ROLE');
            await enforceMigrationOwnership(client, requirement.migrationId);
            if (requirement.ordinal === 0) {
              stage = 'MARKER';
              await client.query(`
                INSERT INTO c4g_system.tenant_identity
                  (product_code, database_role, marker_format_version, tenant_id,
                   database_generation_id, identity_revision)
                VALUES ('C4G', 'TENANT', 1, $1::uuid, $2::uuid, 1)`,
              [input.tenantId, input.databaseGenerationId]);
            }
            const fingerprint = await fingerprintSchema(client);
            if (fingerprint !== requirement.resultingFingerprint) {
              throw tenantMigrationFailure('TENANT_SCHEMA_FINGERPRINT_MISMATCH');
            }
            stage = 'LEDGER';
            await client.query(`
              INSERT INTO c4g_system.schema_migration
                (migration_id, ordinal, checksum_sha256, irreversible, resulting_fingerprint)
              VALUES ($1, $2, $3, $4, $5)`, [
              requirement.migrationId, requirement.ordinal, requirement.checksum,
              requirement.irreversible, requirement.resultingFingerprint
            ]);
            appliedVersions.push(requirement.migrationId);
        }
        stage = 'PREFLIGHT';
        const finalEvidence = await runPreflightClient(client, {
          tenantId: input.tenantId,
          databaseGenerationId: input.databaseGenerationId
        }, targetEntries, loadMigration);
        if (finalEvidence.currentVersion !== targetEntries.at(-1).version) {
          throw tenantMigrationFailure('TENANT_UPGRADE_INCOMPLETE');
        }
        stage = 'COMMIT';
        commitAttempted = true;
        await client.query('COMMIT');
        began = false;
      } catch (error) {
        const primary = sanitizedFailure(error, `TENANT_MIGRATION_${stage}_FAILED`);
        const cleanupFailures = [];
        if (began && client) {
          try { await client.query('ROLLBACK'); }
          catch { cleanupFailures.push(tenantMigrationFailure('TENANT_MIGRATION_ROLLBACK_FAILED')); }
        }
        if (client) {
          try { client.release(cleanupFailures[0]); }
          catch { cleanupFailures.push(tenantMigrationFailure('TENANT_MIGRATION_CLIENT_CLEANUP_FAILED')); }
          client = null;
        }
        if (cleanupFailures.length > 0) {
          throw aggregateTenantMigrationFailures(primary, cleanupFailures);
        }
        if (commitAttempted) return reconcile(input, targetEntries);
        throw primary;
      }
      try { client.release(); }
      catch { throw tenantMigrationFailure('TENANT_MIGRATION_CLIENT_CLEANUP_FAILED'); }
      client = null;
      let evidence;
      try {
        evidence = await boundedTask(() => runPreflight(pool, {
          tenantId: input.tenantId,
          databaseGenerationId: input.databaseGenerationId
        }, targetEntries, { timeoutMs, loadMigration }), { timeoutMs, scheduler, timeoutCode: 'TENANT_POSTCHECK_TIMEOUT' });
      } catch (error) {
        if (isTenantMigrationFailure(error)) throw error;
        throw tenantMigrationFailure('POSTCHECK_FAILED');
      }
      if (evidence.currentVersion !== targetEntries.at(-1).version) {
        throw tenantMigrationFailure('TENANT_UPGRADE_INCOMPLETE');
      }
      await publish(input, evidence);
      return Object.freeze({
        appliedVersions: Object.freeze(downgrade ? [] : [...appliedVersions]),
        ...(downgrade ? { revertedVersions: Object.freeze([...appliedVersions]) } : {}),
        evidence,
        reconciled: false
      });
    }
  return Object.freeze({ migrate: input => run(input), downgrade: input => run(input, true) });
}

function createRegisteredTenantMigrationRunner(options) {
  const pkg = require('./opportunityV2MigrationPackage');
  pkg.assertPackageId(options?.packageId);
  const allowed = ['packageId','pool','observationPublisher','timeoutMs','scheduler'];
  if (Object.keys(options).some(key => !allowed.includes(key))) throw new TypeError('Registered tenant runner dependencies are invalid.');
  const {pool,observationPublisher,timeoutMs,scheduler} = options;
  return createTenantMigrationRunner({pool,observationPublisher,timeoutMs,scheduler,
    entries:registeredManifest,loadMigration:migrationSql,requiredBaseVersion:pkg.TENANT_BASELINE});
}

function createF12ReceiptTenantMigrationRunner({ pool, observationPublisher, timeoutMs, scheduler }) {
  const { receiptManifest } = require('./tenantMigrationManifest');
  return createTenantMigrationRunner({ pool, observationPublisher, timeoutMs, scheduler,
    entries: receiptManifest, requiredBaseVersion: manifest.at(-1).version });
}

function createF12FailureReceiptTenantMigrationRunner({ pool, observationPublisher, timeoutMs, scheduler }) {
  const { receiptManifest, failureReceiptManifest } = require('./tenantMigrationManifest');
  return createTenantMigrationRunner({ pool, observationPublisher, timeoutMs, scheduler,
    entries: failureReceiptManifest, requiredBaseVersion: receiptManifest.at(-1).version });
}

function createAssignedReviewMigrationRunner({pool,observationPublisher,timeoutMs,scheduler}) {
  const {assignedReviewManifest}=require('./tenantMigrationManifest');
  return createTenantMigrationRunner({pool,observationPublisher,timeoutMs,scheduler,
    entries:assignedReviewManifest,requiredBaseVersion:registeredManifest.at(-1).version});
}

function createApplicationChatMigrationRunner({pool,observationPublisher,timeoutMs,scheduler}) {
  const {applicationChatManifest,assignedReviewManifest}=require('./tenantMigrationManifest');
  return createTenantMigrationRunner({pool,observationPublisher,timeoutMs,scheduler,
    entries:applicationChatManifest,requiredBaseVersion:assignedReviewManifest.at(-1).version});
}

function createOrganizationStrategyMigrationRunner({pool,observationPublisher,timeoutMs,scheduler}) {
  const {organizationStrategyManifest,APPLICATION_CHAT_SCHEMA_VERSION}=require('./tenantMigrationManifest');
  return createTenantMigrationRunner({pool,observationPublisher,timeoutMs,scheduler,
    entries:organizationStrategyManifest,requiredBaseVersion:APPLICATION_CHAT_SCHEMA_VERSION});
}

function createApplicationTaskDetailsMigrationRunner({pool,observationPublisher,timeoutMs,scheduler}) {
  const {applicationTaskDetailsManifest,ORGANIZATION_STRATEGY_SCHEMA_VERSION}=require('./tenantMigrationManifest');
  return createTenantMigrationRunner({pool,observationPublisher,timeoutMs,scheduler,
    entries:applicationTaskDetailsManifest,requiredBaseVersion:ORGANIZATION_STRATEGY_SCHEMA_VERSION});
}

function createDocumentDeletionMigrationRunner({pool,observationPublisher,timeoutMs,scheduler}) {
  const {documentDeletionManifest,APPLICATION_TASK_DETAILS_SCHEMA_VERSION}=require('./tenantMigrationManifest');
  return createTenantMigrationRunner({pool,observationPublisher,timeoutMs,scheduler,
    entries:documentDeletionManifest,requiredBaseVersion:APPLICATION_TASK_DETAILS_SCHEMA_VERSION});
}

module.exports = { TENANT_MIGRATION_LOCK, TENANT_MIGRATION_OWNERSHIP, boundedTask, createTenantMigrationRunner,
  createRegisteredTenantMigrationRunner, createF12ReceiptTenantMigrationRunner, createF12FailureReceiptTenantMigrationRunner, createAssignedReviewMigrationRunner,
  createApplicationChatMigrationRunner, createOrganizationStrategyMigrationRunner, createApplicationTaskDetailsMigrationRunner, createDocumentDeletionMigrationRunner };
