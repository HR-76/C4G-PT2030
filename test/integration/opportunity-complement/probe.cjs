'use strict';
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const backend = path.resolve(__dirname, '../../../backend');
const migration = require(path.join(backend, 'src/security/centralMigrationManifest'));
const schema = require(path.join(backend, 'src/security/centralSchemaManifest'));
const security = require(path.join(backend, 'src/security/authoritySecurityManifest'));
const runner = require(path.join(backend, 'scripts/runCentralMigrations'));
const staging = require(path.join(backend, 'src/security/stagingCentralRuntimeAdmission'));
const { preflightCentral } = require(path.join(backend, 'src/security/centralMigrationPreflight'));

const TABLE = 'public.opportunity_complement_version';
const candidate = name => fs.readFileSync(path.join(backend, 'database/central/candidates', name), 'utf8');
const privilege = async (pool, role, table, kind) =>
  (await pool.query('SELECT has_table_privilege($1,$2,$3) AS allowed', [role, table, kind])).rows[0].allowed;
const fingerprints = async pool => ({
  schemaFingerprint: schema.schemaFingerprint(await schema.centralSchemaSnapshot(pool, { compactAuthority: true })),
  authoritySecurityFingerprint: security.digest(await security.authoritySecuritySnapshot(pool)),
});

async function run({ pool, base, port }) {
  const stagingLogins = process.env.COMPLEMENT_GATE_STAGING_LOGINS === '1';
  const calibrate = process.env.COMPLEMENT_GATE_CALIBRATE === '1';

  await pool.query('CREATE ROLE c4g_central_owner NOLOGIN; CREATE ROLE c4g_central_runtime NOLOGIN');
  await pool.query("CREATE TABLE public.c4g_database_identity(product_code text NOT NULL,database_role text NOT NULL); INSERT INTO public.c4g_database_identity VALUES('C4G','CENTRAL')");

  // Bring Central to 052 exactly as the installers do.
  await runner.applyCentralMigrationsWithManifest(pool, migration.centralImportManifest, migration.migrationSql);
  await runner.applyRegisteredBillingPdfsPackage(pool, 'billing-private-documents-v1');
  await runner.applyRegisteredEmailTemplatesPackage(pool, 'email-templates-v1');
  await runner.applyRegisteredCentralRuntimeReadPackage(pool, 'central-runtime-read-v1');

  let before052 = null;
  if (stagingLogins) {
    // The same statements as backend/scripts/staging/install.js (ensureCentralRuntimeLogin).
    for (const login of ['c4g_central_staging_api', 'c4g_central_staging_worker']) {
      await pool.query(`CREATE ROLE ${login} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD 'synthetic-gate-only'`);
      await pool.query(`GRANT c4g_central_runtime TO ${login} WITH INHERIT TRUE, SET FALSE, ADMIN FALSE`);
      await pool.query(`GRANT CONNECT ON DATABASE postgres TO ${login}`);
    }
    process.env[staging.FLAG] = staging.VALUE;
    // Control: this gate reproduces the staging state that was pinned for 052 on the VPS.
    before052 = await fingerprints(pool);
    assert.equal(staging.admits('052_central_runtime_read', 'schema', before052.schemaFingerprint), true, '052 staging schema pin not reproduced');
    assert.equal(staging.admits('052_central_runtime_read', 'authority', before052.authoritySecurityFingerprint), true, '052 staging authority pin not reproduced');
  }
  const before = await preflightCentral(pool);
  assert.equal(before.currentVersion, '052_central_runtime_read');

  const sql = candidate('opportunity_complement.up.sql');
  if (calibrate) {
    await pool.query(migration.canonicalizeMigrationSql(sql));
  } else {
    const applied = await runner.applyRegisteredOpportunityComplementPackage(pool, 'opportunity-complement-v1');
    assert.deepEqual(applied.map(entry => entry.version || entry), ['053_opportunity_complement']);
    // Repeating the installation is a no-op.
    assert.deepEqual(await runner.applyRegisteredOpportunityComplementPackage(pool, 'opportunity-complement-v1'), []);
    await assert.rejects(() => runner.applyRegisteredOpportunityComplementPackage(pool, 'another-package'), /OPPORTUNITY_COMPLEMENT_PACKAGE_NOT_REGISTERED/);
    // The whole admission chain accepts the new revision, not only its own fingerprint.
    const after = await preflightCentral(pool);
    assert.equal(after.currentVersion, '053_opportunity_complement');
    assert.deepEqual(after.appliedVersions.slice(0, -1), before.appliedVersions);
    // Every other admission that reads the Central version accepts 053 as well.
    const opportunity = await require(path.join(backend, 'src/opportunities/preflight')).opportunityPreflight(pool, 'central');
    assert.ok(opportunity);
    assert.equal(await require(path.join(backend, 'src/security/catalogReaderSchema')).assertCatalogReaderSchema(pool), '053_opportunity_complement');
    assert.equal(migration.supportsCentralVersion('053_opportunity_complement', '051_email_templates'), true);
  }

  const result = { stagingLogins, upChecksum: migration.migrationChecksumPolicy(sql).checksum, ...await fingerprints(pool) };
  fs.writeFileSync(path.join(base, 'fingerprints.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));

  // The catalog schema is untouched: no new object, owner or grant in opportunity_catalog.
  assert.equal((await pool.query("SELECT count(*)::int AS n FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='opportunity_catalog' AND c.relname LIKE '%complement%'")).rows[0].n, 0);
  assert.equal(await privilege(pool, 'c4g_central_runtime', TABLE, 'SELECT'), true);
  for (const kind of ['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']) assert.equal(await privilege(pool, 'c4g_central_runtime', TABLE, kind), false, kind);
  for (const kind of ['SELECT', 'INSERT']) assert.equal(await privilege(pool, 'c4g_authority_runtime', TABLE, kind), false, 'authority ' + kind);
  for (const kind of ['SELECT', 'INSERT']) assert.equal(await privilege(pool, 'c4g_catalog_reader', TABLE, kind), false, 'reader ' + kind);
  await require('./behaviors.cjs').verify({ pool, port });
}

module.exports = { run };
