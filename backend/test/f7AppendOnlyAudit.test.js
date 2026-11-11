const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { EVENTS, resolveEvent, resolveResidence, validateEventCatalog } = require('../src/audit/eventCatalog');
const { canonicalizeJcs1 } = require('../src/audit/canonicalJson');
const { createUuidV7, isUuidV7 } = require('../src/audit/uuidV7');
const { createAuditEvent } = require('../src/audit/event');
const { eventHash, GENESIS_HASH } = require('../src/audit/integrity');
const { createAppendService } = require('../src/audit/appendService');
const { verifyEvents } = require('../src/audit/verifier');
const { encodeCursor, decodeCursor } = require('../src/audit/cursor');
const { LIMITS, validateQuery } = require('../src/audit/queryPort');
const { auditMetric } = require('../src/audit/metrics');
const { classifyAuditReconciliation } = require('../src/audit/reconciliation');
const { createProductionCatalogs } = require('../src/authorization/catalogs');
const { load, manifest } = require('../src/audit/migrationManifest');
const { validateProductionAuditBootstrap } = require('../src/audit/productionAudit');
const { createCheckpointService, shouldCheckpoint } = require('../src/audit/checkpoint');
const { createF5AuditAdapter } = require('../src/audit/f5AuditAdapter');
const { createAuditIntent } = require('../src/audit/auditIntent');
const { createAuditExportService } = require('../src/audit/exportService');
const { createJobRegistry } = require('../src/async/jobRegistry');

const NOW = new Date('2026-10-08T12:00:00.000Z');
const id = byte => createUuidV7({ now: () => NOW.getTime(), randomBytes: size => Buffer.alloc(size, byte) });
const trusted = Object.freeze({ organizationId: '11111111-1111-4111-8111-111111111111', tenantId: null, operationAuthority: 'CENTRAL',
  operationCode: 'AUDIT_TEST', source: 'API', channel: 'HTTP', synchronous: true });
function input(overrides = {}) { return { eventCode: 'AUTHORIZATION_DENIED', actor: { type: 'HUMAN', id: 'actor-1', membershipId: 'member-1', serviceActorCode: null, supportGrantId: null },
  subject: { type: 'USER', id: 'subject-1' }, resource: { type: 'AUDIT_EVENT', id: 'resource-1' }, decision: 'DENY', outcome: 'DENIED',
  observedAt: NOW.toISOString(), correlationId: id(1), causationId: null, idempotencyKey: 'logical-1', streamType: 'ACCESS', payload: { detailCode: 'POLICY_DENIED' }, ...overrides }; }

test('F7-AC-01/02 catalog remains immutable after compatible F11 evolution and rejects unknown versions', () => {
  assert.equal(EVENTS.length,146); assert.equal(resolveEvent('APPLICATION_ALERT_READ').auditClass,'CRITICAL_PRE_EFFECT'); assert.equal(resolveEvent('APPLICATION_ALERT_CREATED').auditClass,'CRITICAL_PRE_EFFECT'); assert.equal(validateEventCatalog(), true);
  assert.equal(resolveEvent('AUTHORIZATION_DENIED', 1).auditClass, 'DENY_PRESERVING');
  assert.equal(resolveEvent('UNKNOWN', 1), null); assert.equal(resolveEvent('AUTHORIZATION_DENIED', 2), null);
  assert.throws(() => EVENTS.push({}), TypeError);
  const inconsistent = Object.freeze(EVENTS.map((entry, index) => index === 0
    ? Object.freeze({ ...entry, residencyRule: entry.residencyRule === 'CENTRAL_AUTHORITY' ? 'TENANT_AUTHORITY' : 'CENTRAL_AUTHORITY' }) : entry));
  assert.throws(() => validateEventCatalog(inconsistent), /approved contract/);
  assert.equal(resolveResidence(resolveEvent('SUPPORT_USED'), { operationAuthority: 'CENTRAL', tenantId: 'tenant-1' }), 'TENANT');
});

test('F7-AC-03/04 canonical JSON is stable and rejects unsafe values', () => {
  assert.equal(canonicalizeJcs1({ z: 1, a: 'ok', nested: { y: true, x: null } }), '{"a":"ok","nested":{"x":null,"y":true},"z":1}');
  assert.throws(() => canonicalizeJcs1({ value: 1.5 }), /safe integers/);
  assert.throws(() => canonicalizeJcs1({ value: 'e\u0301' }), /NFC/);
  assert.throws(() => canonicalizeJcs1(Object.create(null)), /plain JSON/);
  assert.throws(() => createAuditEvent({ trustedContext: trusted, input: input({ payload: { token: 'canary' } }), clock: () => NOW, uuid: () => id(2) }), /allowlisted/);
});

test('F7-AC-05/06 event derives residence and actor from trusted closed context', () => {
  const candidate = createAuditEvent({ trustedContext: trusted, input: input(), clock: () => NOW, uuid: () => id(2) });
  assert.equal(candidate.event.ledgerLocation, 'CENTRAL'); assert.equal(candidate.event.organizationId, trusted.organizationId);
  assert.equal(candidate.event.actor.type, 'HUMAN'); assert.ok(Object.isFrozen(candidate.event));
  assert.throws(() => createAuditEvent({ trustedContext: trusted, input: input({ actor: { ...input().actor, serviceActorCode: 'FORGED' } }), clock: () => NOW }), /discriminator/);
});

test('F7-AC-03/12 event enforces byte limits and synchronous skew', () => {
  assert.throws(() => createAuditEvent({ trustedContext: trusted, input: input({ observedAt: '2026-10-08T11:59:57.999Z' }), clock: () => NOW }), /skew/);
  assert.throws(() => createAuditEvent({ trustedContext: trusted, input: input({ payload: { detailCode: 'A'.repeat(9000) } }), clock: () => NOW }), /invalid|8 KiB/);
});

test('synchronous audit accepts two seconds in either direction and rejects larger skew', () => {
  for (const offset of [-2000, 2000]) {
    const observedAt = new Date(NOW.getTime() + offset).toISOString();
    assert.doesNotThrow(() => createAuditEvent({ trustedContext: trusted, input: input({ observedAt }), clock: () => NOW, uuid: () => id(2) }));
  }
  for (const offset of [-2001, 2001]) {
    const observedAt = new Date(NOW.getTime() + offset).toISOString();
    assert.throws(() => createAuditEvent({ trustedContext: trusted, input: input({ observedAt }), clock: () => NOW, uuid: () => id(2) }), /skew/);
  }
});

test('F7-AC-06 UUIDv7 is RFC-shaped and time ordered', () => {
  const first = createUuidV7({ now: () => 1000, randomBytes: size => Buffer.alloc(size, 0) });
  const second = createUuidV7({ now: () => 1001, randomBytes: size => Buffer.alloc(size, 0) });
  assert.ok(isUuidV7(first)); assert.ok(first < second); assert.equal(first[14], '7');
});

test('F7-AC-07/10/11 append is chained, idempotent and verifier detects gaps', async () => {
  const candidate = createAuditEvent({ trustedContext: trusted, input: input(), clock: () => NOW, uuid: () => id(2) });
  const rows = []; const port = { async prepare() { return { duplicate: false, acceptedAt: NOW.toISOString(), streamId: `${trusted.organizationId}:ACCESS`, sequence: 1, previousHash: GENESIS_HASH, reservation: {} }; }, async append(record) { rows.push(record.event); return { status: 'APPENDED', eventId: record.event.eventId, eventHash: record.event.eventHash }; } };
  const telemetry=[];await createAppendService({ appendPort: port,telemetryPort:{record:(...value)=>telemetry.push(value)} }).append(candidate, {});
  assert.equal(telemetry[0][0],'F7');
  assert.equal(rows.length, 1); assert.equal(rows[0].eventHash, eventHash(Object.fromEntries(Object.entries(rows[0]).filter(([key]) => key !== 'eventHash'))));
  assert.equal(verifyEvents(rows).valid, true);
  assert.deepEqual(verifyEvents([{ ...rows[0], sequence: 2 }]), { valid: false, sequence: 1, reasonCode: 'AUDIT_CHAIN_GAP' });
  assert.equal(verifyEvents([{ ...rows[0], outcome: 'ALLOWED' }]).reasonCode, 'AUDIT_HASH_MISMATCH');
});

test('F7-AC-14/16 cursor and query are organization/filter bound', () => {
  const filters = { from: '2026-10-01T00:00:00.000Z', to: '2026-10-08T00:00:00.000Z' };
  const cursor = encodeCursor({ organizationId: trusted.organizationId, acceptedAt: NOW.toISOString(), eventId: id(3), filters });
  assert.equal(decodeCursor(cursor, { organizationId: trusted.organizationId, filters }).organizationId, trusted.organizationId);
  assert.throws(() => decodeCursor(cursor, { organizationId: 'other', filters }), /mismatch/);
  assert.equal(validateQuery({ filters }, trusted).pageSize, 50);
  assert.throws(() => validateQuery({ filters, pageSize: 101 }, trusted), /page size/);
  assert.equal(LIMITS.maxExportRows, 100000);
});

test('F7-AC-15 F5 adds only audit permissions and all profiles remain empty', () => {
  const catalogs = createProductionCatalogs({ catalogVersion: 'f7' });
  assert.deepEqual(catalogs.permissionCatalog.permissions.map(item => item.code), ['audit_event.read', 'audit_event.verify', 'audit_event.export', 'audit_event.read_cross_organization']);
  assert.ok(catalogs.profileCatalog.profiles.every(profile => profile.permissions.length === 0));
  assert.equal(catalogs.operationCatalog.resolve('UNKNOWN'), null);
  assert.equal(createProductionCatalogs({ catalogVersion: 'f5' }).permissionCatalog.size, 0);
});

test('F7-AC-17/18/19 four audit classes preserve fail-closed behavior', async () => {
  const criticalInput = input({ eventCode: 'GRANT_CHANGED' });
  const adapter = createF5AuditAdapter({ appendService: {}, outboxPort: { async persistAuditIntent() { throw new Error('offline'); } }, clock: () => NOW, metrics: { record() {} } });
  await assert.rejects(adapter.accept({ trustedContext: trusted, input: criticalInput }), error => error.code === 'AUDIT_CRITICAL_UNAVAILABLE');
  const deny = await adapter.accept({ trustedContext: trusted, input: input() }); assert.equal(deny.status, 'DENY_AUDIT_UNAVAILABLE');
  const observational = await adapter.accept({ trustedContext: trusted, input: input({ eventCode: 'AUTHORIZATION_ALLOWED' }) }); assert.equal(observational.status, 'RECONCILIATION_REQUIRED');
});

test('F7-AC-13/19 audit intent uses the closed F9 envelope', () => {
  const candidate = createAuditEvent({ trustedContext: trusted, input: input(), clock: () => NOW, uuid: () => id(2) });
  const registry = createJobRegistry([{ type: 'audit.append', version: 1, payloadVersion: 1, handler() {} }]);
  const envelope = createAuditIntent({ candidate, trustedContext: { organizationId: trusted.organizationId,
    actor: { kind: 'SERVICE', serviceActorCode: 'F7_TEST' } }, registry, clock: () => NOW, executionId: id(4) });
  assert.equal(envelope.envelope.jobType, 'audit.append'); assert.equal(envelope.envelope.payload.inputDigest, candidate.digest);
});

test('F7-AC-10/11 checkpoints are due at 10k or month sealing only', async () => {
  assert.equal(shouldCheckpoint(9999), false); assert.equal(shouldCheckpoint(10000), true); assert.equal(shouldCheckpoint(7, { monthBoundary: true }), true);
  const persisted = []; const service = createCheckpointService({ port: { async persist(value) { persisted.push(value); return { status: 'ACCEPTED' }; } } });
  assert.equal((await service.seal({ streamId: 'org:ACCESS', firstSequence: 1, lastSequence: 9999, firstHash: 'a'.repeat(64), lastHash: 'b'.repeat(64) })).status, 'NOT_DUE');
  await service.seal({ streamId: 'org:ACCESS', firstSequence: 1, lastSequence: 10000, firstHash: 'a'.repeat(64), lastHash: 'b'.repeat(64) }); assert.equal(persisted.length, 1);
});

test('F7-AC-15/16 export reauthorizes, audits and keeps the sink local', async () => {
  const calls = []; const service = createAuditExportService({ authorization: { async require(code) { calls.push(code); } },
    audit: { async acceptCritical(code) { calls.push(code); } }, queue: { async publish(job) { return job; } }, sink: { async consume(job) { return { rows: 0, limits: job.limits }; } } });
  const filters = { from: '2026-10-01T00:00:00.000Z', to: '2026-10-08T00:00:00.000Z' };
  const job = await service.request({ filters }, trusted); assert.equal(job.limits.maxRows, 100000);
  await assert.rejects(service.request({ filters: { ...filters, sql: 'SELECT canary' } }, trusted), /not allowlisted/);
  const result = await service.execute(job, trusted, new AbortController().signal); assert.equal(result.limits.maxBytes, 100 * 1024 * 1024);
  assert.deepEqual(calls, ['audit_event.export', 'EXPORT_ALLOWED', 'audit_event.export', 'EXPORT_ALLOWED']);
});

test('F7-AC-18/19/24 reconciliation and metrics remain closed and sanitized', () => {
  assert.equal(classifyAuditReconciliation({ kind: 'AUDIT_INTENT_PENDING' }).automatic, true);
  assert.equal(classifyAuditReconciliation({ kind: 'AUDIT_CHAIN_GAP' }).requiresAuthority, true);
  assert.throws(() => classifyAuditReconciliation({ kind: 'DELETE_LEDGER' }), /invalid/);
  assert.deepEqual(auditMetric({ result: 'accepted', operation: 'append' }), { result: 'accepted', operation: 'append' });
  assert.throws(() => auditMetric({ organizationId: trusted.organizationId }), /invalid/);
});

test('F7-AC-08/09/22/25 migrations are fixed and contain append-only defenses', () => {
  for (const scope of ['central', 'tenant']) {
    const migration = load(scope); assert.equal(migration.checksum, manifest[scope].checksum);
    for (const clause of ['SECURITY DEFINER', 'SET search_path=pg_catalog,audit', 'BEFORE UPDATE OR DELETE', 'BEFORE TRUNCATE', 'FORCE ROW LEVEL SECURITY', 'event_default', 'REVOKE ALL', "'ASYNC_RECONCILIATION_REQUIRED'"]) assert.match(migration.sql, new RegExp(clause.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    assert.doesNotMatch(migration.sql, /DROP TABLE audit\.event|DELETE FROM audit\.event|pgcrypto/i);
  }
});

test('F7-AC-26 production composition claims no external sink or strong integrity', () => {
  const bootstrap = validateProductionAuditBootstrap();
  assert.equal(bootstrap.exportConsumerEnabled, false); assert.equal(bootstrap.externalSink, null); assert.equal(bootstrap.health.ready, false);
  const sources = fs.readFileSync(path.join(__dirname, '../src/audit/productionAudit.js'), 'utf8');
  assert.doesNotMatch(sources, /tamper-proof|WORM|HMAC/);
});
