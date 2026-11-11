'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { Pool } = require('../../../backend/node_modules/pg');
const { manifest, migrationSql } = require('../../../backend/src/security/tenantMigrationManifest');
const { createTenantMigrationRunner } = require('../../../backend/src/security/tenantMigrationRunner');
const {
  tenantSchemaFingerprint,
  tenantSchemaSnapshot
} = require('../../../backend/src/security/tenantSchemaFingerprint');

const PROOF = 'C4G_MIGRATION_005_OWNERSHIP_GATE_V1';
const CANONICAL_BASELINE = Object.freeze(manifest.filter(entry => entry.ordinal <= 30));
const CANONICAL_OWNER = 'c4g_tenant_owner';
const HISTORICAL_OWNER = 'c4g_f12_admin';
const ADMINS = Object.freeze(['c4g_m005_admin_a', 'c4g_m005_admin_b']);
const DATABASES = Object.freeze([
  'm005_fresh_a', 'm005_fresh_b', 'm005_from_004', 'm005_from_003',
  'm005_rollback', 'm005_tampered', 'm005_historical_005', 'm005_historical_030'
]);
const INFRASTRUCTURE_ROLES = Object.freeze([
  'c4g_tenant_owner', 'c4g_tenant_migrator', 'c4g_tenant_runtime', 'c4g_import_worker_runtime'
]);
const HISTORICAL_FINGERPRINTS = Object.freeze({
  '005_f9_execution_lineage': 'cd001ae58e1e982233f64976811ec9b629293ae883045b40e0e491ee3e824fed',
  '006_f13_p1_organizational_scope': '29a98501da147ab979043e156e290c7f625dcc442b6da593c1c6ff135bbea70f',
  '007_f13_profile_catalogs_and_policies': '17df0837daf146752e94fc7c870e58b653e23dd1051ea31b697e37d1c477b909',
  '008_f13_profile_authoring_and_assertions': '7ee1e9277e39c0016985061fe0ddcd03980474680f9855ee50fc2aebe59f4b8f',
  '009_f13_competencies_and_experience': '5a23e5b95300e9af471d90ac4e1212c5e88c11b3735fa88445e7b6aae010f1f1',
  '010_f13_financial_capacity': '876e01b28fb3617b464a4a85c8e8cc5a1e4f405e7e8678e07f1d0ddb12820eac',
  '011_f13_operational_capacity': '884396f0858205d0c3098dc5b44fcc366664ef0af4238e69628c2e57cdb453ff',
  '012_f13_territories_and_populations': '0558700553db2170ee60565b92339f5556f603d4108c9273d476b960cb1460c3',
  '014_f4_runtime_metadata_access': '039997acfeb75dd7540ebaad805ed9a18aec4cdc3418bf155c205c1cad87b1b3',
  '015_f12_opportunity_xlsx_import': '8c96af15c713ba36658d462e348ff3b69324042cd163bf426bb9b55353bec5ac',
  '016_f13_editorial_baseline_publication': 'bc47c3c859f9790136b70dc40d1159978f2f30ce80ffb124ec6522b546a6ea5a',
  '017_opportunity_evidenced_criteria': 'e72833f1a24a515dccd5cedf306408cc12098f6531f06eb50cb1c8ab7411376f',
  '018_f13_pq1_publication': '77b31fd6d07065e3798df1e285a1a39226778d06eaa21c260d90690d763ec9af',
  '019_f13_pq1_activation': 'addaa7024066f87b767415bc0880b3e0f4473839f9c3aa457b1ebc4908eeb856',
  '020_f14_pq1_decisions': 'dd3b09221b0347b70377919aa7693dbf83390b63b0e68b303fe892f46de9ffea',
  '021_application_first_slice': 'a900cec04d3d7ddc95eb4a7c7cc9dde61488c76bb50a422d693fb700538a8f44',
  '022_application_team_tasks': 'd1ab7a44ecd5efbfabf288c1173a4c5abc94c3bec547e407264453b289a01952',
  '023_application_documents_review': 'de499ab0fa8a12336d81712642364edd6752df244581892ad6f27f7d2ebd78bd',
  '024_application_central_origin': '92ce67929c3b5066df6562b3805e955e59d3db3f489aae76b05a1baf26f2f7ed',
  '025_organization_directory': 'a7ddfc8d176291da7c75750f420a08f55114d4ac59c4a5ebc92a1b02fb623ea8',
  '026_personal_profile': '26602fdb2f7e0214ac2896fe36384eaa40d0dcd27b4b83c4bf54b166aae62485',
  '027_application_lifecycle': 'e7eea047318abb3cdda037ea4e7d90454735480cea56d62bc670dcf8e3d296a5',
  '028_application_partners': '1ccdeb2c22e66d4ea673f604ff4b5b28d634bfb7c85b6611bb9a63758688ab29',
  '029_application_alerts': '71bdf9cb894a3c1fe61cce83815fdf3314adbaf6e60d4b167715c793aa7700c7',
  '030_organization_notices': 'e39a77c76efb85ce9e19fe17f2e92057739681ded45601cb3e2c1374fca6a623'
});

function target() {
  if (process.env.M005_OWNERSHIP_GATE_PROOF !== PROOF) throw new Error('Migration 005 ownership proof is required.');
  const url = new URL(process.env.M005_OWNERSHIP_GATE_URL);
  if (url.protocol !== 'postgresql:' || url.hostname !== '127.0.0.1'
      || !/^56\d{3}$/.test(url.port) || url.pathname !== '/postgres') {
    throw new Error('Migration 005 ownership target is not isolated.');
  }
  const evidencePath = process.env.M005_OWNERSHIP_EVIDENCE;
  if (!evidencePath || !path.isAbsolute(evidencePath)) throw new Error('External evidence path is required.');
  return Object.freeze({ evidencePath, imageDigest: process.env.M005_IMAGE_DIGEST || null, url });
}

function databaseUrl(source, database, user = source.username) {
  const url = new URL(source.toString());
  url.username = user;
  url.pathname = `/${database}`;
  return url.toString();
}

function request(label, identity = {}) {
  return Object.freeze({
    tenantId: identity.tenantId || crypto.randomUUID(),
    databaseGenerationId: identity.databaseGenerationId || crypto.randomUUID(),
    expectedRevision: 1,
    correlationId: `m005-${label}-${crypto.randomUUID()}`,
    idempotencyKey: `m005-${label}-${crypto.randomUUID()}`
  });
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function sectionHashes(snapshot) {
  return Object.freeze(Object.fromEntries(Object.entries(snapshot).map(([name, value]) => [
    name,
    Object.freeze({ count: Array.isArray(value) ? value.length : 1, hash: sha256(JSON.stringify(value)) })
  ])));
}

function firstDifference(left, right) {
  for (const section of [...new Set([...Object.keys(left), ...Object.keys(right)])].sort()) {
    const a = left[section];
    const b = right[section];
    if (JSON.stringify(a) === JSON.stringify(b)) continue;
    const length = Math.max(Array.isArray(a) ? a.length : 1, Array.isArray(b) ? b.length : 1);
    for (let index = 0; index < length; index += 1) {
      const av = Array.isArray(a) ? a[index] : a;
      const bv = Array.isArray(b) ? b[index] : b;
      if (JSON.stringify(av) !== JSON.stringify(bv)) {
        return Object.freeze({ section, index, left: av ?? null, right: bv ?? null });
      }
    }
  }
  return null;
}

async function createLogin(admin, role, password) {
  await admin.query(`DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='${role}') THEN
    CREATE ROLE ${role} LOGIN SUPERUSER NOINHERIT;
    END IF; END $$`);
  const sql = (await admin.query(
    "SELECT format('ALTER ROLE %I PASSWORD %L', $1::text, $2::text) AS sql",
    [role, password]
  )).rows[0].sql;
  await admin.query(sql);
}

async function createInfrastructure(admin, source) {
  for (const role of INFRASTRUCTURE_ROLES) {
    await admin.query(`DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='${role}') THEN
      CREATE ROLE ${role} NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
      END IF; END $$`);
  }
  await admin.query('GRANT c4g_tenant_owner TO c4g_tenant_migrator');
  for (const role of ADMINS) await createLogin(admin, role, source.password);
  for (const database of DATABASES) {
    await admin.query(`CREATE DATABASE ${database} ENCODING 'UTF8' LOCALE_PROVIDER icu ICU_LOCALE 'und' TEMPLATE template0`);
    await admin.query(`ALTER DATABASE ${database} SET timezone TO 'UTC'`);
    await admin.query(`GRANT CONNECT,CREATE ON DATABASE ${database} TO c4g_tenant_owner`);
    await admin.query(`GRANT CONNECT ON DATABASE ${database} TO c4g_tenant_migrator,c4g_tenant_runtime`);
    const pool = new Pool({ connectionString: databaseUrl(source, database), max: 1 });
    try {
      await pool.query('REVOKE ALL ON SCHEMA public FROM PUBLIC');
      await pool.query(`REVOKE CONNECT,TEMP ON DATABASE ${database} FROM PUBLIC`);
      await pool.query(`ALTER ROLE c4g_tenant_runtime IN DATABASE ${database} SET search_path TO pg_catalog,c4g_app`);
    } finally { await pool.end(); }
  }
}

async function environment(pool, login, imageDigest) {
  const database = (await pool.query(`SELECT session_user,current_user,current_database() AS database,
    current_setting('server_version') AS server_version,current_setting('server_version_num') AS server_version_num,
    current_setting('TimeZone') AS timezone,current_setting('server_encoding') AS server_encoding,
    d.datlocprovider AS locale_provider,COALESCE(d.datlocale,'') AS icu_locale,
    COALESCE(d.datcollversion,'') AS collation_version
    FROM pg_database d WHERE d.datname=current_database()`)).rows[0];
  assert.equal(database.session_user, login);
  return Object.freeze({
    database,
    extensions: (await pool.query('SELECT extname,extversion FROM pg_extension ORDER BY extname')).rows,
    imageDigest,
    roles: (await pool.query(`SELECT rolname,rolcanlogin,rolinherit,rolsuper,rolcreatedb,rolcreaterole,
      rolreplication,rolbypassrls FROM pg_roles WHERE rolname=ANY($1::text[]) ORDER BY rolname`,
    [[...INFRASTRUCTURE_ROLES, ...ADMINS, HISTORICAL_OWNER]])).rows
  });
}

function createRunner(pool, entries, captures) {
  return createTenantMigrationRunner({
    pool,
    entries,
    observationPublisher: { async publish() {} },
    timeoutMs: 30000,
    scheduler: { setTimeout, clearTimeout },
    fingerprintSchema: async client => {
      const ledgerCount = Number((await client.query(
        "SELECT count(*)::int AS count FROM c4g_system.schema_migration"
      )).rows[0]?.count || 0);
      const entry = entries[ledgerCount];
      const snapshot = await tenantSchemaSnapshot(client);
      const fingerprint = tenantSchemaFingerprint(snapshot);
      if (!entry || entry.ordinal === 5 || entry === entries.at(-1)) {
        captures.push(Object.freeze({
          fingerprint,
          ordinal: entry?.ordinal ?? null,
          sectionHashes: sectionHashes(snapshot),
          snapshot,
          version: entry?.version ?? 'DOWNGRADE_TARGET'
        }));
      }
      return fingerprint;
    }
  });
}

async function migrate(pool, entries, label, captures, input) {
  return createRunner(pool, entries, captures).migrate(input(label));
}

async function owner(pool) {
  return (await pool.query(`SELECT owner.rolname AS owner_name,p.prosecdef AS security_definer,
    l.lanname AS language_name,p.proconfig AS function_config
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    JOIN pg_roles owner ON owner.oid=p.proowner JOIN pg_language l ON l.oid=p.prolang
    WHERE p.oid=to_regprocedure('async_exec.guard_outbox_lineage_v1()')`)).rows[0];
}

async function assertRejected(operation, acceptedCodes) {
  let observed;
  try { await operation(); }
  catch (error) { observed = error.internalCode || error.code || error.name; }
  assert.ok(acceptedCodes.includes(observed), `Expected ${acceptedCodes.join('/')} but observed ${observed || 'success'}.`);
  return observed;
}

async function rewriteHistoricalFixture(pool, throughVersion) {
  await pool.query(`ALTER FUNCTION async_exec.guard_outbox_lineage_v1() OWNER TO ${HISTORICAL_OWNER}`);
  const snapshot = await tenantSchemaSnapshot(pool);
  const observed = tenantSchemaFingerprint(snapshot);
  assert.equal(observed, HISTORICAL_FINGERPRINTS[throughVersion]);
  await pool.query('BEGIN');
  try {
    await pool.query('SET LOCAL ROLE c4g_tenant_owner');
    await pool.query('ALTER TABLE c4g_system.schema_migration DISABLE TRIGGER schema_migration_append_only');
    for (const entry of CANONICAL_BASELINE) {
      if (entry.ordinal < 5 || entry.ordinal > Number(throughVersion.slice(0, 3))) continue;
      await pool.query('UPDATE c4g_system.schema_migration SET resulting_fingerprint=$1 WHERE migration_id=$2',
        [HISTORICAL_FINGERPRINTS[entry.version], entry.version]);
    }
    await pool.query('ALTER TABLE c4g_system.schema_migration ENABLE TRIGGER schema_migration_append_only');
    await pool.query('RESET ROLE');
    await pool.query('COMMIT');
  } catch (error) {
    await pool.query('ROLLBACK');
    throw error;
  }
  return Object.freeze({ observed, snapshot, sectionHashes: sectionHashes(snapshot) });
}

async function scenario(source, database, login, imageDigest, execute) {
  const pool = new Pool({ connectionString: databaseUrl(source, database, login), max: 3 });
  const captures = [];
  const identity = Object.freeze({ tenantId: crypto.randomUUID(), databaseGenerationId: crypto.randomUUID() });
  const input = label => request(label, identity);
  try {
    const metadata = await environment(pool, login, imageDigest);
    const result = await execute(pool, captures, input);
    return Object.freeze({ captures: Object.freeze(captures), database, login, metadata, result });
  } finally { await pool.end(); }
}

async function main() {
  const { evidencePath, imageDigest, url } = target();
  const admin = new Pool({ connectionString: url.toString(), max: 2 });
  try {
    await createInfrastructure(admin, url);
    const results = [];
    // Run the supported role-dropping downgrade before other tenant databases
    // create cluster-wide dependencies on the same NOLOGIN runtime roles.
    results.push(await scenario(url, 'm005_rollback', ADMINS[0], imageDigest, async (pool, captures, input) => {
      const through007 = Object.freeze(CANONICAL_BASELINE.slice(0, 8));
      await migrate(pool, through007, 'rollback-prefix', captures, input);
      let reverted;
      try {
        reverted = await createRunner(pool, through007, captures).downgrade({
          ...input('rollback-007-006'), targetVersion: '006_f13_p1_organizational_scope'
        });
      } catch (error) {
        const observed = captures.findLast(item => item.version === 'DOWNGRADE_TARGET')?.fingerprint || null;
        const diagnostic = await pool.connect();
        let raw = null;
        try {
          await diagnostic.query('BEGIN');
          await diagnostic.query(migrationSql('007_f13_profile_catalogs_and_policies', 'down').sql);
        } catch (cause) {
          raw = { code: cause.code || null, message: cause.message };
        } finally {
          await diagnostic.query('ROLLBACK').catch(() => {});
          diagnostic.release();
        }
        throw new Error(`Supported downgrade failed: expected ${CANONICAL_BASELINE[6].schemaFingerprint}; observed ${observed}; code ${error.internalCode || error.code || error.name}; raw ${JSON.stringify(raw)}.`);
      }
      const reapplied = await migrate(pool, CANONICAL_BASELINE, 'rollback-reapply', captures, input);
      assert.equal((await owner(pool)).owner_name, CANONICAL_OWNER);
      return Object.freeze({ reapplied: reapplied.appliedVersions.length, reverted: reverted.revertedVersions });
    }));

    for (const [database, login] of [['m005_fresh_a', ADMINS[0]], ['m005_fresh_b', ADMINS[1]]]) {
      results.push(await scenario(url, database, login, imageDigest, async (pool, captures, input) => {
        const applied = await migrate(pool, CANONICAL_BASELINE, database, captures, input);
        assert.equal(applied.evidence.currentVersion, '030_organization_notices');
        assert.equal((await owner(pool)).owner_name, CANONICAL_OWNER);
        return Object.freeze({ applied: applied.appliedVersions.length, owner: await owner(pool) });
      }));
    }

    results.push(await scenario(url, 'm005_from_004', ADMINS[0], imageDigest, async (pool, captures, input) => {
      await migrate(pool, Object.freeze(CANONICAL_BASELINE.slice(0, 5)), 'from004-prefix', captures, input);
      const to005 = await migrate(pool, Object.freeze(CANONICAL_BASELINE.slice(0, 6)), 'from004-to005', captures, input);
      const to030 = await migrate(pool, CANONICAL_BASELINE, 'from004-to030', captures, input);
      return Object.freeze({ to005: to005.appliedVersions, to030: to030.appliedVersions.length, owner: await owner(pool) });
    }));

    results.push(await scenario(url, 'm005_from_003', ADMINS[1], imageDigest, async (pool, captures, input) => {
      await migrate(pool, Object.freeze(CANONICAL_BASELINE.slice(0, 4)), 'from003-prefix', captures, input);
      const to005 = await migrate(pool, Object.freeze(CANONICAL_BASELINE.slice(0, 6)), 'from003-to005', captures, input);
      const to030 = await migrate(pool, CANONICAL_BASELINE, 'from003-to030', captures, input);
      return Object.freeze({ to005: to005.appliedVersions, to030: to030.appliedVersions.length, owner: await owner(pool) });
    }));

    results.push(await scenario(url, 'm005_tampered', ADMINS[0], imageDigest, async (pool, captures, input) => {
      await migrate(pool, Object.freeze(CANONICAL_BASELINE.slice(0, 6)), 'tamper-prefix', captures, input);
      await pool.query(`ALTER FUNCTION async_exec.guard_outbox_lineage_v1() OWNER TO ${ADMINS[0]}`);
      const tamperedOwner = await owner(pool);
      const rejection = await assertRejected(() => migrate(pool, CANONICAL_BASELINE, 'tamper-rejected', captures, input),
        ['TENANT_SCHEMA_FINGERPRINT_MISMATCH', 'OBJECT_OWNER_MISMATCH']);
      return Object.freeze({ rejection, tamperedOwner });
    }));

    results.push(await scenario(url, 'm005_historical_005', ADMINS[0], imageDigest, async (pool, captures, input) => {
      await migrate(pool, Object.freeze(CANONICAL_BASELINE.slice(0, 6)), 'historical005-prefix', captures, input);
      const fixture = await rewriteHistoricalFixture(pool, '005_f9_execution_lineage');
      const rejection = await assertRejected(() => migrate(pool, CANONICAL_BASELINE, 'historical005-rejected', captures, input),
        ['TENANT_SCHEMA_FINGERPRINT_MISMATCH', 'TENANT_LEDGER_MISMATCH', 'OBJECT_OWNER_MISMATCH']);
      return Object.freeze({ fixture, rejection });
    }));

    results.push(await scenario(url, 'm005_historical_030', ADMINS[1], imageDigest, async (pool, captures, input) => {
      await migrate(pool, CANONICAL_BASELINE, 'historical030-prefix', captures, input);
      const fixture = await rewriteHistoricalFixture(pool, '030_organization_notices');
      const rejection = await assertRejected(() => migrate(pool, CANONICAL_BASELINE, 'historical030-rejected', captures, input),
        ['TENANT_SCHEMA_FINGERPRINT_MISMATCH', 'TENANT_LEDGER_MISMATCH', 'OBJECT_OWNER_MISMATCH']);
      return Object.freeze({ fixture, rejection });
    }));

    const canonical005 = results.slice(0, 5).map(item => item.captures.find(capture => capture.ordinal === 5));
    assert.ok(canonical005.every(Boolean));
    assert.equal(new Set(canonical005.map(item => item.fingerprint)).size, 1);
    assert.equal(canonical005[0].fingerprint, CANONICAL_BASELINE.find(entry => entry.ordinal === 5).schemaFingerprint);
    const administrativeLoginDifference = firstDifference(canonical005[1].snapshot, canonical005[2].snapshot);
    assert.equal(administrativeLoginDifference, null);

    const evidence = Object.freeze({
      canonical005Fingerprint: canonical005[0].fingerprint,
      firstDifferenceBetweenAdministrativeLogins: administrativeLoginDifference,
      imageDigest,
      proof: PROOF,
      results: Object.freeze(results),
      schemaVersion: 1
    });
    fs.writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
    process.stdout.write(`${JSON.stringify({ result: 'PASS', evidencePath,
      canonical005Fingerprint: evidence.canonical005Fingerprint,
      scenarios: results.map(item => ({ database: item.database, login: item.login, result: item.result })) })}\n`);
  } finally { await admin.end(); }
}

main().catch(error => {
  process.stderr.write(`${JSON.stringify({ name: error.name, code: error.code || null,
    internalCode: error.internalCode || null, message: error.message, stack: error.stack })}\n`);
  process.exitCode = 1;
});
