const assert = require('node:assert/strict');
const test = require('node:test');
const { Pool } = require('pg');
const { load } = require('../src/audit/migrationManifest');
const { auditPreflight } = require('../src/audit/preflight');
const { PostgresAppendRepository } = require('../src/audit/postgresAppendRepository');
const { createAppendService } = require('../src/audit/appendService');
const { createAuditEvent } = require('../src/audit/event');
const { createUuidV7 } = require('../src/audit/uuidV7');
const { verifyEvents } = require('../src/audit/verifier');

const targets = [
  ['central', process.env.F7_CENTRAL_DATABASE_URL],
  ['tenant', process.env.F7_TENANT_DATABASE_URL]
];

if (targets.some(([, url]) => !url)) {
  test('F7 PostgreSQL integration requires explicit disposable targets', () => {
    assert.equal(process.env.F7_CENTRAL_DATABASE_URL, undefined);
    assert.equal(process.env.F7_TENANT_DATABASE_URL, undefined);
  });
} else for (const [scope, connectionString] of targets) {
  test(`F7-AC-07–25 PostgreSQL 17 ${scope} migration, append-only and isolation`, async () => {
    const parsed = new URL(connectionString);
    assert.notEqual(parsed.port, '5432'); assert.notEqual(parsed.port, '5433'); assert.match(parsed.pathname, /^\/f7_synthetic_/);
    const pool = new Pool({ connectionString, max: 4 });
    try {
      const version = await pool.query('SHOW server_version_num'); assert.equal(Math.floor(Number(version.rows[0].server_version_num) / 10000), 17);
      await pool.query(load(scope).sql);
      assert.equal((await auditPreflight(pool)).ready, true);
      const organizationId = scope === 'central' ? '11111111-1111-4111-8111-111111111111' : '22222222-2222-4222-8222-222222222222';
      const now = new Date(); const uuid = () => createUuidV7({ now: () => now.getTime() });
      const trustedContext = { organizationId, tenantId: scope === 'tenant' ? 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' : null,
        operationAuthority: scope === 'tenant' ? 'TENANT' : 'CENTRAL', operationCode: 'F7_SYNTHETIC', source: 'TEST', channel: 'WORKER', synchronous: true };
      const input = { eventCode: 'AUTHORIZATION_DENIED', actor: { type: 'SERVICE', id: 'f7-service', membershipId: null, serviceActorCode: 'F7_TEST', supportGrantId: null },
        subject: null, resource: { type: 'AUDIT_EVENT', id: 'synthetic-1' }, decision: 'DENY', outcome: 'DENIED', observedAt: now.toISOString(),
        correlationId: uuid(), causationId: null, idempotencyKey: `${scope}-logical-1`, streamType: 'ACCESS', payload: { detailCode: 'SYNTHETIC_DENY' } };
      const candidate = createAuditEvent({ trustedContext, input, clock: () => now, uuid });
      const service = createAppendService({ appendPort: new PostgresAppendRepository() });
      const client = await pool.connect();
      let first;
      try { await client.query('BEGIN'); first = await service.append(candidate, client); await client.query('COMMIT'); }
      catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
      assert.equal(first.status, 'APPENDED');
      const duplicateClient = await pool.connect();
      try { await duplicateClient.query('BEGIN'); const duplicate = await service.append(candidate, duplicateClient); await duplicateClient.query('COMMIT'); assert.equal(duplicate.status, 'DUPLICATE'); }
      catch (error) { await duplicateClient.query('ROLLBACK'); throw error; } finally { duplicateClient.release(); }
      const divergent = createAuditEvent({ trustedContext, input: { ...input, payload: { detailCode: 'DIFFERENT' } }, clock: () => now, uuid });
      const divergentClient = await pool.connect();
      try { await divergentClient.query('BEGIN'); await assert.rejects(service.append(divergent, divergentClient), /DIGEST_MISMATCH/); await divergentClient.query('ROLLBACK'); }
      finally { divergentClient.release(); }
      await Promise.all(Array.from({ length: 4 }, async (_, index) => {
        const concurrent = createAuditEvent({ trustedContext, input: { ...input, idempotencyKey: `${scope}-parallel-${index}`, correlationId: uuid(), payload: { detailCode: `PARALLEL_${index}` } }, clock: () => now, uuid });
        const worker = await pool.connect();
        try { await worker.query('BEGIN'); await service.append(concurrent, worker); await worker.query('COMMIT'); }
        catch (error) { await worker.query('ROLLBACK'); throw error; } finally { worker.release(); }
      }));
      const persisted = await pool.query('SELECT event_data,event_hash FROM audit.event ORDER BY sequence');
      assert.equal(persisted.rows.length, 5);
      assert.equal(verifyEvents(persisted.rows.map(row => ({ ...row.event_data, eventHash: row.event_hash }))).valid, true);

      const attack = await pool.connect();
      try {
        await attack.query('SET ROLE c4g_audit_writer');
        await assert.rejects(attack.query(`UPDATE audit.event SET event_code='ALTERED'`), /permission denied|AUDIT_APPEND_ONLY/);
        await assert.rejects(attack.query('DELETE FROM audit.event'), /permission denied|AUDIT_APPEND_ONLY/);
        await assert.rejects(attack.query('TRUNCATE audit.event'), /permission denied|AUDIT_APPEND_ONLY/);
        await assert.rejects(attack.query(`INSERT INTO audit.event_identity(event_id,producer_code,organization_id,event_code,event_version,idempotency_key,input_digest,event_hash,accepted_at) VALUES(gen_random_uuid(),'x',$1,'X',1,'x',repeat('0',64),repeat('0',64),now())`, [organizationId]), /permission denied/);
        await attack.query('RESET ROLE');
      } finally { attack.release(); }

      const reader = await pool.connect();
      try {
        await reader.query('BEGIN'); await reader.query('SET LOCAL ROLE c4g_audit_reader');
        await reader.query(`SELECT set_config('app.organization_id',$1,true)`, [organizationId]);
        assert.equal((await reader.query('SELECT count(*) FROM audit.event')).rows[0].count, '5');
        await reader.query(`SELECT set_config('app.organization_id',$1,true)`, ['33333333-3333-4333-8333-333333333333']);
        assert.equal((await reader.query('SELECT count(*) FROM audit.event')).rows[0].count, '0'); await reader.query('ROLLBACK');
      } finally { reader.release(); }

      const partition = (await pool.query(`SELECT tableoid::regclass::text AS name FROM audit.event LIMIT 1`)).rows[0].name;
      assert.match(partition, /^audit\.event_[0-9]{4}_[0-9]{2}$/);
      const privileged = await pool.connect();
      try {
        await privileged.query('BEGIN'); await privileged.query(`ALTER TABLE ${partition} DISABLE TRIGGER USER`);
        await privileged.query(`UPDATE ${partition} SET event_hash=$1 WHERE sequence=1`, ['f'.repeat(64)]);
        const tampered = await privileged.query('SELECT event_data,event_hash FROM audit.event ORDER BY sequence');
        assert.equal(verifyEvents(tampered.rows.map(row => ({ ...row.event_data, eventHash: row.event_hash }))).valid, false);
        await privileged.query('ROLLBACK');
      } finally { privileged.release(); }
    } finally { await pool.end(); }
  });
}
