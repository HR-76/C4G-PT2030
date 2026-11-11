'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { createActivationAuthorityV2 } = require('../src/opportunities/v2/activationAuthority');
const { createActivationAuditV2 } = require('../src/opportunities/v2/activationAudit');
const user = '01900000-0000-7000-8000-000000000001';
const plan = '01900000-0000-7000-8000-000000000002';
const context = () => ({ actor: { type: 'HUMAN', id: user }, sessionId: 'isolated-central-session', planId: plan, fence: 1 });
const config = () => ({ policyVersion: 'activation-test-v1', recentMfaRequirement: { mfa: true, maxAgeSeconds: 900,
  acceptedAcr: ['urn:c4g:mfa'], acceptedAmr: ['otp'], amrMode: 'any' } });
const valid = () => ({ userId: user, storedUserId: user, revocationVersion: 1, storedRevocationVersion: 1,
  policyVersion: 'activation-test-v1', absoluteExpiresAt: 2000000, expiresAt: 2000000, nowSeconds: 1000, cookieExpires: null,
  evidence: { authTime: 950, acr: 'urn:c4g:mfa', amr: ['otp'], policyVersion: 'activation-test-v1' } });
function fixture(authority = valid()) {
  const calls = [];
  return { calls, client: { async query(sql, params) { calls.push({ sql, params }); return { rows: authority ? [{ authority }] : [] }; } } };
}

test('activation requires a concrete recent authentication policy and rejects malformed configuration', () => {
  assert.throws(() => createActivationAuthorityV2(), TypeError);
  for (const change of [{ mfa: 'false' }, { acceptedAcr: [] }, { acceptedAmr: [] }, { maxAgeSeconds: 0 }, { maxAgeSeconds: 86401 }, { amrMode: 'unknown' }]) {
    const c = config(); Object.assign(c.recentMfaRequirement, change);
    assert.throws(() => createActivationAuthorityV2(c), TypeError);
  }
});

test('optional MFA policy accepts recent password authentication without fabricating MFA and rejects stale evidence', async () => {
  const c = { policyVersion: 'c4g-user-mfa-v1', recentMfaRequirement: require('../src/security/authConfig').RECOGNIZED_ASSURANCE_POLICIES['c4g-user-mfa-v1'].policy['recent-auth'] };
  const authority = createActivationAuthorityV2(c), record = valid();
  record.policyVersion = c.policyVersion;
  record.evidence = { authTime: 950, acr: 'c4g-loa1', amr: ['pwd'], policyVersion: c.policyVersion };
  assert.equal(await authority.authorize(fixture(record).client, context()), true);
  record.evidence.authTime = 99;
  assert.equal(await authority.authorize(fixture(record).client, context()), false);
  record.evidence.authTime = 950; record.evidence.policyVersion = 'old';
  assert.equal(await authority.authorize(fixture(record).client, context()), false);
});

test('current C4G actor is read through locked persisted authority, not caller MFA or cached roles', async () => {
  const f = fixture(), c = config(), authority = createActivationAuthorityV2(c);
  c.recentMfaRequirement.acceptedAmr[0] = 'forged';
  assert.equal(await authority.authorize(f.client, { ...context(), evidence: { forged: true }, platformRoles: [] }), true);
  assert.equal(await authority.assertAdministrator(f.client, context()), user);
  assert.deepEqual(f.calls[0], { sql: 'SELECT authority FROM authority_api.opportunity_v2_administrator($1::text,$2::uuid)', params: ['isolated-central-session', user] });
  const missing = fixture(null);
  assert.equal(await authority.authorize(missing.client, { ...context(), platformRoles: ['C4G_ADMIN'] }), false);
  await assert.rejects(authority.assertAdministrator(missing.client, context()), { code: 'OPPORTUNITY_V2_AUTHORITY_DENIED' });
});

test('activation refuses service, tenant membership, malformed context and getters before querying', async () => {
  const f = fixture(), authority = createActivationAuthorityV2(config());
  for (const bad of [null, {}, { actor: { type: 'SERVICE', id: 'FUNDING_TENDERS_CENTRAL' } },
    { ...context(), actor: { type: 'HUMAN', id: user, membershipId: user } }, { ...context(), sessionId: '' }]) {
    assert.equal(await authority.authorize(f.client, bad), false);
  }
  let touched = false; const hostile = context();
  Object.defineProperty(hostile, 'sessionId', { enumerable: true, get() { touched = true; return 'hostile'; } });
  assert.equal(await authority.authorize(f.client, hostile), false); assert.equal(touched, false); assert.equal(f.calls.length, 0);
});

test('persisted session identity, revocation, expiry, policy and MFA must all remain valid', async () => {
  const authority = createActivationAuthorityV2(config());
  const cases = [{ storedUserId: plan }, { userId: plan }, { storedRevocationVersion: 2 }, { revocationVersion: '1' },
    { absoluteExpiresAt: 1000000 }, { absoluteExpiresAt: '2000000' }, { expiresAt: 999999 }, { nowSeconds: null },
    { cookieExpires: 'invalid' }, { cookieExpires: '1970-01-01T00:10:00.000Z' }, { policyVersion: 'old' },
    ...[{ authTime: 99 }, { authTime: 1001 }, { authTime: null }, { acr: 'password' }, { amr: [] },
      { amr: null }, { amr: [42] }, { policyVersion: 'old' }].map(change => ({ evidence: { ...valid().evidence, ...change } }))];
  for (const change of cases) assert.equal(await authority.authorize(fixture({ ...valid(), ...change }).client, context()), false, JSON.stringify(change));
  assert.equal(await authority.authorize(fixture({ ...valid(), cookieExpires: '1970-01-01T00:30:00.000Z' }).client, context()), true);
});

test('authority errors remain fail closed and every call re-reads persisted authority', async () => {
  const authority = createActivationAuthorityV2(config()); let reads = 0;
  const client = { async query() { return { rows: ++reads === 1 ? [{ authority: valid() }] : [] }; } };
  assert.equal(await authority.authorize(client, context()), true); assert.equal(await authority.authorize(client, context()), false);
  await assert.rejects(authority.authorize({ async query() { throw Error('unavailable'); } }, context()), /unavailable/);
});

test('administrator result is bound to the validated context even if the caller mutates its object during a query', async () => {
  const raw = context(), authority = createActivationAuthorityV2(config());
  const client = { async query() { raw.actor.id = plan; return { rows: [{ authority: valid() }] }; } };
  assert.equal(await authority.assertAdministrator(client, raw), user);
});

function ledger({ failAppend = false } = {}) {
  const calls = [], events = [];
  const client = { async query(sql, values) {
    calls.push({ sql, values });
    if (sql.includes('prepare_platform_append_v1')) return { rows: [{ stream_id: 'PLATFORM:DATA', sequence: events.length + 1,
      previous_hash: '0'.repeat(64), accepted_at: new Date() }] };
    if (sql.includes('append_platform_event_v1')) {
      if (failAppend) throw Error('ledger unavailable');
      events.push(JSON.parse(values[22])); return { rows: [{ status: 'APPENDED', event_id: values[0], event_hash: values[21] }] };
    }
    throw Error('Unexpected SQL');
  } };
  return { client, calls, events };
}
const accepted = action => ({ operation: 'OPPORTUNITY_V2_ACCEPT', action, requestId: 'accepted-operation-1',
  opportunityId: user, revisionId: plan, approvalDigest: 'a'.repeat(64), context: context() });

test('accepted writes use the real platform audit append path and existing event taxonomy', async () => {
  const audit = createActivationAuditV2(), f = ledger();
  for (const action of ['CREATED', 'REVISION_CREATED', 'UNCHANGED']) assert.equal((await audit(f.client, accepted(action))).status, 'APPENDED');
  assert.deepEqual(f.events.map(event => event.eventCode), ['OPPORTUNITY_CREATED', 'OPPORTUNITY_REVISION_CREATED', 'OPPORTUNITY_PROVENANCE_LINKED']);
  for (const event of f.events) {
    assert.equal(event.organizationId, null); assert.equal(event.tenantId, null); assert.equal(event.actor.id, user);
    assert.equal(event.operationCode, 'OPPORTUNITY_CENTRAL_MANAGE'); assert.equal(event.ledgerLocation, 'CENTRAL');
    assert.equal(event.payload.semanticDigest, 'a'.repeat(64)); assert.match(event.payload.scopeDigest, /^[a-f0-9]{64}$/);
    assert.equal(JSON.stringify(event).includes('isolated-central-session'), false);
    assert.equal(JSON.stringify(event).includes('authTime'), false);
  }
  assert.equal(f.calls.every(call => call.sql.includes('audit.') && !/BEGIN|COMMIT|ROLLBACK/.test(call.sql)), true);
});

test('plan preparation, approval and revocation use operational ledger with durable plan binding', async () => {
  const audit = createActivationAuditV2(), f = ledger();
  for (const decision of ['PREPARED', 'APPROVED', 'REVOKED']) await audit.recordDecision(f.client, {
    context: context(), decision, planId: plan, planDigest: 'b'.repeat(64), requestId: 'decision-operation-1' });
  assert.deepEqual(f.events.map(event => event.eventCode), ['OPPORTUNITY_IMPORT_UPLOADED', 'OPPORTUNITY_IMPORT_CONFIRMED', 'OPPORTUNITY_IMPORT_CANCELLED']);
  for (const event of f.events) {
    assert.deepEqual(event.resource, { type: 'OPPORTUNITY_ACTIVATION_PLAN', id: plan });
    assert.equal(event.payload.semanticDigest, 'b'.repeat(64));
  }
});

test('audit failure propagates for transaction rollback and invalid audit operations produce no queries', async () => {
  const audit = createActivationAuditV2(), f = ledger();
  for (const event of [accepted('UNKNOWN'), { ...accepted('CREATED'), approvalDigest: 'wrong' },
    { ...accepted('CREATED'), context: { actor: { type: 'SERVICE', id: 'worker' } } }]) {
    await assert.rejects(audit(f.client, event), { code: 'OPPORTUNITY_V2_AUDIT_INVALID' });
  }
  await assert.rejects(audit.recordDecision(f.client, { decision: 'DELETE' }), { code: 'OPPORTUNITY_V2_AUDIT_INVALID' });
  assert.equal(f.calls.length, 0);
  await assert.rejects(audit(ledger({ failAppend: true }).client, accepted('CREATED')), /ledger unavailable/);
});

test('EU source control records exact critical events and source fence without inventing a plan or completed job',async()=>{
 const audit=createActivationAuditV2(),f=ledger(),ctx=context();delete ctx.planId;
 for(const action of ['SUSPEND','QUIESCE','RESUME'])await audit.recordSourceControl(f.client,{context:ctx,requestId:'source-control-operation',action,sourceFence:3});
 assert.deepEqual(f.events.map(e=>e.eventCode),['OPPORTUNITY_SOURCE_SUSPENSION_REQUESTED','OPPORTUNITY_SOURCE_QUIESCED','OPPORTUNITY_SOURCE_RESUMED']);
 for(const e of f.events){assert.deepEqual(e.resource,{type:'OPPORTUNITY_SOURCE',id:'EU'});assert.equal(e.payload.newVersion,3);assert.equal(e.payload.scopeType,'OPPORTUNITY_SOURCE');assert.equal(e.auditClass,'CRITICAL_PRE_EFFECT');}
 await assert.rejects(audit.recordSourceControl(f.client,{context:ctx,requestId:'source-control-operation',action:'DELETE',sourceFence:3}),{code:'OPPORTUNITY_V2_AUDIT_INVALID'});
});
