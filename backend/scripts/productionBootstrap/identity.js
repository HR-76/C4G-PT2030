'use strict';
// Administrative bootstrap only. This module is never mounted in the application.
// The caller must admit the dedicated installation and its verified DB bindings.
const { createHash } = require('node:crypto');
const { isDeepStrictEqual } = require('node:util');
const { Pool } = require('pg');
const q = require('../../src/platformOnboarding/sql');
const memberSql = require('../../src/platformOnboarding/memberSql');
const { grantsForProfile } = require('../../src/organizationDirectory/accessProfiles');
const { types: organizationTypes } = require('../../src/entityAdmission/registrationContract');
const { RECOGNIZED_ASSURANCE_POLICIES } = require('../../src/security/authConfig');
const { createAuditEvent } = require('../../src/audit/event');
const { createAppendService } = require('../../src/audit/appendService');
const { PostgresAppendRepository } = require('../../src/audit/postgresAppendRepository');
const { createUuidV7 } = require('../../src/audit/uuidV7');

const POLICY = 'c4g-user-mfa-v1';
const ASSURANCE = RECOGNIZED_ASSURANCE_POLICIES[POLICY].policy['recent-auth'];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const fail = code => { throw Object.assign(new Error(code), { code }); };
const validText = (value, max = 200) => typeof value === 'string' && value.length > 0 && value.length <= max && value.trim() === value && value.normalize('NFC') === value && !/[\x00-\x1f]/.test(value);

function administrator(config) {
  const a = config?.administrator;
  if (!a || !UUID.test(a.globalUserId) || !validText(a.name) || !validText(a.email, 254)
      || a.email !== a.email.toLowerCase() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(a.email)
      || !validText(a.subject, 255) || ![null, 'ORG_ADMIN'].includes(a.organizationProfile)
      || (a.organizationProfile === null ? a.membershipId !== null : !UUID.test(a.membershipId))) fail('PRODUCTION_BOOTSTRAP_INPUT_INVALID');
  let issuer;
  try { issuer = new URL(a.issuer); } catch { fail('PRODUCTION_BOOTSTRAP_INPUT_INVALID'); }
  if (issuer.protocol !== 'https:' || issuer.username || issuer.password || issuer.search || issuer.hash
      || !/^\/realms\/[a-zA-Z0-9_-]+$/.test(issuer.pathname) || issuer.href !== a.issuer) fail('PRODUCTION_BOOTSTRAP_INPUT_INVALID');
  return a;
}

function validateConfig(config) {
  const a = administrator(config), o = config?.organization, t = config?.tenant;
  if (!UUID.test(config?.installationId) || !o || !UUID.test(o.id) || !validText(o.name) || !validText(o.legalName)
      || !validText(o.slug, 100) || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(o.slug)
      || !organizationTypes.includes(o.type) || !/^[A-Z]{3}$/.test(o.currency)
      || !/^[A-Z][A-Z0-9_]{0,63}$/.test(o.dataResidencyCode) || !t || !UUID.test(t.id) || !UUID.test(t.generationId)) fail('PRODUCTION_BOOTSTRAP_INPUT_INVALID');
  return { a, o, t };
}

function bootstrapIds(config) {
  validateConfig(config);
  const derive = purpose => {
    const b = createHash('sha256').update(`c4g-production-bootstrap-v1:${config.installationId}:${purpose}`).digest().subarray(0, 16);
    b[6] = (b[6] & 15) | 0x50; b[8] = (b[8] & 63) | 0x80;
    const h = b.toString('hex'); return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
  };
  return Object.freeze({ identityRefId: derive('identity'), assignmentId: derive('platform-administrator') });
}

async function verifyAdministrator(config, { token, fetchImpl = fetch, adminOrigin = null } = {}) {
  const a = administrator(config), issuer = new URL(a.issuer);
  if (typeof token !== 'string' || !token || /[\r\n]/.test(token) || typeof fetchImpl !== 'function') fail('PRODUCTION_IDENTITY_CONFIGURATION_INVALID');
  let administration;
  try { administration = new URL(adminOrigin ?? issuer.origin); } catch { fail('PRODUCTION_IDENTITY_CONFIGURATION_INVALID'); }
  const privateHttp = administration.protocol === 'http:' && ['c4g-production-keycloak', 'c4g-rehearsal-keycloak'].includes(administration.hostname) && administration.port === '8080';
  if ((administration.protocol !== 'https:' && !privateHttp) || administration.origin !== (adminOrigin ?? issuer.origin)
    || administration.username || administration.password || /staging/i.test(administration.hostname)) fail('PRODUCTION_IDENTITY_CONFIGURATION_INVALID');
  let user;
  try {
    const response = await fetchImpl(`${administration.origin}/admin${issuer.pathname}/users/${encodeURIComponent(a.subject)}`, {
      method: 'GET', redirect: 'error', signal: AbortSignal.timeout(15000), headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' }
    });
    if (!response.ok) fail('PRODUCTION_IDENTITY_PROVIDER_UNAVAILABLE');
    user = await response.json();
  } catch { fail('PRODUCTION_IDENTITY_PROVIDER_UNAVAILABLE'); }
  if (!user || user.id !== a.subject || user.enabled !== true || user.emailVerified !== true
      || typeof user.email !== 'string' || user.email.toLowerCase() !== a.email
      || !Array.isArray(user.requiredActions) || user.requiredActions.includes('UPDATE_PASSWORD')) fail('PRODUCTION_ADMINISTRATOR_UNVERIFIED');
  return Object.freeze({ issuer: a.issuer, subject: a.subject, email: a.email, enabled: true, emailVerified: true, passwordReady: true });
}

function assertProof(a, proof) {
  if (!proof || proof.issuer !== a.issuer || proof.subject !== a.subject || proof.email !== a.email
      || proof.enabled !== true || proof.emailVerified !== true || proof.passwordReady !== true) fail('PRODUCTION_ADMINISTRATOR_UNVERIFIED');
}

function event(config, eventCode, step, type, id) {
  return createAuditEvent({ trustedContext: { scope: 'PLATFORM', organizationId: null, tenantId: null, operationAuthority: 'CENTRAL',
    operationCode: 'PLATFORM_ONBOARDING', source: 'PRODUCTION_INSTALLER', channel: 'INSTALLER', synchronous: true }, input: {
    eventCode, actor: { type: 'SERVICE', id: config.installationId, membershipId: null, serviceActorCode: 'PRODUCTION_INSTALLER', supportGrantId: null },
    subject: null, resource: { type, id }, decision: 'ACCEPT', outcome: 'SUCCESS', observedAt: new Date().toISOString(),
    correlationId: createUuidV7(), causationId: null, idempotencyKey: `${config.installationId}:${step}`, streamType: 'DATA', payload: { detailCode: 'PRODUCTION_BOOTSTRAP' }
  } });
}

const append = createAppendService({ appendPort: new PostgresAppendRepository() });
function appendAudit(client, candidate) {
  return append.append(candidate, { query: (statement, values) => client.query(statement.includes('prepare_append_v1') ? q.auditPrepare : q.auditAppend, values) });
}

function exactRow(rows, expected) {
  if (rows.length > 1 || (rows.length === 1 && Object.entries(expected).some(([key, value]) => rows[0][key] !== value))) fail('PRODUCTION_BOOTSTRAP_IDENTITY_CONFLICT');
  return rows[0] || null;
}

function assertMember(row, a, o) {
  if (!row || row.id !== a.membershipId || row.global_user_id !== a.globalUserId || row.organization_id !== o.id
      || row.base_role_code !== 'ORG_ADMIN' || !['PENDING_PROJECTION', 'ACTIVE'].includes(row.status)
      || row.valid_until !== null || row.suspended_at !== null || row.removed_at !== null || row.status_reason !== null
      || Number(row.membership_version) !== (row.status === 'ACTIVE' ? 2 : 1)) fail('PRODUCTION_BOOTSTRAP_IDENTITY_CONFLICT');
}

function assertGrants(row, grants) {
  if (!row || Number(row.authorization_version) !== 1 || row.policy_version !== POLICY
      || !isDeepStrictEqual(row.grants, grants) || !isDeepStrictEqual(row.assurance_requirements, ASSURANCE)) fail('PRODUCTION_BOOTSTRAP_AUTHORIZATION_CONFLICT');
}

async function bootstrapIdentity({ centralPool, authorityPool, permitSecret, tenantCredentials, snapshot, config, identityProof, onPhase = async () => {}, ports = {} }) {
  const { a, o, t } = validateConfig(config), ids = bootstrapIds(config);
  const grants = a.organizationProfile ? grantsForProfile({ organizationId: o.id, profileCode: a.organizationProfile }) : null;
  assertProof(a, identityProof);
  if (!snapshot || snapshot.organizationId !== o.id || snapshot.tenantId !== t.id || snapshot.databaseGenerationId !== t.generationId
      || snapshot.schema?.currentVersion !== '041_account_identity_erasure') fail('PRODUCTION_TENANT_BINDING_MISMATCH');
  if (typeof permitSecret !== 'string' || Buffer.byteLength(permitSecret) < 32 || !centralPool?.connect || !authorityPool?.connect) fail('PRODUCTION_BOOTSTRAP_CONFIGURATION_INVALID');
  const audit = ports.appendAudit || appendAudit;
  const coordinator = (ports.createCoordinator || require('../../src/security/authorityCoordinator').createAuthorityCoordinator)({ pool: authorityPool, permitSecret });
  const client = await centralPool.connect(); let begun = false, completed = false;
  try {
    await client.query('BEGIN'); begun = true;
    await client.query('SELECT pg_advisory_xact_lock(43001306,1)');
    const organization = exactRow((await client.query('SELECT * FROM public.organization WHERE id=$1 OR lower(slug)=lower($2) FOR UPDATE', [o.id, o.slug])).rows,
      { id: o.id, legal_name: o.legalName, display_name: o.name, slug: o.slug, type_code: o.type, reporting_currency: o.currency, mfa_policy_code: 'USER_OPTIONAL', data_residency_code: o.dataResidencyCode });
    if (organization && !['PROVISIONING', 'ACTIVE'].includes(organization.status)) fail('PRODUCTION_BOOTSTRAP_IDENTITY_CONFLICT');
    const user = exactRow((await client.query('SELECT * FROM public.global_user WHERE id=$1 OR lower(primary_email)=lower($2) FOR UPDATE', [a.globalUserId, a.email])).rows,
      { id: a.globalUserId, display_name: a.name, primary_email: a.email, status: 'ACTIVE' });
    if (user && Number(user.session_revocation_version) !== 1) fail('PRODUCTION_BOOTSTRAP_IDENTITY_CONFLICT');
    const reference = exactRow((await client.query('SELECT * FROM public.auth_identity_ref WHERE global_user_id=$1 OR (issuer=$2 AND subject=$3) OR id=$4 FOR UPDATE', [a.globalUserId, a.issuer, a.subject, ids.identityRefId])).rows,
      { id: ids.identityRefId, global_user_id: a.globalUserId, issuer: a.issuer, subject: a.subject });
    const assignment = exactRow((await client.query('SELECT * FROM public.platform_admin_assignment WHERE global_user_id=$1 OR id=$2 FOR UPDATE', [a.globalUserId, ids.assignmentId])).rows,
      { id: ids.assignmentId, global_user_id: a.globalUserId, role_code: 'C4G_ADMIN', status: 'ACTIVE', granted_by: null, revoked_at: null });
    const memberships = (await client.query('SELECT * FROM public.organization_membership WHERE global_user_id=$1 OR id=$2 FOR UPDATE', [a.globalUserId, a.membershipId])).rows;
    if (memberships.length > (a.organizationProfile ? 1 : 0)) fail('PRODUCTION_BOOTSTRAP_IDENTITY_CONFLICT');
    if (memberships.length) {
      assertMember(memberships[0], a, o);
      const existingGrants = (await client.query(memberSql.state, [o.id, a.membershipId])).rows[0];
      if (memberships[0].status === 'ACTIVE') {
        assertGrants(existingGrants, grants);
        if (organization?.status !== 'ACTIVE') fail('PRODUCTION_BOOTSTRAP_IDENTITY_CONFLICT');
      } else if (existingGrants || organization?.status !== 'PROVISIONING') fail('PRODUCTION_BOOTSTRAP_AUTHORIZATION_CONFLICT');
    }
    const present = [organization, user, reference, assignment, ...(a.organizationProfile ? [memberships[0]] : [])].map(Boolean);
    if (present.some(Boolean) && !present.every(Boolean)) fail('PRODUCTION_BOOTSTRAP_IDENTITY_CONFLICT');
    completed = organization?.status === 'ACTIVE';
    if (!organization) {
      await client.query(q.org, [o.id, o.legalName, o.name, o.slug, o.type, o.currency, 'USER_OPTIONAL', o.dataResidencyCode]);
      await client.query(q.user, [a.globalUserId, a.name, a.email]);
      await client.query(q.reference, [ids.identityRefId, a.globalUserId, a.issuer, a.subject]);
      await client.query("INSERT INTO public.platform_admin_assignment(id,global_user_id,role_code,status) VALUES($1,$2,'C4G_ADMIN','ACTIVE')", [ids.assignmentId, a.globalUserId]);
      if (a.organizationProfile) await client.query(q.pending, [a.membershipId, a.globalUserId, o.id]);
      await audit(client, event(config, 'PLATFORM_ORGANIZATION_CREATED', 'organization-created', 'ORGANIZATION', o.id));
      await audit(client, event(config, 'PLATFORM_USER_CREATED', 'administrator-created', 'GLOBAL_USER', a.globalUserId));
      await audit(client, event(config, 'PLATFORM_ACCESS_CHANGED', 'platform-access-created', 'PLATFORM_ADMIN_ASSIGNMENT', ids.assignmentId));
    }
    await client.query('COMMIT'); begun = false;
  } catch (error) { if (begun) await client.query('ROLLBACK').catch(() => {}); throw error; }
  finally { client.release(); }
  await onPhase('identity-seeded');

  const published = await (ports.registerExistingTenant || require('../../src/platformOnboarding/registerExistingTenant').registerExistingTenant)({ pool: centralPool, snapshot, correlationId: config.installationId });
  await onPhase('directory-published');
  if (a.organizationProfile) {
    const projection = (ports.createProjection || require('../../src/platformOnboarding/memberProjection').createMemberProjection)({
      tenantApiProfile: require('../../src/security/tenantApiProfile').PRODUCTION_EDITORIAL_PROFILE,
      bindings: [{ organizationId: o.id, credentials: tenantCredentials, snapshot: published }], allowedResidency: [{ regionCode: snapshot.regionCode, policyVersion: snapshot.residencyPolicyVersion }],
      createPool: options => new Pool({ ...options, ssl: config.target?.ssl ?? options.ssl })
    });
    const projected = await projection.ensure({ operationId: config.installationId, organizationId: o.id, globalUserId: a.globalUserId, membershipId: a.membershipId, input: { adminName: a.name, adminEmail: a.email } });
    if (!projected?.projected || projected.operationId !== config.installationId || projected.organizationId !== o.id || projected.globalUserId !== a.globalUserId || projected.membershipId !== a.membershipId) fail('PRODUCTION_BOOTSTRAP_PROJECTION_INVALID');
    await onPhase('administrator-projected');
  }

  const finalize = async c => {
    if ((await c.query(q.ready, [o.id])).rowCount !== 1) fail('PRODUCTION_TENANT_NOT_READY');
    if (completed && (await c.query(q.orgActive, [o.id])).rowCount !== 1) fail('PRODUCTION_BOOTSTRAP_IDENTITY_CONFLICT');
    if (a.organizationProfile) {
      const member = (await c.query(q.member, [a.membershipId, o.id, a.globalUserId])).rows[0]; assertMember(member, a, o);
      const prior = (await c.query(memberSql.state, [o.id, a.membershipId])).rows[0];
      if (member.status === 'ACTIVE') assertGrants(prior, grants);
      else {
        if (completed) fail('PRODUCTION_BOOTSTRAP_IDENTITY_CONFLICT');
        if (prior) fail('PRODUCTION_BOOTSTRAP_AUTHORIZATION_CONFLICT');
        const activated = await c.query(q.activateMember, [a.membershipId, o.id]);
        if (activated.rowCount !== 1) fail('PRODUCTION_BOOTSTRAP_IDENTITY_CONFLICT');
        await c.query(q.grants, [o.id, a.membershipId, POLICY, JSON.stringify(grants), JSON.stringify(ASSURANCE)]);
        await audit(c, event(config, 'PLATFORM_ADMINISTRATOR_ACTIVATED', 'organization-administrator-activated', 'ORGANIZATION_MEMBERSHIP', a.membershipId));
      }
    }
    if (!completed && (await c.query(q.activeOrg, [o.id])).rowCount === 1) await audit(c, event(config, 'PLATFORM_ONBOARDING_ADVANCED', 'organization-active', 'ORGANIZATION', o.id));
  };
  if (completed) await coordinator.withAuthority(() => finalize(coordinator.pool));
  else await coordinator.write([`ORG:${o.id}`, `SUBJECT:${a.globalUserId}`, ...(a.organizationProfile ? [`MEMBER:${a.membershipId}`] : [])], finalize);
  await onPhase('identity-active');
  return Object.freeze({ status: 'READY', installationId: config.installationId, organizationId: o.id, tenantId: t.id, administratorId: a.globalUserId,
    organizationMembershipId: a.membershipId, platformRole: 'C4G_ADMIN', organizationProfile: a.organizationProfile, assurancePolicyVersion: POLICY });
}

module.exports = { verifyAdministrator, bootstrapIdentity, bootstrapIds };
