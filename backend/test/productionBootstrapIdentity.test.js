'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { verifyAdministrator, bootstrapIdentity, bootstrapIds } = require('../scripts/productionBootstrap/identity');

const id = n => `70000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
function config(profile = 'ORG_ADMIN') {
  return { installationId: id(1), organization: { id: id(2), name: 'Entidade', legalName: 'Entidade Legal', slug: 'entidade', type: 'ASSOCIATION', currency: 'EUR', dataResidencyCode: 'EU' },
    tenant: { id: id(3), generationId: id(4) }, administrator: { globalUserId: id(5), membershipId: profile ? id(6) : null, issuer: 'https://login.example.test/realms/production', subject: id(7), name: 'Administrador Nominal', email: 'admin@example.test', organizationProfile: profile } };
}
const proof = c => ({ issuer: c.administrator.issuer, subject: c.administrator.subject, email: c.administrator.email, enabled: true, emailVerified: true, passwordReady: true });
const providerUser = c => ({ id: c.administrator.subject, email: c.administrator.email, enabled: true, emailVerified: true, requiredActions: [] });
const snapshot = c => ({ organizationId: c.organization.id, tenantId: c.tenant.id, databaseGenerationId: c.tenant.generationId, databaseRef: 'tenant_production', credentialRef: 'production-tenant', regionCode: 'EU', residencyPolicyVersion: 'production-v1', schema: { currentVersion: '041_account_identity_erasure' } });

test('bootstrap verifies the administrator through the admitted private Keycloak origin', async () => {
  const c = config(), requests = [];
  const result = await verifyAdministrator(c, { token: 'private-test-token', adminOrigin: 'http://c4g-production-keycloak:8080',
    fetchImpl: async (url, options) => { requests.push({ url, options }); return { ok: true, json: async () => providerUser(c) }; } });
  assert.deepEqual(result, proof(c));
  assert.equal(requests[0].url, `http://c4g-production-keycloak:8080/admin/realms/production/users/${c.administrator.subject}`);
  assert.equal(requests[0].options.redirect, 'error');
  for (const adminOrigin of ['http://outside.example.test:8080', 'https://user:secret@example.test', 'https://id.example.test/path', 'http://c4g-production-keycloak:8080?x=y']) {
    await assert.rejects(verifyAdministrator(c, { token: 'private-test-token', adminOrigin, fetchImpl: () => assert.fail('must reject origin before network') }), /PRODUCTION_IDENTITY_CONFIGURATION_INVALID/);
  }
});

test('production administrator verification is a bounded read-only provider call and preserves optional MFA', async () => {
  const c = config(); const requests = [];
  const result = await verifyAdministrator(c, { token: 'private-test-token', fetchImpl: async (url, options) => { requests.push({ url, options }); return { ok: true, json: async () => ({ ...providerUser(c), requiredActions: ['CONFIGURE_TOTP'] }) }; } });
  assert.deepEqual(result, proof(c));
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, `https://login.example.test/admin/realms/production/users/${c.administrator.subject}`);
  assert.equal(requests[0].options.method, 'GET');
  assert.equal(requests[0].options.redirect, 'error');
  assert.equal(requests[0].options.body, undefined);
  assert.ok(requests[0].options.signal instanceof AbortSignal);
});

test('production administrator rejects identity mismatches, unverified or disabled users and incomplete passwords', async () => {
  const c = config();
  for (const changed of [{ id: id(90) }, { email: 'other@example.test' }, { enabled: false }, { emailVerified: false }, { requiredActions: ['UPDATE_PASSWORD'] }]) {
    await assert.rejects(verifyAdministrator(c, { token: 'private-test-token', fetchImpl: async () => ({ ok: true, json: async () => ({ ...providerUser(c), ...changed }) }) }), { code: 'PRODUCTION_ADMINISTRATOR_UNVERIFIED' });
  }
});

test('production administrator rejects unsafe issuers before contacting the provider and redacts network failures', async () => {
  for (const issuer of ['http://login.example.test/realms/production', 'https://name:secret@login.example.test/realms/production', 'https://login.example.test/realms/production?secret=value', 'https://login.example.test/realms/production/', 'https://login.example.test/other']) {
    const c = config(); c.administrator.issuer = issuer;
    await assert.rejects(verifyAdministrator(c, { token: 'private-test-token', fetchImpl: () => { throw Error('unexpected fetch'); } }), { code: 'PRODUCTION_BOOTSTRAP_INPUT_INVALID' });
  }
  await assert.rejects(verifyAdministrator(config(), { token: 'private-test-token', fetchImpl: () => { throw Error('Bearer private-test-token'); } }), error => error.code === 'PRODUCTION_IDENTITY_PROVIDER_UNAVAILABLE' && !error.message.includes('private-test-token'));
});

test('bootstrap refuses proof/configuration/binding mismatch before connecting or mutating', async () => {
  const c = config(); const pool = { connect() { throw Error('unexpected connection'); } };
  for (const identityProof of [null, { ...proof(c), subject: id(91) }, { ...proof(c), emailVerified: false }]) {
    await assert.rejects(bootstrapIdentity({ centralPool: pool, authorityPool: pool, permitSecret: 'p'.repeat(32), config: c, snapshot: snapshot(c), identityProof }), { code: 'PRODUCTION_ADMINISTRATOR_UNVERIFIED' });
  }
  await assert.rejects(bootstrapIdentity({ centralPool: pool, authorityPool: pool, permitSecret: 'p'.repeat(32), config: c, snapshot: { ...snapshot(c), tenantId: id(92) }, identityProof: proof(c) }), { code: 'PRODUCTION_TENANT_BINDING_MISMATCH' });
  const invalid = config(null); invalid.administrator.membershipId = id(6);
  await assert.rejects(bootstrapIdentity({ config: invalid }), { code: 'PRODUCTION_BOOTSTRAP_INPUT_INVALID' });
  for (const type of ['UNKNOWN_CUSTOM_TYPE', 'UNSPECIFIED']) {
    const unknown = config(); unknown.organization.type = type;
    await assert.rejects(bootstrapIdentity({ config: unknown }), { code: 'PRODUCTION_BOOTSTRAP_INPUT_INVALID' });
  }
});

test('bootstrap identity record IDs are stable per installation and distinct by purpose', () => {
  const first = bootstrapIds(config());
  assert.deepEqual(first, bootstrapIds(config()));
  assert.notEqual(first.identityRefId, first.assignmentId);
  const different = config(); different.installationId = id(99);
  assert.notDeepEqual(first, bootstrapIds(different));
});

// A transactional in-memory Central lets unit tests inject failures at durable
// boundaries. The dedicated PostgreSQL gate verifies the real roles/protocol.
function harness(c = config()) {
  const q = require('../src/platformOnboarding/sql'), memberSql = require('../src/platformOnboarding/memberSql');
  const h = { state: { org: null, user: null, reference: null, assignment: null, members: [], grants: null, events: [], published: false, projections: [] }, phases: [], registrationCalls: 0, authorityWrites: 0 };
  let saved = null;
  const rows = items => ({ rows: items.filter(Boolean), rowCount: items.filter(Boolean).length });
  const db = { async connect() { return db; }, release() {}, async query(sql, v = []) {
    const s = h.state;
    if (sql === 'BEGIN') { saved = structuredClone(s); return rows([]); }
    if (sql === 'COMMIT') { saved = null; return rows([]); }
    if (sql === 'ROLLBACK') { h.state = saved; saved = null; return rows([]); }
    if (sql === 'SELECT pg_advisory_xact_lock(43001306,1)') return rows([]);
    if (sql.startsWith('SELECT * FROM public.organization WHERE')) return rows([s.org]);
    if (sql.startsWith('SELECT * FROM public.global_user WHERE')) return rows([s.user]);
    if (sql.startsWith('SELECT * FROM public.auth_identity_ref WHERE')) return rows([s.reference]);
    if (sql.startsWith('SELECT * FROM public.platform_admin_assignment WHERE')) return rows([s.assignment]);
    if (sql.startsWith('SELECT * FROM public.organization_membership WHERE global_user_id')) return rows(s.members);
    if (sql === q.org) { s.org = { id: v[0], legal_name: v[1], display_name: v[2], slug: v[3], type_code: v[4], status: 'PROVISIONING', reporting_currency: v[5], mfa_policy_code: v[6], data_residency_code: v[7] }; return rows([s.org]); }
    if (sql === q.user) { s.user = { id: v[0], display_name: v[1], primary_email: v[2], status: 'ACTIVE', session_revocation_version: 1 }; return rows([s.user]); }
    if (sql === q.reference) { s.reference = { id: v[0], global_user_id: v[1], issuer: v[2], subject: v[3] }; return rows([s.reference]); }
    if (sql.startsWith('INSERT INTO public.platform_admin_assignment')) { s.assignment = { id: v[0], global_user_id: v[1], role_code: 'C4G_ADMIN', status: 'ACTIVE', granted_by: null, revoked_at: null }; return rows([s.assignment]); }
    if (sql === q.pending) { s.members.push({ id: v[0], global_user_id: v[1], organization_id: v[2], base_role_code: 'ORG_ADMIN', status: 'PENDING_PROJECTION', membership_version: 1, valid_until: null, suspended_at: null, removed_at: null, status_reason: null }); return rows([s.members[0]]); }
    if (sql === q.ready) return rows(s.published ? [{ id: c.organization.id }] : []);
    if (sql === q.orgActive) return rows(s.org.status === 'ACTIVE' ? [{ id: c.organization.id }] : []);
    if (sql === q.member) return rows(s.members.filter(m => m.id === v[0] && m.organization_id === v[1] && m.global_user_id === v[2]));
    if (sql === memberSql.state) return rows([s.grants]);
    if (sql === q.activateMember) { const m = s.members[0]; if (m.status !== 'PENDING_PROJECTION') return rows([]); m.status = 'ACTIVE'; m.membership_version++; return rows([m]); }
    if (sql === q.grants) { assert.equal(s.grants, null); s.grants = { organization_id: v[0], membership_id: v[1], authorization_version: 1, policy_version: v[2], grants: JSON.parse(v[3]), assurance_requirements: JSON.parse(v[4]) }; return rows([s.grants]); }
    if (sql === q.activeOrg) { if (s.org.status !== 'PROVISIONING') return rows([]); s.org.status = 'ACTIVE'; return rows([s.org]); }
    throw Error(`Unexpected test SQL: ${sql}`);
  } };
  h.args = { config: c, centralPool: db, authorityPool: db, permitSecret: 'p'.repeat(32), identityProof: proof(c), snapshot: snapshot(c),
    onPhase: async phase => { h.phases.push(phase); }, ports: {
      createCoordinator: () => ({ pool: db, withAuthority: action => action(), async write(keys, action) { h.authorityWrites++; h.authorityKeys = keys; await db.query('BEGIN'); try { const result = await action(db); await db.query('COMMIT'); return result; } catch (e) { await db.query('ROLLBACK'); throw e; } } }),
      appendAudit: async (client, candidate) => { h.state.events.push(candidate.event); },
      registerExistingTenant: async ({ snapshot: value }) => { h.registrationCalls++; h.state.published = true; return value; },
      createProjection: () => ({ async ensure(x) { assert.equal(h.state.published, true); assert.equal(h.state.members[0].status, h.state.grants ? 'ACTIVE' : 'PENDING_PROJECTION'); if (!h.state.projections.includes(x.membershipId)) h.state.projections.push(x.membershipId); return { ...x, projected: true }; } })
    } };
  return h;
}

test('bootstrap creates separate global and organization authority, projects before activation and replays without duplicates', async () => {
  const h = harness(), c = h.args.config;
  const result = await bootstrapIdentity(h.args);
  assert.equal(result.status, 'READY');
  assert.equal(h.state.assignment.role_code, 'C4G_ADMIN');
  assert.equal(h.state.org.status, 'ACTIVE');
  assert.equal(h.state.org.mfa_policy_code, 'USER_OPTIONAL');
  assert.equal(h.state.members[0].base_role_code, 'ORG_ADMIN');
  assert.equal(h.state.members[0].status, 'ACTIVE');
  assert.deepEqual(h.state.grants.grants, require('../src/organizationDirectory/accessProfiles').grantsForProfile({ organizationId: c.organization.id, profileCode: 'ORG_ADMIN' }));
  assert.equal(h.state.grants.policy_version, 'c4g-user-mfa-v1');
  assert.equal(h.state.grants.assurance_requirements.mfa, false);
  assert.deepEqual(h.phases, ['identity-seeded', 'directory-published', 'administrator-projected', 'identity-active']);
  assert.deepEqual(h.state.projections, [c.administrator.membershipId]);
  assert.ok(h.authorityKeys.includes(`MEMBER:${c.administrator.membershipId}`));
  const before = structuredClone(h.state);
  await bootstrapIdentity(h.args);
  assert.deepEqual(h.state, before);
  assert.equal(h.authorityWrites, 1, 'replay must not advance authority epochs');
  assert.equal(h.state.events.length, 5);
  for (const e of h.state.events) {
    assert.equal(e.actor.type, 'SERVICE'); assert.equal(e.actor.id, c.installationId); assert.equal(e.actor.serviceActorCode, 'PRODUCTION_INSTALLER');
    assert.equal(JSON.stringify(e).includes(c.administrator.email), false);
    assert.equal(JSON.stringify(e).includes(c.administrator.name), false);
  }
  assert.equal(JSON.stringify(result).includes(c.administrator.email), false);
});

test('global-only administrator receives no tenant membership, grants or projection', async () => {
  const h = harness(config(null));
  h.args.ports.createProjection = () => { throw Error('must not project'); };
  const result = await bootstrapIdentity(h.args);
  assert.equal(result.organizationMembershipId, null);
  assert.equal(h.state.org.status, 'ACTIVE'); assert.equal(h.state.assignment.role_code, 'C4G_ADMIN');
  assert.deepEqual(h.state.members, []); assert.equal(h.state.grants, null); assert.deepEqual(h.state.projections, []);
  const before = structuredClone(h.state); await bootstrapIdentity(h.args); assert.deepEqual(h.state, before);
});

test('bootstrap resumes after every durable phase without duplication or ungranted active membership', async () => {
  for (const phase of ['identity-seeded', 'directory-published', 'administrator-projected', 'identity-active']) {
    const h = harness(); h.args.onPhase = async current => { if (current === phase) throw Error('injected failure'); };
    await assert.rejects(bootstrapIdentity(h.args), /injected failure/);
    if (phase !== 'identity-active') { assert.equal(h.state.members[0].status, 'PENDING_PROJECTION'); assert.equal(h.state.grants, null); }
    h.args.onPhase = async () => {}; await bootstrapIdentity(h.args);
    assert.equal(h.state.members.length, 1); assert.equal(h.state.projections.length, 1); assert.equal(h.state.events.length, 5);
    assert.equal(h.state.members[0].status, 'ACTIVE'); assert.equal(h.state.grants.authorization_version, 1);
  }
});

test('seed audit failure rolls back users and organization, activation audit failure rolls back membership and grants', async () => {
  const h = harness(); const appendAudit = h.args.ports.appendAudit;
  h.args.ports.appendAudit = async (client, candidate) => { if (candidate.event.eventCode === 'PLATFORM_USER_CREATED') throw Error('audit unavailable'); return appendAudit(client, candidate); };
  await assert.rejects(bootstrapIdentity(h.args), /audit unavailable/);
  assert.equal(h.state.org, null); assert.equal(h.state.user, null); assert.equal(h.state.assignment, null); assert.equal(h.state.events.length, 0);
  h.args.ports.appendAudit = async (client, candidate) => { if (candidate.event.eventCode === 'PLATFORM_ADMINISTRATOR_ACTIVATED') throw Error('audit unavailable'); return appendAudit(client, candidate); };
  await assert.rejects(bootstrapIdentity(h.args), /audit unavailable/);
  assert.equal(h.state.org.status, 'PROVISIONING'); assert.equal(h.state.members[0].status, 'PENDING_PROJECTION'); assert.equal(h.state.grants, null);
  h.args.ports.appendAudit = appendAudit; await bootstrapIdentity(h.args); assert.equal(h.state.events.length, 5);
});

test('bootstrap fails closed on identity, revoked access, membership and grant drift before publishing', async () => {
  for (const corrupt of [
    s => { s.user.id = id(90); }, s => { s.user.status = 'SUSPENDED'; }, s => { s.reference.subject = id(91); },
    s => { s.assignment.status = 'REVOKED'; }, s => { s.members[0].status = 'SUSPENDED'; },
    s => { s.members[0].organization_id = id(92); }, s => { s.org.status = 'SUSPENDED'; },
    s => { s.grants.grants.push({ permission: 'billing.read', scope: { type: 'ORGANIZATION', id: id(2), organizationId: id(2) } }); },
    s => { s.grants.assurance_requirements.mfa = true; }
  ]) {
    const h = harness(); await bootstrapIdentity(h.args); corrupt(h.state);
    const before = structuredClone(h.state), publishes = h.registrationCalls;
    await assert.rejects(bootstrapIdentity(h.args), e => ['PRODUCTION_BOOTSTRAP_IDENTITY_CONFLICT', 'PRODUCTION_BOOTSTRAP_AUTHORIZATION_CONFLICT'].includes(e.code));
    assert.deepEqual(h.state, before); assert.equal(h.registrationCalls, publishes);
  }
});

test('bootstrap cannot activate a pending user against a different projection binding', async () => {
  const h = harness(); h.args.ports.createProjection = () => ({ ensure: async x => ({ ...x, organizationId: id(99), projected: true }) });
  await assert.rejects(bootstrapIdentity(h.args), { code: 'PRODUCTION_BOOTSTRAP_PROJECTION_INVALID' });
  assert.equal(h.state.members[0].status, 'PENDING_PROJECTION'); assert.equal(h.state.grants, null); assert.equal(h.state.org.status, 'PROVISIONING');
});

test('production projection factory receives the organization lookup key required by memberProjection', async () => {
  const h = harness(); const projection = h.args.ports.createProjection;
  h.args.tenantCredentials = { tenantId: h.args.config.tenant.id, database: h.args.snapshot.databaseRef };
  h.args.ports.createProjection = options => {
    const entry = options.bindings.find(binding => binding.organizationId === h.args.config.organization.id);
    assert.ok(entry, 'memberProjection selects a binding by its top-level organizationId');
    assert.equal(entry.credentials, h.args.tenantCredentials);
    assert.equal(entry.snapshot.organizationId, entry.organizationId);
    assert.equal(entry.snapshot.tenantId, entry.credentials.tenantId);
    assert.equal(entry.snapshot.databaseRef, entry.credentials.database);
    assert.equal(options.tenantApiProfile, 'production-editorial-v1');
    return projection(options);
  };
  await bootstrapIdentity(h.args);
});

test('production projection connection preserves the configured verified TLS CA', async () => {
  const h = harness(), pools = [], ssl = { rejectUnauthorized: true, ca: 'synthetic-test-ca' };
  h.args.config.target = { ssl };
  const projection = h.args.ports.createProjection;
  h.args.ports.createProjection = options => {
    assert.equal(typeof options.createPool, 'function');
    const pool = options.createPool({ host: '127.0.0.1', port: 1, database: 'unused', ssl: { rejectUnauthorized: true } });
    pools.push(pool);
    assert.deepEqual(pool.options.ssl, ssl);
    return projection(options);
  };
  try { await bootstrapIdentity(h.args); } finally { await Promise.all(pools.map(pool => pool.end())); }
});

test('shared member projection uses its optional connection factory without contacting a database', async t => {
  const { Pool } = require('pg');
  t.mock.method(Pool.prototype, 'connect', async () => { throw Error('DEFAULT_POOL_NOT_ALLOWED'); });
  const c = config(); let called = false;
  const credentials = { tenantId: c.tenant.id, credentialRef: 'test-tenant', connectionVersion: 1, host: '127.0.0.1', port: 1, database: 'unused', login: 'unused_test', password: 'p'.repeat(32), ssl: true };
  const projection = require('../src/platformOnboarding/memberProjection').createMemberProjection({
    bindings: [{ organizationId: c.organization.id, credentials, snapshot: { organizationId: c.organization.id, tenantId: c.tenant.id, databaseRef: credentials.database } }],
    allowedResidency: [{ regionCode: 'EU', policyVersion: 'test-v1' }],
    createPool: () => { called = true; throw Error('INJECTED_CONNECTION_FACTORY'); }
  });
  await assert.rejects(projection.ensure({ operationId: c.installationId, organizationId: c.organization.id, globalUserId: c.administrator.globalUserId, membershipId: c.administrator.membershipId }), /INJECTED_CONNECTION_FACTORY/);
  assert.equal(called, true);
});
