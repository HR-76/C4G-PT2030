'use strict';
// Creates its own PostgreSQL cluster; never reads credentials or existing databases.
const fs = require('node:fs'), path = require('node:path'), net = require('node:net');
const { execFileSync } = require('node:child_process');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '../../..');
const backend = path.join(root, 'backend');
const bin = 'C:/Program Files/PostgreSQL/18/bin';
const base = path.join(root, '.tmp', 'member-email-053-' + Date.now());
const run = (name, args) => execFileSync(path.join(bin, name + '.exe'), args, { windowsHide: true, stdio: 'ignore', timeout: 120000 });
const schema = require(path.join(backend, 'src/security/centralSchemaManifest'));
const authority = require(path.join(backend, 'src/security/authoritySecurityManifest'));
const migrations = require(path.join(backend, 'src/security/centralMigrationManifest'));
const runner = require(path.join(backend, 'scripts/runCentralMigrations'));
const { preflightCentral } = require(path.join(backend, 'src/security/centralMigrationPreflight'));
const version = '053_opportunity_complement';
async function freePort() {
  const server = net.createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}
async function probe(pool) {
  await pool.query('CREATE ROLE c4g_central_owner NOLOGIN; CREATE ROLE c4g_central_runtime NOLOGIN');
  await pool.query("CREATE TABLE public.c4g_database_identity(product_code text NOT NULL,database_role text NOT NULL); INSERT INTO public.c4g_database_identity VALUES('C4G','CENTRAL')");
  await runner.applyCentralMigrationsWithManifest(pool, migrations.centralImportManifest, migrations.migrationSql);
  await runner.applyRegisteredBillingPdfsPackage(pool, 'billing-private-documents-v1');
  await runner.applyRegisteredEmailTemplatesPackage(pool, 'email-templates-v1');
  await runner.applyRegisteredCentralRuntimeReadPackage(pool, 'central-runtime-read-v1');
  await runner.applyRegisteredOpportunityComplementPackage(pool, 'opportunity-complement-v1');
  assert.equal((await preflightCentral(pool)).currentVersion, version);
  const client = await pool.connect();
  const definition = async () => (await client.query("SELECT pg_get_functiondef('authority_api.execute(text,text[],text)'::regprocedure) AS value")).rows[0].value;
  let evidence;
  try {
    await client.query('BEGIN');
    const before = await schema.centralSchemaSnapshot(client, { compactAuthority: true });
    const oldDefinition = await definition();
    const ledger = (await client.query('SELECT * FROM public.c4g_schema_migration ORDER BY version')).rows;
    await client.query(require(path.join(backend, 'src/platformOnboarding/memberEmailSecurityPackage')).load().sql);
    const newDefinition = await definition();
    assert.notEqual(oldDefinition, newDefinition);
    const after = await schema.centralSchemaSnapshot(client, { compactAuthority: true });
    const normalize = value => typeof value === 'string' ? (value === newDefinition ? oldDefinition : value)
      : Array.isArray(value) ? value.map(normalize)
        : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).map(([k, v]) => [k, normalize(v)])) : value;
    assert.deepEqual(normalize(after), before, 'only the authority function definition may change');
    assert.deepEqual((await client.query('SELECT * FROM public.c4g_schema_migration ORDER BY version')).rows, ledger);
    evidence = { version, schema: schema.schemaFingerprint(after), authority: authority.digest(after.authoritySecurity) };
    fs.writeFileSync(path.join(base, 'fingerprints.json'), JSON.stringify(evidence, null, 2));
    console.log(JSON.stringify(evidence));
    if (process.env.MEMBER_EMAIL_CALIBRATE !== '1') {
      assert.equal(require(path.join(backend, 'src/security/memberEmailAdmission')).admits(version, 'schema', evidence.schema), true);
      await schema.assertCentralSchema(client, version);
      await authority.assertAuthoritySecurity(client, version);
      assert.equal(await require(path.join(backend, 'src/security/catalogReaderSchema')).assertCatalogReaderSchema(client), version);
    }
    await client.query('SET SESSION AUTHORIZATION c4g_authority_runtime');
    const result = await require(path.join(backend, 'src/security/authorityProtocolQueries')).execute(client,
      require(path.join(backend, 'src/platformOnboarding/memberSql')).emailDelivery,
      ['00000000-0000-4000-8000-000000000001', JSON.stringify({ status: 'ACCEPTED' }), '00000000-0000-4000-8000-000000000002']);
    assert.equal(result.rowCount, 0);
  } finally {
    await client.query('ROLLBACK');
    client.release();
  }
  assert.equal((await preflightCentral(pool)).currentVersion, version);
  if (process.env.MEMBER_EMAIL_CALIBRATE !== '1') {
    const { rollout } = require(path.join(backend, 'scripts/staging/memberEmailRollout'));
    await assert.rejects(rollout(pool, { mode: 'apply', expectedDatabase: 'wrong' }), /MEMBER_EMAIL_TARGET_MISMATCH/);
    assert.equal((await rollout(pool, { mode: 'check', expectedDatabase: 'postgres' })).installed, false);
    const rehearsal = await rollout(pool, { mode: 'rehearse', expectedDatabase: 'postgres' });
    assert.equal(rehearsal.rehearsalPassed, true);
    assert.equal((await rollout(pool, { mode: 'check', expectedDatabase: 'postgres' })).installed, false);
    const applied = await rollout(pool, { mode: 'apply', expectedDatabase: 'postgres' });
    assert.equal(applied.installed, true);
    assert.equal(applied.recordsPreserved, true);
    const repeated = await rollout(pool, { mode: 'apply', expectedDatabase: 'postgres' });
    assert.equal(repeated.alreadyInstalled, true);
    assert.deepEqual(repeated.counts, applied.counts);
    assert.equal(repeated.fingerprint, applied.fingerprint);
    assert.equal((await preflightCentral(pool)).currentVersion, version);
  }
  return evidence;
}
(async () => {
  fs.mkdirSync(base, { recursive: true });
  const port = await freePort(), data = path.join(base, 'data');
  let started = false;
  try {
    run('initdb', ['-D', data, '-U', 'c4g_f12_admin', '-A', 'trust', '--encoding=UTF8', '--locale=C']);
    run('pg_ctl', ['-D', data, '-l', path.join(base, 'postgres.log'), '-o', `-h 127.0.0.1 -p ${port}`, '-w', 'start']);
    started = true;
    const { Pool } = require(path.join(backend, 'node_modules/pg'));
    const pool = new Pool({ host: '127.0.0.1', port, user: 'c4g_f12_admin', database: 'postgres' });
    try { await probe(pool); } finally { await pool.end(); }
    console.log(JSON.stringify({ pass: true, evidence: base }));
  } finally {
    if (started) run('pg_ctl', ['-D', data, '-m', 'fast', '-w', 'stop']);
  }
})().catch(error => { console.error(error.stack); process.exitCode = 1; });
