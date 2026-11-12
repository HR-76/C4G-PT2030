'use strict';
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const backend = path.resolve(__dirname, '../../../backend');
const migration = require(path.join(backend, 'src/security/centralMigrationManifest'));
const schema = require(path.join(backend, 'src/security/centralSchemaManifest'));
const security = require(path.join(backend, 'src/security/authoritySecurityManifest'));
const runner = require(path.join(backend, 'scripts/runCentralMigrations'));
const { preflightCentral } = require(path.join(backend, 'src/security/centralMigrationPreflight'));

const candidate = name => fs.readFileSync(path.join(backend, 'database/central/candidates', name), 'utf8');
const privilege = async (pool, role, table, kind) =>
  (await pool.query('SELECT has_table_privilege($1,$2,$3) AS allowed', [role, table, kind])).rows[0].allowed;

async function run({ pool, base, port }) {
  const memberVariant = process.env.EMAIL_GATE_MEMBER_VARIANT === '1';
  const calibrate = process.env.EMAIL_GATE_CALIBRATE === '1';

  await pool.query('CREATE ROLE c4g_central_owner NOLOGIN; CREATE ROLE c4g_central_runtime NOLOGIN');
  await pool.query("CREATE TABLE public.c4g_database_identity(product_code text NOT NULL,database_role text NOT NULL); INSERT INTO public.c4g_database_identity VALUES('C4G','CENTRAL')");

  // Bring Central to 050 exactly as the installers do.
  if (memberVariant) {
    await runner.applyCentralMigrationsWithManifest(pool, migration.catalogReadManifest, migration.migrationSql);
    await pool.query(migration.canonicalizeMigrationSql(candidate('member_email_delivery.up.sql')));
  }
  await runner.applyCentralMigrationsWithManifest(pool, migration.centralImportManifest, migration.migrationSql);
  await runner.applyRegisteredBillingPdfsPackage(pool, 'billing-private-documents-v1');
  const before = await preflightCentral(pool);
  assert.equal(before.currentVersion, '050_billing_private_documents');

  const sql = candidate('email_templates.up.sql');
  if (calibrate) {
    await pool.query(migration.canonicalizeMigrationSql(sql));
  } else {
    const applied = await runner.applyRegisteredEmailTemplatesPackage(pool, 'email-templates-v1');
    assert.deepEqual(applied.map(entry => entry.version || entry), ['051_email_templates']);
    // Repeating the installation is a no-op.
    assert.deepEqual(await runner.applyRegisteredEmailTemplatesPackage(pool, 'email-templates-v1'), []);
    await assert.rejects(() => runner.applyRegisteredEmailTemplatesPackage(pool, 'another-package'), /EMAIL_TEMPLATES_PACKAGE_NOT_REGISTERED/);
    // The whole admission chain accepts the new revision, not only its own fingerprint.
    const after = await preflightCentral(pool);
    assert.equal(after.currentVersion, '051_email_templates');
    assert.deepEqual(after.appliedVersions.slice(0, -1), before.appliedVersions);
  }

  const result = {
    memberVariant,
    upChecksum: migration.migrationChecksumPolicy(sql).checksum,
    schemaFingerprint: schema.schemaFingerprint(await schema.centralSchemaSnapshot(pool, { compactAuthority: true })),
    authoritySecurityFingerprint: security.digest(await security.authoritySecuritySnapshot(pool)),
  };
  fs.writeFileSync(path.join(base, 'fingerprints.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));

  for (const table of ['public.email_template_version', 'public.email_logo_version']) {
    assert.equal(await privilege(pool, 'c4g_central_runtime', table, 'SELECT'), true);
    for (const kind of ['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']) {
      assert.equal(await privilege(pool, 'c4g_central_runtime', table, kind), false, `${table} ${kind}`);
    }
    for (const kind of ['SELECT', 'INSERT']) {
      assert.equal(await privilege(pool, 'c4g_authority_runtime', table, kind), false, `${table} authority ${kind}`);
    }
  }
  await require('./behaviors.cjs').verify({ pool, port });
}

module.exports = { run };
