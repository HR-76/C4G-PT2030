'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { RECOGNIZED_ASSURANCE_POLICIES: policies, recognizedAssurancePolicy } = require('../src/security/authConfig');
const { evaluateAssurance } = require('../src/security/assurance');
const { createTaxonomyAuthorization } = require('../src/authorization/resourceAuthorization');
const { createOidcAuthController } = require('../src/controllers/oidcAuthController');
const f = require('./support/f5AuthorizationFixtures');
const version = 'c4g-user-mfa-v1', manifest = policies[version], requirement = manifest.policy['recent-auth'];
const now = new Date('2030-01-15T12:00:00Z');
const evidence = { authTime: now.getTime() / 1000, acr: 'c4g-loa1', amr: ['pwd'], policyVersion: version };

test('optional MFA is an explicit recognized policy; mandatory policy remains unchanged', () => {
  assert.equal(recognizedAssurancePolicy(version, manifest.policy, 'recent-auth'), manifest);
  assert.throws(() => recognizedAssurancePolicy('c4g-assurance-v1', manifest.policy, 'recent-auth'));
  assert.equal(policies['c4g-assurance-v1'].policy['recent-mfa'].mfa, true);
  const evaluate = (value, rule = requirement, policyVersion = version) => evaluateAssurance({
    evidence: value, requirement: rule, nowSeconds: now.getTime() / 1000, expectedPolicyVersion: policyVersion });
  assert.equal(evaluate(evidence).allowed, true);
  assert.equal(evaluate(null).allowed, false);
  assert.equal(evaluate({ ...evidence, authTime: evidence.authTime - 301 }).reason, 'AUTH_EVIDENCE_EXPIRED');
  assert.equal(evaluate({ ...evidence, policyVersion: 'c4g-assurance-v1' }).reason, 'AUTH_POLICY_VERSION_MISMATCH');
  assert.equal(evaluate({ ...evidence, policyVersion: 'c4g-assurance-v1' }, policies['c4g-assurance-v1'].policy['recent-mfa'],
    'c4g-assurance-v1').reason, 'MFA_EVIDENCE_INSUFFICIENT');
});

async function authorize(changes = {}) {
  const events = [];
  const port = createTaxonomyAuthorization({ catalogs: f.syntheticCatalogs(),
    membershipPort: { async revalidate() { return f.membership({ globalUserId: f.ACTOR_ID, membershipVersion: 3, ...changes.membership }); } },
    authorizationDataPort: { async load() { return f.snapshot({ grants: [f.grant('synthetic_resource.update')],
      sodRules: [{ code: 'TWO_PERSON', distinctFromActorIds: [] }], ...changes.snapshot }); } },
    authorizationAuditPort: { async accept(event) { events.push(event); return 'ACCEPTED'; } },
    assurancePolicyVersion: version, recentMfaRequirement: requirement, clock: { now: () => now } });
  const result = await port.authorize('SYNTHETIC_UPDATE', { actor: f.actor(), assuranceEvidence: changes.evidence || evidence,
    correlationId: 'optional-mfa-test' }, f.resource({ scopeType: 'ORGANIZATION', resourceType: 'SYNTHETIC_RESOURCE',
    distinctFromActorIds: [], ...changes.resource }));
  return { result, events };
}
test('sensitive action accepts password assurance without claiming MFA; permissions, tenant and SoD remain enforced', async () => {
  const { result, events } = await authorize();
  assert.equal(result.allowed, true); assert.equal(result.evaluation.assuranceLevel, 'SESSION');
  assert(events.some(event => event.assuranceLevel === 'SESSION'));
  for (const change of [{ snapshot: { grants: [] } }, { membership: { status: 'SUSPENDED' } },
    { resource: { organizationId: f.ORGANIZATION_B } }, { resource: { distinctFromActorIds: [f.ACTOR_ID] } },
    { evidence: { ...evidence, authTime: evidence.authTime - 301 } }]) assert.equal((await authorize(change)).result.allowed, false);
});

test('account management URL is server-selected and contains no identity or caller redirect', () => {
  const controller = createOidcAuthController({ config: { issuer: new URL('https://login.example/realms/c4g'),
    clientId: 'c4g', policyVersion: version } });
  let url, settings;
  controller.account({ query: { returnTo: 'https://foreign.invalid', subject: 'other-user' } }, { redirect(status, value) { assert.equal(status, 302); url = value; } });
  controller.accountSecurity({}, { json(value) { settings = value; } });
  assert.equal(url, 'https://login.example/realms/c4g/account/account-security/signing-in?referrer=c4g');
  assert.deepEqual(settings, { managementPath: '/api/auth/account', mfaOptional: true });
  let stepUpPolicy;
  controller.stepUpPolicy({}, { set(name, value) { assert.equal(name, 'Cache-Control'); assert.equal(value, 'no-store'); return this; },
    json(value) { stepUpPolicy = value; } });
  assert.deepEqual(stepUpPolicy, { mfaOptional: true });
});
