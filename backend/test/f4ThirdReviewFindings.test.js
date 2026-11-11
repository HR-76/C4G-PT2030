const assert = require('node:assert/strict');
const test = require('node:test');

const { createTenantHealthRepository } = require('../src/security/tenantHealthRepository');
const { createTenantProvisioningRepository } = require('../src/security/tenantProvisioningRepository');
const { createTenantConnectionRepository } = require('../src/security/tenantConnectionRepository');
const {
  canonicalize,
  findMatchingEvent,
  intentDigest,
  normalizeInstant
} = require('../src/security/tenantRepositorySupport');

test('Date values have distinct canonical representations', () => {
  assert.notEqual(
    canonicalize({ observedAt: new Date('2030-01-01T00:00:00.000Z') }),
    canonicalize({ observedAt: new Date('2040-01-01T00:00:00.000Z') })
  );
});

test('canonicalizer rejects objects outside its explicit domain', () => {
  for (const value of [new Map(), new Set(), /unsafe/, Object.create(null), { nested: new Map() }]) {
    assert.throws(() => canonicalize(value), TypeError);
  }
});

test('canonicalizer rejects undefined recursively instead of hashing a value JSON cannot preserve', () => {
  for (const value of [undefined, { nested: undefined }, [undefined], { nested: [{ value: undefined }] }]) {
    assert.throws(() => canonicalize(value), TypeError);
  }
});

test('canonicalizer rejects array properties and accessors without executing them', () => {
  const withSymbol = [1];
  withSymbol[Symbol('hidden')] = 2;
  let getterCalls = 0;
  const withAccessor = [];
  Object.defineProperty(withAccessor, '0', { enumerable: true, get() { getterCalls++; return 1; } });
  withAccessor.length = 1;
  assert.throws(() => canonicalize(withSymbol), TypeError);
  assert.throws(() => canonicalize(withAccessor), TypeError);
  assert.equal(getterCalls, 0);
});

test('canonicalizer accepts only native unmodified Date instances', () => {
  class DateSubclass extends Date {}
  const withOwnProperty = new Date('2030-01-01T00:00:00.000Z');
  withOwnProperty.extra = true;
  const overridden = new Date('2030-01-01T00:00:00.000Z');
  overridden.toISOString = () => '2040-01-01T00:00:00.000Z';
  for (const value of [new DateSubclass('2030-01-01T00:00:00.000Z'), withOwnProperty, overridden]) {
    assert.throws(() => canonicalize(value), TypeError);
  }
  assert.equal(canonicalize(new Date('2030-01-01T00:00:00.000Z')), 'date:"2030-01-01T00:00:00.000Z"');
});

test('timestamp normalization rejects Date subclasses and own properties without executing accessors', () => {
  class DateSubclass extends Date {}
  const withAccessor = new Date('2030-01-01T00:00:00.000Z');
  let getterCalls = 0;
  Object.defineProperty(withAccessor, 'getTime', { get() { getterCalls++; return () => Date.parse('2040-01-01T00:00:00.000Z'); } });
  assert.throws(() => normalizeInstant(withAccessor, 'observedAt'), error => error.code === 'TRANSITION_CONFLICT');
  assert.throws(() => normalizeInstant(new DateSubclass('2050-01-01T00:00:00.000Z'), 'observedAt'), error => error.code === 'TRANSITION_CONFLICT');
  assert.equal(getterCalls, 0);
  assert.equal(normalizeInstant(new Date('2030-01-01T00:00:00.000Z'), 'observedAt'), '2030-01-01T00:00:00.000Z');
});

test('schema JSON payload containing undefined is rejected before client acquisition', async () => {
  let acquired = false;
  const { createTenantSchemaRepository } = require('../src/security/tenantSchemaRepository');
  const repository = createTenantSchemaRepository({ connect: async () => { acquired = true; throw new Error('must not connect'); } });
  await assert.rejects(() => repository.recordObservation({
    tenantId: 'tenant-a', expectedRevision: 1, compatibilityState: 'COMPATIBLE', currentVersion: '1',
    targetVersion: '1', minimumReadVersion: '1', minimumWriteVersion: '1',
    verifiedCapabilities: { nested: [{ value: undefined }] }, correlationId: 'correlation-a', idempotencyKey: 'schema-a'
  }), TypeError);
  assert.equal(acquired, false);
});

test('schema JSON payload must preserve its canonical value through a JSON round trip', async () => {
  let acquired = 0;
  const { createTenantSchemaRepository } = require('../src/security/tenantSchemaRepository');
  const repository = createTenantSchemaRepository({ connect: async () => { acquired++; throw new Error('must not connect'); } });
  for (const verifiedCapabilities of [{ value: -0 }, { when: new Date('2030-01-01T00:00:00.000Z') }]) {
    await assert.rejects(() => repository.recordObservation({
      tenantId: 'tenant-a', expectedRevision: 1, compatibilityState: 'COMPATIBLE', currentVersion: '1',
      targetVersion: '1', minimumReadVersion: '1', minimumWriteVersion: '1',
      verifiedCapabilities, correlationId: 'correlation-a', idempotencyKey: 'schema-a'
    }), TypeError);
  }
  assert.equal(acquired, 0);
});

test('event matching rejects an altered payload', async () => {
  const event = {
    tenantId: 'tenant-a', aggregateType: 'HEALTH', aggregateId: 'tenant-a',
    actionCode: 'HEALTH_OBSERVED', toState: 'HEALTHY', correlationId: 'correlation-a',
    idempotencyKey: 'health-a', payload: { connectionVersion: 1 }, intent: { tenantId: 'tenant-a' }
  };
  const client = { query: async () => ({ rowCount: 1, rows: [{
    tenant_id: 'tenant-a', organization_id: null, aggregate_type: 'HEALTH', aggregate_id: 'tenant-a',
    action_code: 'HEALTH_OBSERVED', from_state: null, to_state: 'HEALTHY', reason_code: null,
    correlation_id: 'correlation-a', intent_digest: intentDigest({ intent: event.intent, payload: event.payload }),
    payload: { connectionVersion: 2 }
  }] }) };
  await assert.rejects(() => findMatchingEvent(client, event), error => error.code === 'TRANSITION_CONFLICT');
});

test('health retry rejects a different persisted timestamp snapshot', async () => {
  const eventIntent = {
    tenantId: 'tenant-a', connectionVersion: 1, healthState: 'HEALTHY', probeType: 'SYNTHETIC',
    observedAt: '2030-01-01T00:00:00.000Z', expiresAt: '2030-01-01T00:01:00.000Z',
    lastErrorCode: null, expectedRevision: null
  };
  const steps = [
    { rows: [] },
    { rowCount: 1, rows: [{
      tenant_id: 'tenant-a', organization_id: null, aggregate_type: 'HEALTH', aggregate_id: 'tenant-a',
      action_code: 'HEALTH_OBSERVED', from_state: null, to_state: 'HEALTHY', reason_code: null,
      correlation_id: 'correlation-a', intent_digest: intentDigest({ intent: eventIntent, payload: { connectionVersion: 1, resultingRevision: 1 } }), payload: { connectionVersion: 1, resultingRevision: 1 }
    }] },
    { rowCount: 1, rows: [{
      tenant_id: 'tenant-a', connection_version: '1', health_state: 'HEALTHY', probe_type: 'SYNTHETIC',
      observed_at: new Date('2030-01-02T00:00:00.000Z'), expires_at: new Date('2030-01-02T00:01:00.000Z'),
      last_error_code: null, revision: '2'
    }] },
    { rows: [] }
  ];
  const client = {
    async query() { return steps.shift() || { rows: [] }; },
    release() {}
  };
  const repository = createTenantHealthRepository({ connect: async () => client });
  await assert.rejects(() => repository.replaceSnapshot({
    tenantId: 'tenant-a', connectionVersion: 1, healthState: 'HEALTHY', probeType: 'SYNTHETIC',
    observedAt: new Date('2030-01-01T00:00:00.000Z'), expiresAt: '2030-01-01T00:01:00Z',
    correlationId: 'correlation-a', idempotencyKey: 'health-a'
  }), error => error.code === 'TRANSITION_CONFLICT');
});

test('timestamps are normalized before the health intent digest', async () => {
  const normalizedIntent = {
    tenantId: 'tenant-a', connectionVersion: 1, healthState: 'HEALTHY', probeType: 'SYNTHETIC',
    observedAt: '2030-01-01T00:00:00.000Z', expiresAt: '2030-01-01T00:01:00.000Z',
    lastErrorCode: null, expectedRevision: null
  };
  const steps = [
    { rows: [] },
    { rowCount: 1, rows: [{
      tenant_id: 'tenant-a', organization_id: null, aggregate_type: 'HEALTH', aggregate_id: 'tenant-a',
      action_code: 'HEALTH_OBSERVED', from_state: null, to_state: 'HEALTHY', reason_code: null,
      correlation_id: 'correlation-a', intent_digest: intentDigest({ intent: normalizedIntent, payload: { connectionVersion: 1, resultingRevision: 1 } }), payload: { connectionVersion: 1, resultingRevision: 1 }
    }] },
    { rowCount: 1, rows: [{
      tenant_id: 'tenant-a', connection_version: '1', health_state: 'HEALTHY', probe_type: 'SYNTHETIC',
      observed_at: new Date(normalizedIntent.observedAt), expires_at: new Date(normalizedIntent.expiresAt),
      last_error_code: null, revision: '1'
    }] },
    { rows: [] }
  ];
  const client = { async query() { return steps.shift() || { rows: [] }; }, release() {} };
  const repository = createTenantHealthRepository({ connect: async () => client });
  const result = await repository.replaceSnapshot({
    tenantId: 'tenant-a', connectionVersion: 1, healthState: 'HEALTHY', probeType: 'SYNTHETIC',
    observedAt: new Date(normalizedIntent.observedAt), expiresAt: '2030-01-01T00:01:00Z',
    correlationId: 'correlation-a', idempotencyKey: 'health-a'
  });
  assert.equal(result.revision, '1');
});

test('unsafe provisioning step code is rejected before client acquisition', async () => {
  let acquired = false;
  const repository = createTenantProvisioningRepository({ connect: async () => { acquired = true; throw new Error('must not connect'); } });
  await assert.rejects(() => repository.start({
    organizationId: 'organization-a', manifestVersion: '1',
    currentStepCode: 'postgresql://user:pass@host/db', correlationId: 'correlation-a', idempotencyKey: 'provision-a'
  }), error => error.code === 'TRANSITION_CONFLICT');
  assert.equal(acquired, false);
});

test('health retry rejects an otherwise identical snapshot with a different revision', async () => {
  const intent = {
    tenantId: 'tenant-a', connectionVersion: 1, healthState: 'HEALTHY', probeType: 'SYNTHETIC',
    observedAt: '2030-01-01T00:00:00.000Z', expiresAt: '2030-01-01T00:01:00.000Z',
    lastErrorCode: null, expectedRevision: null
  };
  const payload = { connectionVersion: 1, resultingRevision: 1 };
  const steps = [
    { rows: [] },
    { rowCount: 1, rows: [{
      tenant_id: 'tenant-a', organization_id: null, aggregate_type: 'HEALTH', aggregate_id: 'tenant-a',
      action_code: 'HEALTH_OBSERVED', from_state: null, to_state: 'HEALTHY', reason_code: null,
      correlation_id: 'correlation-a', intent_digest: intentDigest({ intent, payload }), payload
    }] },
    { rowCount: 1, rows: [{
      tenant_id: 'tenant-a', connection_version: '1', health_state: 'HEALTHY', probe_type: 'SYNTHETIC',
      observed_at: new Date(intent.observedAt), expires_at: new Date(intent.expiresAt),
      last_error_code: null, revision: '2'
    }] },
    { rows: [] }
  ];
  const client = { async query() { return steps.shift() || { rows: [] }; }, release() {} };
  const repository = createTenantHealthRepository({ connect: async () => client });
  await assert.rejects(() => repository.replaceSnapshot({
    tenantId: intent.tenantId, connectionVersion: intent.connectionVersion,
    healthState: intent.healthState, probeType: intent.probeType,
    observedAt: intent.observedAt, expiresAt: intent.expiresAt,
    correlationId: 'correlation-a', idempotencyKey: 'health-a'
  }), error => error.code === 'TRANSITION_CONFLICT');
});

test('connection material is rejected before acquiring a client', async () => {
  let acquired = 0;
  const repository = createTenantConnectionRepository({ connect: async () => { acquired++; throw new Error('must not connect'); } });
  await assert.rejects(() => repository.createGeneration({
    tenantId: 'tenant-a', databaseGenerationId: 'generation-a',
    databaseRef: 'postgresql://user:pass@host/db', correlationId: 'correlation-a', idempotencyKey: 'generation-a'
  }), error => error.code === 'TRANSITION_CONFLICT');
  await assert.rejects(() => repository.createCandidateVersion({
    tenantId: 'tenant-a', databaseGenerationId: 'generation-a', databaseRef: 'safe-db',
    credentialRef: 'postgresql://user:pass@host/db', regionCode: 'EU', residencyPolicyVersion: '1',
    correlationId: 'correlation-b', idempotencyKey: 'candidate-a'
  }), error => error.code === 'TRANSITION_CONFLICT');
  assert.equal(acquired, 0);
});

for (const [method, reasonCode] of [
  ['beginVersionDraining', 'ROTATION_STARTED'],
  ['revokeVersion', 'ROTATION_FINISHED'],
  ['markVersionFailed', 'PROBE_FAILED']
]) test(`current version cannot run ${method} through the repository`, async () => {
  const calls = [];
  const client = {
    async query(sql) {
      calls.push(String(sql));
      if (String(sql) === 'BEGIN' || String(sql) === 'ROLLBACK') return { rows: [] };
      if (/FROM public\.organization_connection.*FOR UPDATE/.test(sql)) return { rowCount: 1, rows: [{ current_connection_version: '1' }] };
      throw new Error('version mutation must not be reached');
    },
    release() { calls.push('RELEASE'); }
  };
  const repository = createTenantConnectionRepository({ connect: async () => client });
  await assert.rejects(() => repository[method]({
    tenantId: 'tenant-a', connectionVersion: 1, reasonCode,
    correlationId: 'correlation-a', idempotencyKey: `current-${method}`
  }), error => error.code === 'TRANSITION_CONFLICT');
  assert.equal(calls.filter(sql => /organization_connection.*FOR UPDATE/.test(sql)).length, 1);
  assert.equal(calls.some(sql => /UPDATE public\.organization_connection_version/.test(sql)), false);
  assert.deepEqual(calls.slice(-2), ['ROLLBACK', 'RELEASE']);
});
