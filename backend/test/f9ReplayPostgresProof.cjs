'use strict';
// Run only against a newly created disposable database, never an existing tenant.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const crypto = require('node:crypto');
const { Pool } = require('pg');
const { InboxRepository } = require('../src/async/inboxRepository');
const { OutboxRepository } = require('../src/async/outboxRepository');
const { createEnvelopeV2, createTrustedObservability, validateEnvelope } = require('../src/async/envelope');
const { replayEnvelope } = require('../src/async/deadLetter');
const { createJobRegistry } = require('../src/async/jobRegistry');
const { createWorkerProcessor } = require('../src/async/workerProcessor');
const { result } = require('../src/async/jobResult');

async function main() {
  if (process.env.F9_DISPOSABLE_PROOF !== 'yes' || !/^\d+$/.test(process.env.F9_DISPOSABLE_PORT || '')) throw Error('DISPOSABLE_DATABASE_REQUIRED');
  const pool = new Pool({ host: '127.0.0.1', port: Number(process.env.F9_DISPOSABLE_PORT), user: 'postgres', database: 'postgres', max: 8 });
  const tx = async fn => { const c = await pool.connect(); try { await c.query('BEGIN'); const v = await fn(c); await c.query('COMMIT'); return v; } catch (e) { await c.query('ROLLBACK'); throw e; } finally { c.release(); } };
  try {
    assert.equal((await pool.query("SELECT count(*)::int n FROM pg_namespace WHERE nspname='async_exec'")).rows[0].n, 0);
    await pool.query('CREATE ROLE c4g_tenant_owner; CREATE ROLE c4g_tenant_runtime; CREATE ROLE c4g_opportunity_tenant_runtime');
    const sql1 = fs.readFileSync('database/tenant/migrations/001_f9_async_execution.up.sql', 'utf8');
    const sql5 = fs.readFileSync('database/tenant/migrations/005_f9_execution_lineage.up.sql', 'utf8').split('ALTER TABLE audit.event_identity')[0];
    await tx(async c => { await c.query(sql1); await c.query(sql5); });
    const inbox = new InboxRepository(), outbox = new OutboxRepository();
    const org = crypto.randomUUID(), root = crypto.randomUUID(), request = crypto.randomUUID();
    let effects = 0, entered; const enteredPromise = new Promise(resolve => { entered = resolve; });
    let release; const hold = new Promise(resolve => { release = resolve; });
    const registry = createJobRegistry([{ type: 'opportunity.duplicate.scan', version: 1, payloadVersion: 1, handler: async () => { effects++; entered(); await hold; return { jobResult: result('SUCCESS') }; } }]);
    const observed = createTrustedObservability({ traceparent: null, tracestate: null });
    const initial = createEnvelopeV2({ trustedContext: { organizationId: org, actor: { kind: 'SERVICE', serviceActorCode: 'F12_DUPLICATE_SCANNER' }, operation: 'opportunity.duplicate.review', correlationId: crypto.randomUUID(), causationId: crypto.randomUUID() }, job: { type: 'opportunity.duplicate.scan', version: 1, payloadVersion: 1, idempotencyKey: 'isolated-replay-proof' }, payload: { opportunityId: crypto.randomUUID() }, registry, observability: observed, id: () => root });
    const next = replayEnvelope({ original: initial.envelope, authorized: true, newExecutionId: crypto.randomUUID(), now: new Date(), observability: observed });
    const checked = validateEnvelope(next, registry);
    await tx(async c => {
      await outbox.enqueueLineage(c, { organizationId: org, logicalId: 'initial', envelope: initial.envelope, lineage: { deliveryKind: 'INITIAL', attempt: 1, rootExecutionId: root, previousExecutionId: null, contentDigest: initial.contentDigest, envelopeDigest: initial.envelopeDigest, replayRequestId: null } });
      const begun = await inbox.begin(c, { consumer: 'proof', jobType: next.jobType, jobVersion: 1, organizationId: org, idempotencyKey: next.idempotencyKey, envelope: initial.envelope, executionId: root, owner: 'old', leaseUntil: new Date(Date.now() + 30000) });
      assert.equal(begun.status, 'CLAIMED');
      assert.equal(await inbox.transition(c, { consumer: 'proof', jobType: next.jobType, jobVersion: 1, organizationId: org, idempotencyKey: next.idempotencyKey, owner: 'old', fence: 1, state: 'FAILED', resultCode: 'PERMANENT' }), true);
      const admission = { consumer: 'proof', jobType: next.jobType, jobVersion: 1, organizationId: org, idempotencyKey: next.idempotencyKey, envelope: next, executionId: next.executionId, owner: 'unauthorized', leaseUntil: new Date(Date.now() + 30000) };
      assert.equal((await inbox.begin(c, { ...admission, replay: true })).status, 'BUSY');
      await outbox.enqueueLineage(c, { organizationId: org, logicalId: 'replay', envelope: next, lineage: { deliveryKind: 'REPLAY', attempt: 1, rootExecutionId: root, previousExecutionId: root, contentDigest: checked.contentDigest, envelopeDigest: checked.envelopeDigest, replayRequestId: request } });
      assert.equal((await inbox.begin(c, { ...admission, replay: false })).status, 'BUSY');
    });
    const delivery = { id: 'delivery', envelope: next, attempt: 1, redelivery: false, replay: true, rootExecutionId: root };
    const lifecycle = { execute: async (_e, fn) => fn({ signal: new AbortController().signal }) };
    function processor(workerId, value = delivery) { let taken = false; const queue = { claim: async () => taken ? [] : (taken = true, [value]), heartbeat: async () => {}, complete: async () => {}, fail: async () => {}, cancel: async () => {}, deadLetter: async () => {} }; return createWorkerProcessor({ queue, registry, inbox, transactionResolver: { resolve: async () => tx }, lifecycle, consumer: 'proof', workerId }); }
    const first = processor('new-one').processOnce({ type: next.jobType });
    await enteredPromise;
    assert.deepEqual(await processor('new-two').processOnce({ type: next.jobType }), ['BUSY']);
    release(); assert.deepEqual(await first, ['SUCCESS']);
    assert.deepEqual(await processor('new-three').processOnce({ type: next.jobType }), ['DUPLICATE']);
    assert.equal(effects, 1);
    const row = (await pool.query('SELECT state,fence,execution_id FROM async_exec.inbox WHERE organization_id=$1', [org])).rows[0];
    assert.deepEqual(row, { state: 'COMPLETED', fence: '2', execution_id: next.executionId });
    assert.equal(await tx(c => inbox.complete(c, { consumer: 'proof', jobType: next.jobType, jobVersion: 1, organizationId: org, idempotencyKey: next.idempotencyKey, owner: 'old', fence: 1, resultCode: 'SUCCESS' })), false);
    console.log('PASS: FAILED -> durable REPLAY -> SUCCESS; missing proof and ordinary delivery BUSY; concurrent BUSY; duplicate; stale fence; one effect');
  } finally { await pool.end(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
