const assert = require('node:assert/strict');
const test = require('node:test');
const { inspect } = require('node:util');
const { createTenantBindingVerifier } = require('../src/security/tenantBindingVerifier');
const { createTenantCredentialProvider } = require('../src/security/tenantCredentialProvider');
const { createTenantOperationCatalog } = require('../src/security/tenantOperationCatalog');
const { createTenantResolver } = require('../src/security/tenantResolver');
const { createMembershipRepository } = require('../src/security/membershipRepository');
const { createTenantDirectoryRepository, resolutionSnapshot } = require('../src/security/tenantDirectoryRepository');
const { createCredentialAdapter, createManualClock, createManualScheduler,
  syntheticCatalogConfiguration, validSnapshot } = require('./support/tenantRuntimeDoubles');

const queryModule = Object.freeze({ async execute({ input }) { return input; } });
const operationAdapter = Object.freeze({ operationCode: 'SYNTHETIC_QUERY', queryModule });
const context = Object.freeze({ organizationId: 'org-1', membershipId: 'membership-1', membershipVersion: 2 });

function structuralText(value, seen = new Set()) {
  if (value === null || value === undefined) return String(value);
  if (typeof value !== 'object') return String(value);
  if (seen.has(value)) return '[circular]';
  seen.add(value);
  return Reflect.ownKeys(Object.getOwnPropertyDescriptors(value)).map(key => {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return descriptor && 'value' in descriptor ? `${String(key)}:${structuralText(descriptor.value, seen)}` : String(key);
  }).join('|');
}

function setup({ snapshots = [validSnapshot()], binding = null, eligible = true } = {}) {
  const clock = createManualClock();
  const scheduler = createManualScheduler(clock);
  const membershipCalls = [];
  const membershipRepository = { async revalidateContext(value) { membershipCalls.push(value); return eligible ? value : null; } };
  let index = 0;
  const directoryCalls = [];
  const directoryRepository = { async resolveSnapshotByOrganization(organizationId, workload) {
    if (!['API', 'WORKER'].includes(workload)) throw new TypeError('Tenant workload is required.');
    directoryCalls.push({ organizationId, workload });
    return snapshots[Math.min(index++, snapshots.length - 1)];
  } };
  const credentialAdapter = createCredentialAdapter();
  const credentialProvider = createTenantCredentialProvider(credentialAdapter);
  const releases = [];
  const allocations = [];
  const poolManager = { async acquire(request) {
    await request.credentialLease.dispose();
    const allocation = { client: {}, tenantId: request.tenantId, connectionVersion: request.connectionVersion,
      fence: 0, deadline: clock.now() + 1000,
      async release(options) { releases.push(options || {}); } };
    allocations.push(allocation);
    return allocation;
  } };
  const observed = binding || { tenantId: 'tenant-1', databaseGenerationId: 'generation-1', systemIdentifier: 'system-1',
    bindingDigest: 'digest-1', schemaVersion: '1', schemaFingerprint: 'fingerprint-1', capabilities: ['SYNTHETIC_QUERY'] };
  const bindingVerifier = createTenantBindingVerifier({ async observe() { return observed; } });
  const catalog = createTenantOperationCatalog(syntheticCatalogConfiguration(queryModule));
  const issued = [];
  const leaseExecutor = { issue(record) { issued.push(record); return Object.freeze({ lease: true }); } };
  const resolver = createTenantResolver({ membershipRepository, directoryRepository, operationCatalog: catalog,
    credentialProvider, bindingVerifier, poolManager, leaseExecutor, regionPolicy: { allows: code => code === 'EU_TEST' },
    clock, scheduler, maxAttempts: 2 });
  return { resolver, issued, releases, allocations, membershipCalls, directoryCalls, credentialAdapter, clock, scheduler };
}

test('resolver issues a lease only for the registered operation and matching tenant binding', async () => {
  const state = setup({ snapshots: [validSnapshot(), validSnapshot()] });
  const lease = await state.resolver.resolve({ organizationContext: context, operationAdapter, correlationId: 'correlation-1' });
  assert.deepEqual(lease, { lease: true });
  assert.equal(state.issued.length, 1);
  assert.equal(state.issued[0].snapshot.tenantId, 'tenant-1');
  assert.equal(state.credentialAdapter.disposals, 1);
  assert.equal(state.releases.length, 0);
});

test('resolver preserves API and WORKER through the real directory repository and revalidation', async t => {
  for (const workload of ['API', 'WORKER']) await t.test(workload, async () => {
    const calls = [];
    const snapshot = validSnapshot({ workload });
    const row = { organization_id:snapshot.organizationId,tenant_id:snapshot.tenantId,workload,
      deployment_mode:snapshot.deploymentMode,provisioning_status:snapshot.provisioningStatus,
      current_connection_version:String(snapshot.connectionVersion),operational_state:snapshot.connectionState,
      connection_revision:String(snapshot.connectionRevision),version_state:snapshot.versionState,
      database_generation_id:snapshot.databaseGenerationId,database_ref:snapshot.databaseRef,
      credential_ref:snapshot.credentialRef,workload_fence:0,region_code:snapshot.regionCode,
      residency_policy_version:snapshot.residencyPolicyVersion,observed_system_identifier:snapshot.observedSystemIdentifier,
      binding_digest:snapshot.bindingDigest,compatibility_state:snapshot.schema.compatibilityState,
      current_version:snapshot.schema.currentVersion,minimum_read_version:snapshot.schema.currentVersion,
      minimum_write_version:snapshot.schema.currentVersion,verified_capabilities:snapshot.schema.verifiedCapabilities,
      schema_revision:String(snapshot.schema.revision) };
    const directoryRepository=createTenantDirectoryRepository({async query(_sql,values){calls.push(values);return{rowCount:1,rows:[row]};}});
    const clock=createManualClock(),scheduler=createManualScheduler(clock);
    const resolver=createTenantResolver({clock,scheduler,maxAttempts:1,directoryRepository,
      membershipRepository:{async revalidateContext(value){return value;}},
      operationCatalog:{resolveAdapter(){return{requiredCapabilities:['SYNTHETIC_QUERY'],workload,workloadClass:'FUNCTIONAL',compatibleSchemaVersions:['1'],allowedCompatibilityStates:['COMPATIBLE'],readOnlyEligible:false,accessMode:'READ'};}},
      credentialProvider:{async resolve(input){assert.equal(input.workload,workload);return{workload,material:{},async dispose(){}};}},
      bindingVerifier:{async verify(){}},poolManager:{synchronizeFence(input){assert.equal(input.workload,workload);},async acquire(input){assert.equal(input.workload,workload);return{client:{},deadline:clock.now()+1000,async release(){}};}},
      leaseExecutor:{issue(record){assert.equal(record.snapshot.workload,workload);return{workload};}},regionPolicy:{allows:()=>true}});
    assert.deepEqual(await resolver.resolve({organizationContext:context,operationAdapter,correlationId:`real-${workload}`}),{workload});
    assert.deepEqual(calls,[[context.organizationId,workload],[context.organizationId,workload]]);
    await assert.rejects(()=>directoryRepository.resolveSnapshotByOrganization(context.organizationId),/workload/);
  });
});

test('resolver rejects additional client-controlled infrastructure fields before any dependency call', async () => {
  const state = setup();
  await assert.rejects(state.resolver.resolve({ organizationContext: context, operationAdapter,
    correlationId: 'c', tenantId: 'tenant-2' }), TypeError);
  assert.equal(state.membershipCalls.length, 0);
  assert.equal(state.directoryCalls.length, 0);
});

test('resolver fails closed for ineligible F3 context and each required directory gate', async t => {
  const ineligible = setup({ eligible: false });
  await assert.rejects(ineligible.resolver.resolve({ organizationContext: context, operationAdapter, correlationId: 'c' }),
    error => error.internalCode === 'ORGANIZATION_MISMATCH');
  const cases = [
    ['organization', { organizationId: 'org-2' }], ['provisioning', { provisioningStatus: 'RUNNING' }],
    ['connection', { connectionState: 'BLOCKED' }], ['version', { versionState: 'DRAINING' }],
    ['schema', { schema: { compatibilityState: 'INCOMPATIBLE' } }], ['region', { regionCode: 'US_TEST' }]
  ];
  for (const [name, overrides] of cases) await t.test(name, async () => {
    const state = setup({ snapshots: [validSnapshot(overrides)] });
    await assert.rejects(state.resolver.resolve({ organizationContext: context, operationAdapter, correlationId: 'c' }),
      error => error.internalCode === 'CONNECTION_NOT_AVAILABLE');
    assert.equal(state.issued.length, 0);
  });
});

test('physical substitution is rejected and the acquired client is discarded', async () => {
  const state = setup({ binding: { tenantId: 'tenant-2', databaseGenerationId: 'generation-1', systemIdentifier: 'system-1',
    bindingDigest: 'digest-1', schemaVersion: '1', schemaFingerprint: 'fingerprint-1', capabilities: ['SYNTHETIC_QUERY'] } });
  await assert.rejects(state.resolver.resolve({ organizationContext: context, operationAdapter, correlationId: 'c' }),
    error => error.internalCode === 'PHYSICAL_TENANT_MISMATCH');
  assert.equal(state.releases.length, 1);
  assert.equal(state.releases[0].discard, true);
  assert.equal(state.issued.length, 0);
  assert.equal(state.credentialAdapter.disposals, 1);
});

test('binding verification cannot retain an allocation beyond its lease deadline', async () => {
  const clock = createManualClock();
  const scheduler = createManualScheduler(clock);
  const releases = [];
  let markVerificationStarted;
  const verificationStarted = new Promise(resolve => { markVerificationStarted = resolve; });
  const resolver = createTenantResolver({ clock, scheduler, maxAttempts: 1,
    membershipRepository: { async revalidateContext(value) { return value; } },
    directoryRepository: { async resolveSnapshotByOrganization(_organizationId, workload) { if (workload !== 'API') throw new TypeError('workload'); return validSnapshot(); } },
    operationCatalog: { resolveAdapter() { return { requiredCapabilities: ['SYNTHETIC_QUERY'], workload:'API',workloadClass: 'FUNCTIONAL',
      compatibleSchemaVersions: ['1'], allowedCompatibilityStates: ['COMPATIBLE'], readOnlyEligible: false,
      accessMode: 'READ' }; } },
    credentialProvider: { async resolve() { return { material: {}, async dispose() {} }; } },
    bindingVerifier: { verify() { markVerificationStarted(); return new Promise(() => {}); } },
    poolManager: { async acquire(request) { await request.credentialLease.dispose(); return { client: {}, deadline: clock.now() + 10, fence: 0,
      async release(options) { releases.push(options); } }; } },
    leaseExecutor: { issue() { throw new Error('lease must not be issued'); } }, regionPolicy: { allows: () => true } });
  const resolution = resolver.resolve({ organizationContext: context, operationAdapter, correlationId: 'c' });
  await verificationStarted;
  await scheduler.advance(10);
  await assert.rejects(resolution, error => error.internalCode === 'LEASE_TIMEOUT');
  assert.equal(releases.length, 1);
  assert.equal(releases[0].discard, true);
  assert.equal(scheduler.size, 0);
});

test('snapshot change during acquisition discards stale state and retries the whole resolution', async () => {
  const changed = validSnapshot({ connectionRevision: 5 });
  const state = setup({ snapshots: [validSnapshot(), changed, validSnapshot(), validSnapshot()] });
  await state.resolver.resolve({ organizationContext: context, operationAdapter, correlationId: 'c' });
  assert.equal(state.allocations.length, 2);
  assert.equal(state.releases.length, 1);
  assert.equal(state.releases[0].discard, true);
  assert.equal(state.membershipCalls.length, 2);
  assert.equal(state.issued.length, 1);
});

test('membership repository revalidates the exact F3 context and version', async () => {
  const calls = [];
  const repository = createMembershipRepository({ async query(sql, values) {
    calls.push({ sql, values });
    return { rows: [{ membership_id: 'membership-1', organization_id: 'org-1', membership_version: '2',
      base_role_code: 'MEMBER', display_name: 'Synthetic', slug: 'synthetic' }] };
  } });
  const result = await repository.revalidateContext(context, 1_900_000_000_000);
  assert.equal(result.membershipVersion, 2);
  assert.deepEqual(calls[0].values.slice(0, 1).concat(calls[0].values.slice(2)), ['membership-1', 'org-1', 2]);
  assert.match(calls[0].sql, /om\.membership_version = \$4/);
  assert.match(calls[0].sql, /gu\.status = 'ACTIVE'/);
});

test('directory resolution snapshot is explicit, nested and immutable', () => {
  const row = { organization_id: 'org-1', tenant_id: 'tenant-1', deployment_mode: 'DATABASE_PER_ORGANIZATION',
    provisioning_status: 'READY', current_connection_version: '2', operational_state: 'AVAILABLE',
    connection_revision: '4', version_state: 'VALIDATED', database_generation_id: 'generation-1',
    database_ref: 'database-1', credential_ref: 'credential-1', region_code: 'EU_TEST',
    residency_policy_version: 'policy-1', observed_system_identifier: 'system-1', binding_digest: 'digest-1',
    compatibility_state: 'COMPATIBLE', current_version: '1', minimum_read_version: '1', minimum_write_version: '1',
    verified_capabilities: { SYNTHETIC_QUERY: true, schemaFingerprint: 'fingerprint-1' }, schema_revision: '3' };
  const snapshot = resolutionSnapshot(row);
  assert.equal(snapshot.connectionVersion, 2);
  assert.equal(snapshot.schema.revision, 3);
  assert.equal(snapshot.schema.schemaFingerprint, 'fingerprint-1');
  assert.equal(Object.isFrozen(snapshot), true);
  assert.equal(Object.isFrozen(snapshot.schema), true);
  assert.equal(Object.isFrozen(snapshot.schema.verifiedCapabilities), true);
});

test('credential and pool failures expose only stable sanitized runtime errors', async () => {
  const canary = 'postgresql://user:secret@private-host/private-db';
  const catalog = createTenantOperationCatalog(syntheticCatalogConfiguration(queryModule));
  const credentialProvider = createTenantCredentialProvider({ async resolve() { throw new Error(canary); } });
  const clock = createManualClock();
  const resolver = createTenantResolver({ membershipRepository: { async revalidateContext(value) { return value; } },
    directoryRepository: { async resolveSnapshotByOrganization(_organizationId, workload) { if (workload !== 'API') throw new TypeError('workload'); return validSnapshot(); } }, operationCatalog: catalog,
    credentialProvider, bindingVerifier: { async verify() {} }, poolManager: { async acquire(request) {
      await request.credentialLease.dispose();
      throw new Error(canary);
    } },
    leaseExecutor: { issue() {} }, regionPolicy: { allows: () => true }, clock,
    scheduler: createManualScheduler(clock), maxAttempts: 1 });
  await assert.rejects(resolver.resolve({ organizationContext: context, operationAdapter, correlationId: 'c' }), error => {
    assert.equal(error.internalCode, 'CREDENTIAL_UNAVAILABLE');
    assert.doesNotMatch(error.message, /secret|private-host|private-db/);
    assert.doesNotMatch(JSON.stringify(error), /secret|private-host|private-db/);
    return true;
  });
});

test('directory failures retain no unsanitized cause or canary in the runtime error graph', async () => {
  const canary = 'postgresql://user:secret@private-host/private-db';
  const catalog = createTenantOperationCatalog(syntheticCatalogConfiguration(queryModule));
  const clock = createManualClock();
  const resolver = createTenantResolver({ clock, scheduler: createManualScheduler(clock), maxAttempts: 1,
    membershipRepository: { async revalidateContext(value) { return value; } },
    directoryRepository: { async resolveSnapshotByOrganization(_organizationId, workload) { if (workload !== 'API') throw new TypeError('workload'); throw new Error(canary); } },
    operationCatalog: catalog, credentialProvider: {}, bindingVerifier: {}, poolManager: {}, leaseExecutor: {},
    regionPolicy: { allows: () => true } });
  await assert.rejects(resolver.resolve({ organizationContext: context, operationAdapter, correlationId: 'c' }), error => {
    assert.equal(error.name, 'TenantRuntimeError');
    assert.equal(error.internalCode, 'DIRECTORY_AMBIGUOUS');
    assert.equal(error.cause, undefined);
    assert.doesNotMatch(structuralText(error), /user:secret|private-host|private-db/);
    assert.doesNotMatch(inspect(error, { depth: null }), /user:secret|private-host|private-db/);
    return true;
  });
});
