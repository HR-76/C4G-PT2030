'use strict';
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const backend = path.resolve(__dirname, '../../../backend');
async function run({ pool, base, port }) {
  await require('../entity-type-edit/probe.cjs').run({ pool, base, port });
  const migration = require('../../../backend/src/security/centralMigrationManifest');
  const sql = migration.canonicalizeMigrationSql(fs.readFileSync(path.join(backend, 'database/central/candidates/email_delivery_history.up.sql'), 'utf8'));
  if (process.env.EMAIL_HISTORY_GATE_CALIBRATE === '1') await pool.query(sql);
  else {
    const runner = require('../../../backend/scripts/runCentralMigrations');
    assert.equal((await runner.applyRegisteredEmailDeliveryPackage(pool, 'email-delivery-history-v1')).length, 1);
    assert.deepEqual(await runner.applyRegisteredEmailDeliveryPackage(pool, 'email-delivery-history-v1'), []);
    assert.equal((await require('../../../backend/src/security/centralMigrationPreflight').preflightCentral(pool)).currentVersion, '056_email_delivery_history');
    await require('../../../backend/src/security/authoritySecurityManifest').assertAuthoritySecurity(pool, '056_email_delivery_history');
    await require('../../../backend/src/security/catalogReaderSchema').assertCatalogReaderSchema(pool);
  }
  const schema = require('../../../backend/src/security/centralSchemaManifest');
  const security = require('../../../backend/src/security/authoritySecurityManifest');
  const fingerprints = { variant: process.env.ENTITY_TYPE_GATE_USER_DELETION === '1' ? 'user-deletion' : process.env.ENTITY_TYPE_GATE_STAGING_LOGINS === '1' ? 'staging' : 'generic',
    upChecksum: migration.migrationChecksumPolicy(sql).checksum,
    schemaFingerprint: schema.schemaFingerprint(await schema.centralSchemaSnapshot(pool, { compactAuthority: true })),
    authoritySecurityFingerprint: security.digest(await security.authoritySecuritySnapshot(pool)) };
  fs.writeFileSync(path.join(base, 'email-history-fingerprints.json'), JSON.stringify(fingerprints, null, 2));
  console.log(JSON.stringify(fingerprints));
  await pool.query('ALTER ROLE c4g_central_runtime LOGIN');
  const runtime = new (require('../../../backend/node_modules/pg').Pool)({ host: '127.0.0.1', port, user: 'c4g_central_runtime', database: 'postgres' });
  try {
    const id = randomUUID(), to = 'synthetic@example.invalid';
    await assert.rejects(runtime.query('SELECT * FROM public.email_delivery_history'), { code: '42501' });
    await assert.rejects(runtime.query('DELETE FROM public.email_delivery_history'), { code: '42501' });
    await runtime.query('SELECT public.email_delivery_begin($1,NULL,$2,false)', [id, to]);
    await Promise.all(Array.from({ length: 5 }, () => runtime.query('SELECT public.email_delivery_begin($1,NULL,$2,false)', [id, to])));
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM public.email_delivery_history')).rows[0].n, 1);
    await runtime.query('SELECT public.email_delivery_finish($1,$2)', [id, 'ACCEPTED']);
    await runtime.query('SELECT public.email_delivery_finish($1,$2)', [id, 'UNCONFIRMED']);
    assert.equal((await pool.query('SELECT result FROM public.email_delivery_history WHERE id=$1', [id])).rows[0].result, 'ACCEPTED');
    const admin = (await pool.query("SELECT s.sid,s.global_user_id FROM public.application_session s JOIN public.platform_admin_assignment a ON a.global_user_id=s.global_user_id WHERE s.status='ACTIVE' AND a.status='ACTIVE' LIMIT 1")).rows[0];
    assert.ok(admin, 'the isolated fixture has an active platform administrator');
    const page = await runtime.query("SELECT * FROM public.email_delivery_list($1,$2,clock_timestamp(),$3,'')", [admin.sid, admin.global_user_id, 'ffffffff-ffff-ffff-ffff-ffffffffffff']);
    assert.equal(page.rows.length, 1); assert.equal(page.rows[0].recipient, to);
    const fixture = await pool.connect();
    try {
      await fixture.query('BEGIN');
      await fixture.query("SET LOCAL session_replication_role='replica'");
      await fixture.query("UPDATE public.application_session SET expires_at=clock_timestamp()-interval '1 hour' WHERE sid=$1", [admin.sid]);
      await fixture.query('COMMIT');
    } catch (error) { await fixture.query('ROLLBACK'); throw error; }
    finally { fixture.release(); }
    await assert.rejects(runtime.query("SELECT * FROM public.email_delivery_list($1,$2,clock_timestamp(),$3,'')", [admin.sid, admin.global_user_id, id]), /C4G_ADMIN_REQUIRED/);
    await assert.rejects(runtime.query('SELECT public.email_delivery_begin($1,NULL,$2,false)', [id, 'other@example.invalid']), /IDEMPOTENCY_CONFLICT/);
    await assert.rejects(runtime.query("SELECT * FROM public.email_delivery_list('unknown',$1,clock_timestamp(),$2,'')", [randomUUID(), randomUUID()]), /C4G_ADMIN_REQUIRED/);
    await pool.query("UPDATE public.email_delivery_history SET occurred_at=clock_timestamp()-interval '90 days' WHERE id=$1", [id]);
    assert.equal((await runtime.query('SELECT public.email_delivery_retention() AS n')).rows[0].n, '1');
    assert.equal((await pool.query('SELECT recipient FROM public.email_delivery_history WHERE id=$1', [id])).rows[0].recipient, null);
    await runtime.query('SELECT public.email_delivery_begin($1,NULL,$2,false)', [id, to]);
    assert.equal((await pool.query('SELECT recipient FROM public.email_delivery_history WHERE id=$1', [id])).rows[0].recipient, null);
    assert.equal((await runtime.query('SELECT public.email_delivery_retention() AS n')).rows[0].n, '0');
    // All result states, including failure, obey the same boundary.
    for (const result of ['UNCONFIRMED', 'NOT_CONFIGURED']) {
      const other = randomUUID();
      await runtime.query('SELECT public.email_delivery_begin($1,NULL,$2,false)', [other, to]);
      await runtime.query('SELECT public.email_delivery_finish($1,$2)', [other, result]);
      await pool.query("UPDATE public.email_delivery_history SET occurred_at=clock_timestamp()-interval '91 days' WHERE id=$1", [other]);
    }
    assert.equal((await runtime.query('SELECT public.email_delivery_retention() AS n')).rows[0].n, '2');
    console.log('EMAIL_HISTORY_SQL_BEHAVIORS_OK');
  } finally { await runtime.end(); }
}
module.exports = { run };
