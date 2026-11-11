const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const { createTenantConnectionRepository } = require('../src/security/tenantConnectionRepository');
const { createTenantSchemaRepository } = require('../src/security/tenantSchemaRepository');
const { canonicalize, requireJsonRoundTrip } = require('../src/security/tenantRepositorySupport');

const migration = fs.readFileSync(path.resolve(__dirname, '../database/central/migrations/003_f4_tenant_directory.up.sql'), 'utf8');

function transactionalClient(respond) {
  const calls = [];
  return {
    calls,
    async query(sql, parameters) {
      const text = String(sql).trim();
      calls.push(text);
      if (['BEGIN', 'COMMIT', 'ROLLBACK'].includes(text)) return { rowCount: 0, rows: [] };
      return respond(text, parameters);
    },
    release() { calls.push('RELEASE'); }
  };
}

test('canonicalization rejects Proxy values without executing their get traps', () => {
  let gets = 0;
  const value = new Proxy({ safe: true }, { get(target, key, receiver) { gets++; return Reflect.get(target, key, receiver); } });
  assert.throws(() => canonicalize(value), TypeError);
  assert.throws(() => requireJsonRoundTrip(value, 'verifiedCapabilities'), TypeError);
  assert.equal(gets, 0);
});

test('schema migration lock reference is rejected before client acquisition', async () => {
  let acquired = 0;
  const repository = createTenantSchemaRepository({ connect: async () => { acquired++; throw new Error('must not connect'); } });
  await assert.rejects(() => repository.recordObservation({
    tenantId: 'tenant-a', expectedRevision: 1, compatibilityState: 'MIGRATING',
    currentVersion: '1', targetVersion: '2', minimumReadVersion: '1', minimumWriteVersion: '1',
    verifiedCapabilities: {}, migrationLockRef: 'postgresql://user:pass@host/db',
    lockExpiresAt: '2030-01-01T00:00:00Z', correlationId: 'correlation-a', idempotencyKey: 'schema-a'
  }), error => error.code === 'TRANSITION_CONFLICT');
  assert.equal(acquired, 0);
});

test('physical lock references use the same opaque-reference domain', () => {
  assert.match(migration, /migration_lock_ref IS NULL OR migration_lock_ref ~ '\^\[A-Za-z0-9\]/);
  assert.match(migration, /lock_ref IS NULL OR lock_ref ~ '\^\[A-Za-z0-9\]/);
});

test('blocked connection cannot return to available without a distinct validated version and readiness gates', async () => {
  const client = transactionalClient(async sql => {
    if (/tenant_directory_event/.test(sql)) return { rowCount: 0, rows: [] };
    if (/organization_connection/.test(sql) && /FOR UPDATE/.test(sql)) return { rowCount: 1, rows: [{ tenant_id: 'tenant-a', operational_state: 'BLOCKED', current_connection_version: '1', revision: '3' }] };
    if (/organization_connection_version/.test(sql) || /organization_provisioning/.test(sql) || /tenant_schema_state/.test(sql)) return { rowCount: 0, rows: [] };
    if (/UPDATE public\.organization_connection SET operational_state/.test(sql)) return { rowCount: 1, rows: [{ tenant_id: 'tenant-a', operational_state: 'AVAILABLE', current_connection_version: '1', revision: '4' }] };
    return { rowCount: 1, rows: [{}] };
  });
  const repository = createTenantConnectionRepository({ connect: async () => client });
  await assert.rejects(() => repository.restoreConnection({
    tenantId: 'tenant-a', connectionVersion: 2, expectedRevision: 3, reasonCode: 'RECOVERY_VERIFIED',
    correlationId: 'correlation-a', idempotencyKey: 'restore-a'
  }), error => error.code === 'TRANSITION_CONFLICT');
  assert.equal(client.calls.some(sql => /UPDATE public\.organization_connection SET operational_state/.test(sql)), false);
});

test('connection draining refuses an organization that is not terminating', async () => {
  const client = transactionalClient(async sql => {
    if (/tenant_directory_event/.test(sql)) return { rowCount: 0, rows: [] };
    if (/FROM public\.organization/.test(sql)) return { rowCount: 1, rows: [{ status: 'PROVISIONING' }] };
    if (/UPDATE public\.organization_connection/.test(sql)) return { rowCount: 1, rows: [{ operational_state: 'DRAINING' }] };
    return { rowCount: 0, rows: [] };
  });
  const repository = createTenantConnectionRepository({ connect: async () => client });
  await assert.rejects(() => repository.beginConnectionDraining({
    tenantId: 'tenant-a', expectedRevision: 1, reasonCode: 'OFFBOARDING_APPROVED',
    correlationId: 'correlation-a', idempotencyKey: 'drain-a'
  }), error => error.code === 'TRANSITION_CONFLICT');
  assert.equal(client.calls.some(sql => /UPDATE public\.organization_connection/.test(sql)), false);
});

test('physical lifecycle permits pointerless pending draining only for a terminating organization', () => {
  assert.match(migration, /operational_state='DRAINING'/);
  assert.match(migration, /status='TERMINATING'/);
  assert.doesNotMatch(migration, /operational_state IN \('AVAILABLE','BLOCKED','DRAINING'\) AND current_connection_version IS NOT NULL/);
});
