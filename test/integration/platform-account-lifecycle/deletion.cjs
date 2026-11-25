'use strict';
const assert = require('node:assert/strict');
const { randomUUID, createHash } = require('node:crypto');
const { createUserDeletion } = require('../../../backend/src/platformDirectory/deletion');
const { createOnboardingAudit } = require('../../../backend/src/platformOnboarding/audit');
const { RECOGNIZED_ASSURANCE_POLICIES } = require('../../../backend/src/security/authConfig');

// The caller owns a disposable 058 cluster and supplies the real, limited authority coordinator.
// Only synthetic fixture insertion and verification use the administrative pool. Identity and
// tenant erasure ports below are explicit doubles; this gate makes no live provider claim.
async function run({ pool, coordinator, check }) {
  const ids = Object.fromEntries(['actor', 'target', 'outsider', 'lastAdmin', 'orgA', 'orgB', 'orgC',
    'member', 'otherMember', 'lastAdminMember', 'operation', 'invitation', 'identity', 'subject', 'request']
    .map(name => [name, randomUUID()]));
  const issuer = 'https://identity.example.invalid/realms/lifecycle';
  const sessions = Object.fromEntries(['actor', 'target', 'outsider', 'lastAdmin'].map(name => [name, randomUUID()]));
  const email = id => `${id}@example.invalid`;
  const digest = () => createHash('sha256').update(randomUUID()).digest('hex');
  const setup = await pool.connect();
  try {
    await setup.query('BEGIN');
    // Fixture insertion only: the service must acquire actual authority permits for every mutation.
    await setup.query("SET LOCAL session_replication_role='replica'");
    for (const name of ['actor', 'target', 'outsider', 'lastAdmin']) {
      await setup.query("INSERT INTO public.global_user(id,display_name,primary_email,status) VALUES($1,$2,$3,'ACTIVE')",
        [ids[name], `Synthetic deletion ${name}`, email(ids[name])]);
      await setup.query(`INSERT INTO public.application_session(sid,global_user_id,status,revocation_version,created_at,last_seen_at,expires_at)
        VALUES($1,$2,'ACTIVE',1,clock_timestamp(),clock_timestamp(),clock_timestamp()+interval '1 hour')`, [sessions[name], ids[name]]);
      await setup.query("INSERT INTO public.application_session_store(sid,sess,expire) VALUES($1,$2,clock_timestamp()+interval '1 hour')",
        [sessions[name], JSON.stringify({ user: { id: ids[name] }, synthetic: true })]);
    }
    for (const name of ['orgA', 'orgB', 'orgC']) {
      await setup.query(`INSERT INTO public.organization(id,legal_name,display_name,slug,type_code,status,reporting_currency,mfa_policy_code)
        VALUES($1,$2,$2,$3,'COMPANY','ACTIVE','EUR','OPTIONAL')`,
      [ids[name], `Synthetic deletion ${name}`, `deletion-${ids[name]}`]);
    }
    for (const name of ['actor', 'target']) {
      await setup.query("INSERT INTO public.platform_admin_assignment(id,global_user_id,role_code,status) VALUES($1,$2,'C4G_ADMIN','ACTIVE')",
        [randomUUID(), ids[name]]);
    }
    for (const [member, user, organization, profile] of [
      ['member', 'target', 'orgA', 'CONTRIBUTOR'], ['otherMember', 'outsider', 'orgB', 'CONTRIBUTOR'],
      ['lastAdminMember', 'lastAdmin', 'orgC', 'ORG_ADMIN']
    ]) {
      await setup.query(`INSERT INTO public.organization_membership(id,global_user_id,organization_id,base_role_code,status,activated_at)
        VALUES($1,$2,$3,$4,'ACTIVE',clock_timestamp())`, [ids[member], ids[user], ids[organization], profile]);
    }
    await setup.query('INSERT INTO public.auth_identity_ref(id,global_user_id,issuer,subject) VALUES($1,$2,$3,$4)',
      [ids.identity, ids.target, issuer, ids.subject]);
    await setup.query(`INSERT INTO public.platform_member_operation(id,organization_id,requested_by,request_key,intent_digest,input,
      global_user_id,membership_id,profile_code,phase,status,receipt)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,'CONTRIBUTOR','COMPLETE','COMPLETE',$9)`,
    [ids.operation, ids.orgA, ids.actor, randomUUID(), digest(),
      JSON.stringify({ adminName: 'Synthetic deletion target', adminEmail: email(ids.target), expectedSubject: ids.subject }),
      ids.target, ids.member, JSON.stringify({ subject: ids.subject, activationEmail: { status: 'ACCEPTED' }, preserved: 'technical-receipt' })]);
    await setup.query(`INSERT INTO public.platform_member_invitation(id,operation_id,request_key,issued_by,digest,replace_requested,
      expires_at,exchange_digest,binding_digest,exchange_until,verified_identity)
      VALUES($1,$2,$3,$4,$5,false,clock_timestamp()+interval '1 hour',$6,$7,clock_timestamp()+interval '10 minutes',$8)`,
    [ids.invitation, ids.operation, randomUUID(), ids.actor, digest(), digest(), digest(), JSON.stringify({ issuer, subject: ids.subject })]);
    await setup.query('COMMIT');
  } catch (error) {
    await setup.query('ROLLBACK');
    throw error;
  } finally { setup.release(); }

  const rows = async (sql, values) => (await pool.query(sql, values)).rows;
  async function accountSnapshot(id) {
    const queries = {
      user: 'SELECT to_jsonb(t) AS row FROM public.global_user t WHERE id=$1',
      identities: 'SELECT to_jsonb(t) AS row FROM public.auth_identity_ref t WHERE global_user_id=$1 ORDER BY id',
      memberships: 'SELECT to_jsonb(t) AS row FROM public.organization_membership t WHERE global_user_id=$1 ORDER BY id',
      roles: 'SELECT to_jsonb(t) AS row FROM public.platform_admin_assignment t WHERE global_user_id=$1 ORDER BY id',
      sessions: 'SELECT to_jsonb(t) AS row FROM public.application_session t WHERE global_user_id=$1 ORDER BY sid',
      payloads: 'SELECT to_jsonb(t) AS row FROM public.application_session_store t WHERE sid IN (SELECT sid FROM public.application_session WHERE global_user_id=$1) ORDER BY sid',
      operations: 'SELECT to_jsonb(t) AS row FROM public.platform_member_operation t WHERE global_user_id=$1 ORDER BY id',
      invitations: 'SELECT to_jsonb(t) AS row FROM public.platform_member_invitation t WHERE operation_id IN (SELECT id FROM public.platform_member_operation WHERE global_user_id=$1) ORDER BY id',
      deletion: 'SELECT to_jsonb(t) AS row FROM public.platform_user_deletion t WHERE global_user_id=$1',
      audit: "SELECT to_jsonb(t) AS row FROM audit.event t WHERE idempotency_key=ANY($1::text[]) ORDER BY event_id"
    };
    return Object.fromEntries(await Promise.all(Object.entries(queries).map(async ([name, sql]) =>
      [name, await rows(sql, name === 'audit' ? [[`user-deletion:${id}:start`, `user-deletion:${id}:complete`]] : [id])])));
  }
  const beforeTarget = await accountSnapshot(ids.target);
  const beforeOthers = await Promise.all([ids.actor, ids.outsider, ids.lastAdmin].map(accountSnapshot));
  const beforeOrganizations = await rows('SELECT to_jsonb(t) AS row FROM public.organization t WHERE id=ANY($1::uuid[]) ORDER BY id', [[ids.orgA, ids.orgB, ids.orgC]]);
  const version = 'c4g-user-mfa-v1', now = Date.now();
  const policy = RECOGNIZED_ASSURANCE_POLICIES[version];
  const request = (name = 'actor', changes = {}) => ({ user: { id: ids[name] }, sessionID: sessions[name],
    authContext: { sessionId: sessions[name], evidence: { policyVersion: version, authTime: now / 1000 - 10,
      acr: 'c4g-loa1', amr: ['pwd'], ...changes } } });
  const input = { requestId: ids.request, expectedRevision: 1, confirmation: 'ELIMINAR' };
  const identityCalls = [], projectionCalls = [];
  let failAudit = false, failIdentity = true;
  const audit = createOnboardingAudit();
  async function assertRevoked() {
    const snapshot = await accountSnapshot(ids.target);
    assert.equal(snapshot.user[0].row.status, 'ARCHIVED');
    assert.equal(snapshot.user[0].row.session_revocation_version, 2);
    assert.equal(snapshot.memberships[0].row.status, 'REMOVED');
    assert.equal(snapshot.memberships[0].row.membership_version, 2);
    assert.equal(snapshot.roles[0].row.status, 'REVOKED');
    assert.equal(snapshot.sessions[0].row.status, 'REVOKED');
    assert.equal(snapshot.sessions[0].row.revocation_reason, 'ACCOUNT_DELETED');
    assert.equal(snapshot.payloads.length, 0);
    assert.equal(snapshot.invitations[0].row.status, 'REVOKED');
    return snapshot;
  }
  const service = createUserDeletion({ coordinator, issuer, policyVersion: version,
    recentMfaRequirement: policy.policy[policy.privilegedCategory], clock: () => now,
    audit: async (client, event) => {
      await audit(client, event);
      if (failAudit) throw Error('ISOLATED_DELETION_AUDIT_FAILURE');
    },
    identity: { async remove(value) {
      assert.deepEqual(value, { issuer, subject: ids.subject });
      await assertRevoked();
      identityCalls.push(value);
      if (failIdentity) throw Error('ISOLATED_IDENTITY_UNAVAILABLE');
      return { ...value, deleted: true };
    } },
    projection: { async anonymize(value) {
      assert.deepEqual(value, { organizationId: ids.orgA, membershipId: ids.member, globalUserId: ids.target, requestId: ids.request });
      await assertRevoked();
      projectionCalls.push(value);
      return { ...value, anonymized: true };
    } }
  });

  await check('deletion: 058 readiness and status use the limited authority protocol', async () => {
    assert.deepEqual(await service.ready(), { ready: true });
    assert.deepEqual(await service.status(ids.target, request()), { userId: ids.target, phase: 'NOT_STARTED', accessRevoked: false, expectedRevision: 1 });
  });
  await check('deletion: optional MFA still rejects unauthorized, stale and invalid authentication without effects', async () => {
    const invalidSession = request(); invalidSession.sessionID = randomUUID();
    const missingEvidence = request(); delete missingEvidence.authContext.evidence;
    for (const [req, body, code] of [
      [request('outsider'), input, 'C4G_ADMIN_REQUIRED'], [invalidSession, input, 'C4G_ADMIN_REQUIRED'],
      [missingEvidence, input, 'REAUTH_REQUIRED'], [request('actor', { authTime: now / 1000 - 301 }), input, 'REAUTH_REQUIRED'],
      [request('actor', { authTime: now / 1000 + 1 }), input, 'REAUTH_REQUIRED'],
      [request('actor', { policyVersion: 'another-policy' }), input, 'REAUTH_REQUIRED'],
      [request(), { ...input, expectedRevision: 2 }, 'STALE_REVISION']
    ]) {
      await assert.rejects(service.remove(ids.target, body, req), { code });
      assert.deepEqual(await accountSnapshot(ids.target), beforeTarget);
    }
    assert.equal(identityCalls.length, 0); assert.equal(projectionCalls.length, 0);
  });
  await check('deletion: own account and the last active organization administrator are protected', async () => {
    await assert.rejects(service.remove(ids.actor, input, request()), { code: 'SELF_ACCESS_PROTECTED' });
    await assert.rejects(service.remove(ids.lastAdmin, input, request()), { code: 'LAST_ADMIN_PROTECTED' });
    assert.deepEqual(await Promise.all([ids.actor, ids.outsider, ids.lastAdmin].map(accountSnapshot)), beforeOthers);
    assert.equal(identityCalls.length, 0);
  });
  await check('deletion: audit failure rolls back journal, access revocation and the actual audit append', async () => {
    failAudit = true;
    try { await assert.rejects(service.remove(ids.target, input, request()), /ISOLATED_DELETION_AUDIT_FAILURE/); }
    finally { failAudit = false; }
    assert.deepEqual(await accountSnapshot(ids.target), beforeTarget);
    assert.equal(identityCalls.length, 0); assert.equal(projectionCalls.length, 0);
  });
  await check('deletion: recent password authentication revokes access before an external failure', async () => {
    await assert.rejects(service.remove(ids.target, input, request()), /ISOLATED_IDENTITY_UNAVAILABLE/);
    const blocked = await assertRevoked();
    assert.equal(blocked.deletion[0].row.phase, 'BLOCKED');
    assert.equal(blocked.user[0].row.display_name, beforeTarget.user[0].row.display_name);
    assert.equal(blocked.audit.length, 1);
    assert.equal(identityCalls.length, 1); assert.equal(projectionCalls.length, 0);
    await assert.rejects(service.remove(ids.target, input, request('actor', { authTime: now / 1000 - 301 })), { code: 'REAUTH_REQUIRED' });
    await assert.rejects(service.remove(ids.target, { ...input, requestId: randomUUID() }, request()), { code: 'DELETION_CONFLICT' });
    assert.deepEqual(await accountSnapshot(ids.target), blocked);
    assert.equal(identityCalls.length, 1);
  });
  await check('deletion: retry completes selective anonymization and replay has no repeated effects', async () => {
    failIdentity = false;
    const result = await service.remove(ids.target, input, request());
    assert.deepEqual(result, { userId: ids.target, requestId: ids.request, phase: 'COMPLETE', accessRevoked: true });
    const complete = await assertRevoked();
    assert.equal(complete.user[0].row.id, ids.target);
    assert.equal(complete.user[0].row.display_name, 'Utilizador eliminado');
    assert.equal(complete.user[0].row.primary_email, `deleted-${ids.target}@deleted.invalid`);
    assert.equal(complete.identities[0].row.subject, `deleted:${ids.identity}`);
    assert.equal(complete.operations[0].row.id, ids.operation);
    assert.deepEqual(complete.operations[0].row.input, { adminName: 'Utilizador eliminado', adminEmail: `deleted-${ids.target}@deleted.invalid` });
    assert.deepEqual(complete.operations[0].row.receipt, { preserved: 'technical-receipt' });
    for (const field of ['verified_identity', 'exchange_digest', 'binding_digest', 'exchange_until']) assert.equal(complete.invitations[0].row[field], null);
    assert.equal(complete.deletion[0].row.phase, 'COMPLETE');
    assert.deepEqual(complete.deletion[0].row.identities, []);
    assert.ok(complete.deletion[0].row.completed_at);
    assert.equal(complete.audit.length, 2);
    assert.equal(identityCalls.length, 2); assert.equal(projectionCalls.length, 1);
    assert.deepEqual(await service.remove(ids.target, input, request()), result);
    assert.deepEqual(await accountSnapshot(ids.target), complete);
    assert.equal(identityCalls.length, 2); assert.equal(projectionCalls.length, 1);
    assert.deepEqual(await Promise.all([ids.actor, ids.outsider, ids.lastAdmin].map(accountSnapshot)), beforeOthers);
    assert.deepEqual(await rows('SELECT to_jsonb(t) AS row FROM public.organization t WHERE id=ANY($1::uuid[]) ORDER BY id', [[ids.orgA, ids.orgB, ids.orgC]]), beforeOrganizations);
  });
  return { checks: 6, identityProvider: 'SIMULATED', tenantProjection: 'SIMULATED', data: 'SYNTHETIC' };
}

module.exports = { run };
