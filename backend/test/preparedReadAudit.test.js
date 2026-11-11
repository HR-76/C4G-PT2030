'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {createTenantLeaseExecutor, deferPreparedReadAudit, flushPreparedReadAudit} = require('../src/security/tenantLeaseExecutor');
const {tenantFailure} = require('../src/security/tenantRuntimeErrors');
const {createManualClock, createManualScheduler, validSnapshot} = require('./support/tenantRuntimeDoubles');
const {createAuditEvent} = require('../src/audit/event');
const {createUuidV7} = require('../src/audit/uuidV7');
const {createAppendService} = require('../src/audit/appendService');
const {PostgresAppendRepository} = require('../src/audit/postgresAppendRepository');
const {createAuditCoordinator} = require('../src/authorization/audit');

function deferred() { let resolve; const promise = new Promise(done => { resolve = done; }); return {promise, resolve}; }
function harness({opportunity = false, interest = false, organizationId = 'org-1', operation = {}, prepare, append, commit} = {}) {
  const clock = createManualClock(), scheduler = createManualScheduler(clock);
  const snapshot = validSnapshot({organizationId, tenantId: 'tenant-' + organizationId});
  const state = {eligible: true, fence: 0, guardValid: true, role: 'login', prepared: null};
  const trace = [], pending = [], committed = [], outcomes = [], releases = [];
  let sequence = 0;
  const physical = {async query(sql, values) {
    trace.push(sql);
    if (sql.startsWith('SET LOCAL ROLE ')) state.role = sql.slice('SET LOCAL ROLE '.length);
    if (sql === 'RESET ROLE') state.role = 'login';
    if (sql.includes('FROM pg_stat_activity')) return {rows: [{pid: 1, backend_start: new Date(clock.now()).toISOString()}]};
    if (sql.startsWith('SELECT * FROM audit.prepare_append_v1')) {
      assert.equal(state.role, 'c4g_opportunity_tenant_runtime');
      await prepare?.({state, clock, trace});
      return {rows: [{stream_id: values[0] + ':' + values[1], sequence: ++sequence, previous_hash: null, accepted_at: new Date(clock.now())}]};
    }
    if (sql.startsWith('SELECT * FROM audit.append_event_v1')) {
      assert.equal(state.role, 'c4g_opportunity_tenant_runtime');
      const material = JSON.parse(values.at(-1));
      await append?.({state, clock, trace, material});
      pending.push(material);
      return {rows: [{status: 'APPENDED', event_id: material.eventId, event_hash: values[21]}]};
    }
    // The fake connection exposes the transaction boundary to these unit tests;
    // actual PostgreSQL durability/RLS remains an integration-gate requirement.
    if (sql === 'COMMIT') { committed.push(...pending.splice(0)); await commit?.(); }
    if (sql === 'ROLLBACK') pending.length = 0;
    return {rows: []};
  }};
  const executor = createTenantLeaseExecutor({clock, scheduler, poolManager: {getFence: () => state.fence},
    membershipRepository: {async revalidateContext() { trace.push('membership'); return state.eligible; }},
    directoryRepository: {async resolveSnapshotByOrganization() { trace.push('directory'); return snapshot; }},
    bindingVerifier: {async verify() { trace.push('physical:' + state.role); }}});
  function candidate({eventCode = 'AUTHORIZATION_ALLOWED', streamType = opportunity ? 'DATA' : 'ACCESS', tenantId = snapshot.tenantId,
    eventOrganizationId = organizationId, large = false, ...overrides} = {}) {
    return createAuditEvent({clock: () => new Date(clock.now()), trustedContext: {organizationId: eventOrganizationId, tenantId,
      operationAuthority: 'TENANT', operationCode: interest ? 'OPPORTUNITY_INTEREST_READ' : opportunity ? 'OPPORTUNITY_READ' : 'APPLICATION_READ', source: 'API', channel: 'APPLICATION', synchronous: true},
    input: {eventCode, actor: {type: 'HUMAN', id: large ? 'u'.repeat(128) : 'user-1', membershipId: large ? 'm'.repeat(128) : 'member-1', serviceActorCode: null, supportGrantId: null},
      subject: large ? {type: 'USER', id: 's'.repeat(128)} : null, resource: {type: interest ? 'OPPORTUNITY_INTEREST' : opportunity ? 'OPPORTUNITY' : 'APPLICATION', id: large ? 'r'.repeat(128) : 'resource-1'},
      decision: eventCode === 'AUTHORIZATION_DENIED' ? 'DENY' : 'ALLOW', outcome: eventCode === 'AUTHORIZATION_DENIED' ? 'DENIED' : 'SUCCESS',
      observedAt: new Date(clock.now()).toISOString(), correlationId: createUuidV7({now: () => clock.now()}), causationId: null,
      idempotencyKey: large ? 'i'.repeat(128) : 'decision-' + sequence + '-' + trace.length, streamType,
      payload: large ? {detailCode: 'A'.repeat(64), policyVersion: 'p'.repeat(128), catalogVersion: 'c'.repeat(128),
        scopeType: 'S'.repeat(64), scopeDigest: 'a'.repeat(64), assuranceLevel: 'a'.repeat(256), previousVersion: 'v'.repeat(256), newVersion: 'n'.repeat(256), semanticDigest: 'b'.repeat(64)} : {detailCode: 'AUTHORIZED'}, ...overrides}});
  }
  function run(work) {
    const queryModule = Object.freeze({requiresAuditWrite: true,
      async execute({client}) { state.prepared = client; await client.query('SET LOCAL ROLE c4g_opportunity_tenant_runtime'); return work(client); },
      beforeCommit: ({client}) => client.query('RESET ROLE'),
      authorityGuard: Object.freeze({assert() { trace.push('guard'); if (!state.guardValid) throw tenantFailure('AUTHORITY_GUARD_STALE'); },
        async complete({outcome}) { outcomes.push(outcome); }})});
    const lease = executor.issue({allocation: {client: physical, deadline: clock.now() + 1000, fence: 0, async release(options) { releases.push(options); }},
      snapshot, organizationContext: {organizationId, membershipId: 'member-1', membershipVersion: 1},
      operation: {ownerModule: interest ? 'ORGANIZATIONAL_OPPORTUNITY_INTERESTS' : opportunity ? 'F12_PRIVATE_HTTP_RUNTIME' : 'APPLICATION_FIRST_SLICE', operationCode: interest ? 'OPPORTUNITY_INTEREST_READ' : opportunity ? 'OPPORTUNITY_READ' : 'APPLICATION_READ',
        accessMode: 'READ', requiredCapabilities: ['SYNTHETIC_QUERY'], queryModule, ...operation}, correlationId: 'synthetic'});
    return lease.execute({});
  }
  return {clock, scheduler, state, trace, pending, committed, outcomes, releases, physical, candidate, run};
}

test('every interest operation receives a physical transaction authority binding', async () => {
  for(const operationCode of ['OPPORTUNITY_INTEREST_READ','OPPORTUNITY_INTEREST_REGISTER','OPPORTUNITY_INTEREST_MANAGE']){
    const h=harness({operation:{ownerModule:'ORGANIZATIONAL_OPPORTUNITY_INTERESTS',operationCode,accessMode:operationCode.endsWith('_READ')?'READ':'WRITE'}});
    await h.run(async client=>{
      const binding=require('../src/security/tenantLeaseExecutor').preparedAuthorityBinding(client);
      assert.equal(binding.operationCode,operationCode);assert.equal(binding.sourceBinding.backendPid,1);
      assert.match(binding.transactionId,/^[a-f0-9-]{36}$/);
      return true;
    });
    assert(h.trace.includes('guard'));assert.deepEqual(h.outcomes,['COMMITTED']);
  }
});

test('interest reads admit audit writes only for their exact owner and operation', async () => {
  for(const [ownerModule,operationCode,mode] of [
    ['ORGANIZATIONAL_OPPORTUNITY_INTERESTS','OPPORTUNITY_INTEREST_READ','WRITE'],
    ['OTHER_MODULE','OPPORTUNITY_INTEREST_READ','ONLY'],
    ['ORGANIZATIONAL_OPPORTUNITY_INTERESTS','OTHER_READ','ONLY']
  ]){
    const h=harness({operation:{ownerModule,operationCode}});
    await h.run(async()=>true);
    assert(h.trace.includes('BEGIN TRANSACTION READ '+mode));
  }
});

test('eligible read policies stage evidence until final flush, retaining all checks after append and before commit', async () => {
  for (const policy of ['APPLICATION_BROWSE', 'APPLICATION_REPORT', 'APPLICATION_DASHBOARD', 'OPPORTUNITY_DASHBOARD', 'OPPORTUNITY_INTEREST_BROWSE']) {
    const h = harness({opportunity: policy === 'OPPORTUNITY_DASHBOARD', interest: policy === 'OPPORTUNITY_INTEREST_BROWSE'}), candidate = h.candidate();
    assert.equal(await h.run(async client => {
      assert.equal(deferPreparedReadAudit(client, policy, candidate), true);
      assert.equal(h.trace.some(sql => sql.startsWith('SELECT * FROM audit.')), false);
      assert.equal(h.committed.length, 0);
      return 'read-result';
    }), 'read-result');
    const at = h.trace.findIndex(sql => sql.startsWith('SELECT * FROM audit.append_event_v1'));
    assert.deepEqual(h.trace.slice(at + 1), ['RESET ROLE', 'physical:login', 'membership', 'directory', 'guard', 'COMMIT']);
    assert.equal(h.trace.filter(sql => sql === 'membership').length, 3);
    assert.equal(h.trace.filter(sql => sql.startsWith('physical:')).length, 2);
    assert.equal(h.committed.length, 1);
    assert.equal(h.committed[0].eventId, candidate.event.eventId);
    assert.equal(h.committed[0].observedAt, candidate.event.observedAt);
    assert.deepEqual(h.outcomes, ['COMMITTED']);
  }
});

for (const [policy,operationCode] of [['APPLICATION_DETAIL','APPLICATION_READ'],['APPLICATION_WORK_DETAIL','APPLICATION_WORK_READ'],['APPLICATION_DOCUMENT_DETAIL','APPLICATION_DOCUMENT_READ']]) {
 test(`${policy} stages allowed read evidence without holding the tenant audit lock during authority preparation`,async()=>{
  const h=harness({operation:{operationCode}});
  await h.run(async client=>{
   assert.equal(deferPreparedReadAudit(client,policy,h.candidate()),true);
   assert.equal(h.trace.some(sql=>sql.startsWith('SELECT * FROM audit.')),false);
   return 'detail';
  });
  assert(h.trace.some(sql=>sql.startsWith('SELECT * FROM audit.append_event_v1')));
  assert.deepEqual(h.outcomes,['COMMITTED']);
 });
 test(`${policy} never admits writes`,async()=>{
  const h=harness({operation:{operationCode,accessMode:'WRITE'}});
  await assert.rejects(h.run(client=>deferPreparedReadAudit(client,policy,h.candidate())),error=>error.internalCode==='READ_AUDIT_POLICY_INVALID');
 });
}

test('prefix flush preserves ordering before immediate critical evidence and leaves the read buffer open', async () => {
  const h = harness(), append = createAppendService({appendPort: new PostgresAppendRepository()});
  const first = h.candidate(), critical = h.candidate({eventCode: 'EXPORT_ALLOWED'}), last = h.candidate();
  await h.run(async client => {
    assert(deferPreparedReadAudit(client, 'APPLICATION_REPORT', first));
    assert.equal(deferPreparedReadAudit(client, 'APPLICATION_REPORT', critical), false);
    await flushPreparedReadAudit(client);
    await append.append(critical, client);
    assert.equal(h.pending.length, 2);
    assert(deferPreparedReadAudit(client, 'APPLICATION_REPORT', last));
    return true;
  });
  assert.deepEqual(h.committed.map(event => event.eventId), [first, critical, last].map(value => value.event.eventId));
});

test('unknown or expired prepared clients cannot enqueue or flush audit evidence', async () => {
  const h = harness();
  for (const client of [{}, h.physical]) {
    assert.throws(() => deferPreparedReadAudit(client, 'APPLICATION_BROWSE', h.candidate()), error => error.internalCode === 'READ_AUDIT_BINDING_INVALID');
    await assert.rejects(() => flushPreparedReadAudit(client), error => error.internalCode === 'READ_AUDIT_BINDING_INVALID');
  }
  await h.run(client => { deferPreparedReadAudit(client, 'APPLICATION_BROWSE', h.candidate()); return true; });
  assert.throws(() => deferPreparedReadAudit(h.state.prepared, 'APPLICATION_BROWSE', h.candidate()), error => error.internalCode === 'READ_AUDIT_BINDING_INVALID');
  await assert.rejects(() => flushPreparedReadAudit(h.state.prepared), error => error.internalCode === 'READ_AUDIT_BINDING_INVALID');
});

test('write operations, unknown policies and policy switching cannot acquire deferred audit authority', async () => {
  for (const variant of ['write', 'unknown', 'switch']) {
    const h = harness({operation: variant === 'write' ? {accessMode: 'WRITE'} : {}});
    await assert.rejects(() => h.run(client => {
      if (variant === 'switch') deferPreparedReadAudit(client, 'APPLICATION_BROWSE', h.candidate());
      try { deferPreparedReadAudit(client, variant === 'unknown' ? 'APPLICATION_EXPORT' : variant === 'switch' ? 'APPLICATION_REPORT' : 'APPLICATION_BROWSE', h.candidate()); }
      catch (error) { assert.equal(error.internalCode, 'READ_AUDIT_POLICY_INVALID'); }
      return true;
    }), error => error.internalCode === 'READ_AUDIT_POLICY_INVALID');
    assert.equal(h.trace.includes('COMMIT'), false);
  }
});

test('critical and deny candidates are not queued by the observational helper', async () => {
  const h = harness();
  await h.run(client => {
    for (const eventCode of ['EXPORT_ALLOWED', 'DOCUMENT_ALLOWED', 'SENSITIVE_ACTION_ALLOWED', 'AUTHORIZATION_DENIED']) {
      assert.equal(deferPreparedReadAudit(client, 'APPLICATION_BROWSE', h.candidate({eventCode})), false);
    }
    return true;
  });
  assert.equal(h.trace.some(sql => sql.startsWith('SELECT * FROM audit.')), false);
});

test('tenant, stream and decision mismatches taint the transaction even if a producer absorbs the error', async () => {
  for (const changes of [{tenantId: 'another-tenant'}, {eventOrganizationId: 'another-org'}, {streamType: 'DATA'}, {decision: 'DENY'}]) {
    const h = harness(); let refusal;
    await assert.rejects(() => h.run(client => {
      try { deferPreparedReadAudit(client, 'APPLICATION_BROWSE', h.candidate(changes)); } catch (error) { refusal = error; }
      return true;
    }));
    assert.equal(refusal?.code, 'READ_AUDIT_INVALID');
    assert.equal(h.trace.includes('COMMIT'), false);
    assert.equal(h.committed.length, 0);
  }
});

test('mutable or digest-mismatched candidates cannot reach the audit ledger', async () => {
  for (const transform of [candidate => ({...candidate}), candidate => Object.freeze({...candidate, digest: '0'.repeat(64)})]) {
    const h = harness(); let refusal;
    await assert.rejects(() => h.run(client => {
      try { deferPreparedReadAudit(client, 'APPLICATION_BROWSE', transform(h.candidate())); } catch (error) { refusal = error; }
      return true;
    }));
    assert.equal(refusal?.code, 'READ_AUDIT_INVALID');
    assert.equal(h.trace.some(sql => sql.startsWith('SELECT * FROM audit.')), false);
    assert.equal(h.trace.includes('COMMIT'), false);
  }
});

test('the event cap remains fatal when the F5 observational coordinator absorbs enqueue failure', async () => {
  const h = harness(); let accepted = 0, receipt, refusal;
  await assert.rejects(() => h.run(async client => {
    for (let index = 0; index < 128; index++) if (deferPreparedReadAudit(client, 'APPLICATION_BROWSE', h.candidate())) accepted++;
    const f5 = createAuditCoordinator({timeoutMs: 100, port: {accept() {
      deferPreparedReadAudit(client, 'APPLICATION_BROWSE', h.candidate()); return 'TRANSACTION_PENDING';
    }}});
    receipt = await f5.emit({eventId: 'decision', schemaVersion: 'f5-audit-v1', occurredAt: new Date(h.clock.now()).toISOString(),
      eventType: 'AUTHORIZATION_ALLOWED', actorType: 'HUMAN', actorId: 'user-1', membershipId: 'member-1', organizationId: 'org-1',
      operationCode: 'APPLICATION_READ', permissionCode: 'application.read', result: 'ALLOW', reasonCode: 'AUTHORIZED', correlationId: 'correlation'});
    try { await flushPreparedReadAudit(client); } catch (error) { refusal = error; }
    return true;
  }));
  assert.equal(accepted, 128);
  assert.equal(receipt?.outcome, 'REJECTED');
  assert.equal(refusal?.code, 'READ_AUDIT_LIMIT');
  assert.equal(h.trace.includes('COMMIT'), false);
  assert.equal(h.committed.length, 0);
});

test('the byte cap refuses large legitimate candidates before the event cap', async () => {
  const h = harness(); let accepted = 0, refusal;
  await assert.rejects(() => h.run(client => {
    for (; accepted < 128; accepted++) {
      try { deferPreparedReadAudit(client, 'APPLICATION_BROWSE', h.candidate({large: true})); }
      catch (error) { refusal = error; break; }
    }
    return true;
  }));
  assert.equal(refusal?.code, 'READ_AUDIT_LIMIT');
  assert(accepted > 0 && accepted < 128);
  assert.equal(h.trace.includes('COMMIT'), false);
});

test('revocation, fence changes, guard expiry and lease expiry during append wait cannot commit', async () => {
  for (const change of ['membership', 'fence', 'guard', 'lease']) {
    const started = deferred(), resume = deferred();
    const h = harness({prepare: async () => { started.resolve(); await resume.promise; }});
    const executing = h.run(client => { deferPreparedReadAudit(client, 'APPLICATION_BROWSE', h.candidate()); return true; });
    const expected = {membership: 'ORGANIZATION_MISMATCH', fence: 'TRANSITION_CONFLICT', guard: 'AUTHORITY_GUARD_STALE', lease: 'LEASE_TIMEOUT'}[change];
    const refused = assert.rejects(executing, error => error.internalCode === expected);
    await started.promise;
    if (change === 'membership') h.state.eligible = false;
    if (change === 'fence') h.state.fence++;
    if (change === 'guard') h.state.guardValid = false;
    if (change === 'lease') h.clock.advance(1000);
    resume.resolve();
    await refused;
    assert.equal(h.trace.includes('COMMIT'), false);
    assert(h.trace.includes('ROLLBACK'));
    assert.equal(h.committed.length, 0);
    assert.equal(h.pending.length, 0);
  }
});

test('failed append rolls back and a later attempt cannot replay abandoned buffered events', async () => {
  let failed = false;
  const h = harness({append: () => { if (!failed) { failed = true; throw new Error('synthetic append failure'); } }});
  const abandoned = h.candidate(), retried = h.candidate();
  await assert.rejects(() => h.run(client => { deferPreparedReadAudit(client, 'APPLICATION_BROWSE', abandoned); return true; }));
  assert.equal(failed, true);
  assert.equal(h.committed.length, 0);
  await h.run(client => { deferPreparedReadAudit(client, 'APPLICATION_BROWSE', retried); return true; });
  assert.deepEqual(h.committed.map(event => event.eventId), [retried.event.eventId]);
  assert.deepEqual(h.outcomes, ['ROLLED_BACK', 'COMMITTED']);
});

test('an uncertain commit never returns a successful read or treats the buffered event as rolled back', async () => {
  const h = harness({commit: () => { throw new Error('synthetic acknowledgement loss'); }});
  await assert.rejects(() => h.run(client => { deferPreparedReadAudit(client, 'APPLICATION_BROWSE', h.candidate()); return true; }),
    error => error.internalCode === 'COMMIT_UNCERTAIN');
  assert.equal(h.committed.length, 1);
  assert.deepEqual(h.outcomes, ['UNKNOWN']);
  assert.equal(h.trace.includes('ROLLBACK'), false);
});

test('concurrent tenant transactions keep their buffers and append clients isolated', async () => {
  const a = harness({organizationId: 'org-a'}), b = harness({organizationId: 'org-b'});
  const both = deferred(); let entered = 0;
  await Promise.all([a, b].map(h => h.run(async client => {
    deferPreparedReadAudit(client, 'APPLICATION_DASHBOARD', h.candidate());
    if (++entered === 2) both.resolve();
    await both.promise; return true;
  })));
  assert.deepEqual(a.committed.map(event => event.organizationId), ['org-a']);
  assert.deepEqual(b.committed.map(event => event.organizationId), ['org-b']);
  assert.notStrictEqual(a.state.prepared, b.state.prepared);
});

test('late enqueue during an active flush taints the transaction instead of losing an observation', async () => {
  let refusal;
  const h = harness({prepare: () => {
    try { deferPreparedReadAudit(h.state.prepared, 'APPLICATION_BROWSE', h.candidate()); } catch (error) { refusal = error; }
  }});
  await assert.rejects(() => h.run(client => { deferPreparedReadAudit(client, 'APPLICATION_BROWSE', h.candidate()); return true; }));
  assert.equal(refusal?.internalCode, 'READ_AUDIT_POLICY_INVALID');
  assert.equal(h.trace.includes('COMMIT'), false);
  assert.equal(h.pending.length, 0);
});

test('F5 transaction-pending is observational staging and cannot satisfy critical pre-effect acceptance', async () => {
  const f5 = createAuditCoordinator({timeoutMs: 100, port: {async accept() { return 'TRANSACTION_PENDING'; }}});
  const event = {eventId: 'decision', schemaVersion: 'f5-audit-v1', occurredAt: new Date().toISOString(),
    actorType: 'HUMAN', actorId: 'user-1', membershipId: 'member-1', organizationId: 'org-1', operationCode: 'APPLICATION_READ',
    permissionCode: 'application.read', result: 'ALLOW', reasonCode: 'AUTHORIZED', correlationId: 'correlation'};
  assert.deepEqual(await f5.emit({...event, eventType: 'AUTHORIZATION_ALLOWED'}), {auditClass: 'OBSERVATIONAL_RECONCILABLE', outcome: 'TRANSACTION_PENDING'});
  for (const eventType of ['EXPORT_ALLOWED', 'DOCUMENT_ALLOWED', 'SENSITIVE_ACTION_ALLOWED']) {
    await assert.rejects(() => f5.emit({...event, eventType}), {code: 'AUDIT_CRITICAL_UNAVAILABLE'});
  }
  assert.equal((await f5.emit({...event, eventType: 'AUTHORIZATION_DENIED', result: 'DENY'})).outcome, 'REJECTED');
});

test('interest read audit policy refuses writes and rolls back a revoked read after append',async()=>{
 const write=harness({interest:true,operation:{accessMode:'WRITE',operationCode:'OPPORTUNITY_INTEREST_REGISTER'}});
 await assert.rejects(write.run(client=>deferPreparedReadAudit(client,'OPPORTUNITY_INTEREST_BROWSE',write.candidate())),error=>error.internalCode==='READ_AUDIT_POLICY_INVALID');
 const revoked=harness({interest:true,append:({state})=>{state.eligible=false;}});
 await assert.rejects(revoked.run(client=>deferPreparedReadAudit(client,'OPPORTUNITY_INTEREST_BROWSE',revoked.candidate())));
 assert.equal(revoked.committed.length,0);assert(revoked.trace.includes('ROLLBACK'));
});

test('directory context observational audit remains synchronous and refuses write bindings',async()=>{
 const descriptor={ownerModule:'ORGANIZATION_DIRECTORY',operationCode:'ORGANIZATION_DIRECTORY_READ'};
 const h=harness({operation:descriptor});
 assert.equal(await h.run(client=>{assert(deferPreparedReadAudit(client,'DIRECTORY_CONTEXT',h.candidate()));assert.equal(h.committed.length,0);return 'context'}),'context');
 assert.equal(h.committed.length,1);
 const write=harness({operation:{...descriptor,accessMode:'WRITE'}});
 await assert.rejects(write.run(client=>deferPreparedReadAudit(client,'DIRECTORY_CONTEXT',write.candidate())));
 const broken=harness({operation:descriptor,append:()=>{throw Error('audit failed')}});
 await assert.rejects(broken.run(client=>deferPreparedReadAudit(client,'DIRECTORY_CONTEXT',broken.candidate())));
 assert.equal(broken.committed.length,0);
});
