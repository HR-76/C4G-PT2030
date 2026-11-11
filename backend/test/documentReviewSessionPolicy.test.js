'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { createProductionCatalogs } = require('../src/authorization/catalogs');
const { createPolicyEngine } = require('../src/authorization/policyEngine');
const { RECOGNIZED_ASSURANCE_POLICIES } = require('../src/security/authConfig');

function fixture(operationCode = 'APPLICATION_REVIEW_DECIDE') {
  const catalogs = createProductionCatalogs({ catalogVersion: 'f13' });
  const org = randomUUID(), member = randomUUID();
  const operation = catalogs.operationCatalog.resolve(operationCode);
  const input = {
    actor: { type: 'HUMAN', id: randomUUID(), organizationId: org, membershipId: member, membershipVersion: 1, authorizationVersion: 1 },
    membership: { id: member, organizationId: org, status: 'ACTIVE' },
    snapshot: { organizationId: org, membershipVersion: 1, authorizationVersion: 1, profileCode: 'VIEWER',
      grants: [{ permission: operation.permission, scope: { type: 'ORGANIZATION', id: org, organizationId: org } }],
      sodRules: [{ code: 'OPPORTUNITY_DUPLICATE_REVIEW_SOD', distinctFromActorIds: [] }], supportGrant: null },
    operation, resource: { id: randomUUID(), organizationId: org, status: 'ACTIVE' },
    assuranceEvidence: null, now: new Date('2026-10-25T12:00:00Z')
  };
  const engine = createPolicyEngine({ permissionCatalog: catalogs.permissionCatalog, profileCatalog: catalogs.profileCatalog,
    assurancePolicyVersion: 'c4g-assurance-v1', recentMfaRequirement: RECOGNIZED_ASSURANCE_POLICIES['c4g-assurance-v1'].policy['recent-mfa'] });
  return { input, evaluate: () => engine.evaluate(input) };
}
test('document review with explicit grant no longer requires additional assurance', () => {
  const f = fixture(); assert.equal(f.evaluate().allowed, true); assert.equal(f.evaluate().permission.sensitive, false);
  f.input.assuranceEvidence = { authTime: 1, acr: 'c4g-loa1', amr: ['pwd'], policyVersion: 'c4g-assurance-v1' };
  assert.equal(f.evaluate().allowed, true);
});
test('document review still rejects missing grants, revocation, stale authority and foreign context', () => {
  for (const change of [f => { f.input.snapshot.grants = []; }, f => { f.input.membership.status = 'REVOKED'; },
    f => { f.input.snapshot.authorizationVersion++; }, f => { f.input.resource.organizationId = randomUUID(); },
    f => { f.input.resource.status = 'INACTIVE'; }]) {
    const f = fixture(); change(f); assert.equal(f.evaluate().allowed, false);
  }
});
test('other sensitive domains and SUPPORT retain existing assurance requirements', () => {
  for (const operation of ['OPPORTUNITY_DUPLICATE_REVIEW', 'OPPORTUNITY_IMPORT_CONFIRM', 'OPPORTUNITY_IMPORT_REVIEW']) {
    const f = fixture(operation); assert.equal(f.evaluate().allowed, false); assert.equal(f.evaluate().reasonCode, 'AUTH_EVIDENCE_MISSING');
  }
  const f = fixture(); f.input.actor.type = 'SUPPORT';
  assert.equal(f.evaluate().allowed, false); assert.equal(f.evaluate().reasonCode, 'AUTH_EVIDENCE_MISSING');
});

const { createApplicationDocumentsRepository } = require('../src/applications/documentsReview');
const { createHash } = require('node:crypto');
function reviewFixture(change = {}) {
  const org = randomUUID(), actorId = randomUUID(), app = randomUUID(), membershipId = randomUUID();
  const item = { document_id: randomUUID(), version_id: randomUUID() };
  const request = { requested_by_subject_id: randomUUID(), document_revision: 2,
    snapshot_digest: createHash('sha256').update(JSON.stringify([[item.document_id, item.version_id]])).digest('hex'), ...change.request };
  if (change.self) request.requested_by_subject_id = actorId;
  const queries = [], audit = [], writes=[], guards=[];
  const repository = createApplicationDocumentsRepository({ organizationId: org, actor: { id: actorId, membershipId }, cursor: {},
    authorize: async () => change.allowed !== false, protect: async value => guards.push(value), audit: async (_client, value) => audit.push(value),
    reviewEvidence:async input=>{if(change.ineligible)throw Object.assign(Error('Refused'),{code:'REVIEWER_NOT_ELIGIBLE'});return {applicationId:input.application.id,intentionDigest:input.intentionDigest}} });
  const client = { async query(sql,params) {
    queries.push(sql);
    if (sql.startsWith('SELECT * FROM opportunity_catalog.application_document_receipt')) return { rows: [] };
    if (sql.startsWith('SELECT * FROM opportunity_catalog.application WHERE')) return { rows: [{ application_id:app, opportunity_id: randomUUID() }] };
    if (sql.startsWith('SELECT revision FROM')) return { rows: [{ revision: 3 }] };
    if (sql.startsWith('SELECT COALESCE(MAX(revision)')) return { rows: [{ revision: 2 }] };
    if (sql.startsWith('SELECT * FROM opportunity_catalog.application_review_request')) return { rows: [request] };
    if (sql.startsWith("SELECT result_projection->>'reviewerMembershipId'")) return { rows: change.assigned ? [{reviewer_membership_id:change.assigned==='me'?membershipId:randomUUID()}] : [] };
    if (sql.startsWith('SELECT 1 FROM opportunity_catalog.application_review_decision')) return { rows: change.duplicate ? [{}] : [] };
    if (sql.startsWith('SELECT document_id')) return { rows: [item] };
    if (sql.startsWith('SELECT v.version_id')) return { rows: [{ state: 'AVAILABLE', scan_state: 'CLEAN', ...change.version }] };
    if (/^(INSERT|UPDATE) /.test(sql)) {writes.push([sql,params]);return { rows: [] };}
    throw Error('Unexpected test SQL');
  } };
  const input = { requestId: randomUUID(), expectedRevision: change.revision || 3, idempotencyKey: randomUUID(), decision: 'APPROVED', comment: 'Synthetic review' };
  const reviewerMembershipId=randomUUID();
  return { run: () => repository.reviewDecide(client, app, input), queries, audit, writes, guards, reviewerMembershipId,
    request: (assign=true)=>repository.reviewRequest(client,app,{expectedRevision:3,idempotencyKey:input.idempotencyKey,...(assign?{reviewerMembershipId}:{})}) };
}
test('normal-session policy still reaches domain SoD, exact snapshot, clean-state, CAS and duplicate guards', async () => {
  for (const [change, code] of [[{self:true},'NOT_AUTHORIZED'],[{request:{snapshot_digest:'0'.repeat(64)}},'STATE_CONFLICT'],
    [{version:{scan_state:'PENDING'}},'DOCUMENT_NOT_AVAILABLE'],[{version:{state:'QUARANTINED'}},'DOCUMENT_NOT_AVAILABLE'],
    [{duplicate:true},'STATE_CONFLICT'],[{revision:2},'STALE_REVISION']]) {
    const f = reviewFixture(change); await assert.rejects(f.run, error => error.code === code);
    assert(!f.queries.some(sql => sql.startsWith('INSERT INTO opportunity_catalog.application_review_decision')));
    assert.equal(f.audit.length, 0);
  }
});
test('a refused review performs no protected lookup; an allowed review retains audit and receipt', async () => {
  const denied = reviewFixture({allowed:false}); await assert.rejects(denied.run, error => error.code === 'NOT_AUTHORIZED');
  assert.deepEqual(denied.queries, []);
  const allowed = reviewFixture(); assert.equal((await allowed.run()).decision, 'APPROVED');
  assert.equal(allowed.audit[0].operationCode, 'APPLICATION_REVIEW_DECIDE');
  assert(allowed.queries.some(sql => sql.startsWith('INSERT INTO opportunity_catalog.application_document_receipt')));
});
test('new assigned review decisions are confined to the selected membership', async () => {
  const other=reviewFixture({assigned:'other'});
  await assert.rejects(other.run,error=>error.code==='NOT_AUTHORIZED');
  assert.equal(other.audit.length,0);
  assert.equal((await reviewFixture({assigned:'me'}).run()).decision,'APPROVED');
});
test('a request without an eligible reviewer writes nothing', async () => {
  const missing=reviewFixture();
  await assert.rejects(()=>missing.request(false),{code:'INVALID_INPUT'});
  assert.deepEqual(missing.writes,[]);
  const refused=reviewFixture({ineligible:true});
  await assert.rejects(refused.request,{code:'REVIEWER_NOT_ELIGIBLE'});
  assert.deepEqual(refused.writes,[]);
});
test('a valid request binds reviewer authority and saves its assignment in the receipt',async()=>{
  const f=reviewFixture(),result=await f.request();
  assert.equal(result.reviewerMembershipId,f.reviewerMembershipId);
  assert.equal(f.guards[0].intention.operation,'APPLICATION_REVIEW_REQUEST');
  assert.equal(f.guards[0].approvalEvidence.intentionDigest,f.guards[0].intention.digest);
  const [,params]=f.writes.find(([sql])=>sql.startsWith('INSERT INTO opportunity_catalog.application_document_receipt'));
  assert.equal(params.at(-1).reviewerMembershipId,f.reviewerMembershipId);
});
