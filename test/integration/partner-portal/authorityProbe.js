'use strict';
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { isPreparedEnvironment } = require('./environment');
const authorityCaseIds = Object.freeze(['membership-authority-first', 'membership-guard-first', 'policy-authority-first',
  'policy-guard-first', 'session-revoked', 'team-before-read', 'team-during-unseen-resource', 'team-cache-hit', 'audit-failure']);
// Pure assertion of the current authenticated-authority contract. An unrelated
// network/SQL failure must not masquerade as successful revocation evidence.
function assertRevocationRefusal(kind, error) {
  assert(['membership', 'policy', 'session'].includes(kind), 'PARTNER_GATE_REVOCATION_KIND_INVALID');
  const refusalCode = kind === 'policy' ? 'AUTHORITY_UNAVAILABLE' : 'AUTHORITY_REQUIRED';
  const authorityFailure = kind === 'policy' ? null : kind === 'membership' ? 'MEMBERSHIP_INVALID' : 'SESSION_INVALID';
  assert.equal(error?.code, refusalCode, 'PARTNER_GATE_WRONG_REVOCATION_FAILURE');
  assert.equal(error?.authorityFailure ?? null, authorityFailure, 'PARTNER_GATE_WRONG_REVOCATION_REASON');
  return { refusalCode, authorityFailure };
}
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(check, timeout = 3000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) { if (await check()) return; await delay(20); }
  throw Error('PARTNER_GATE_BARRIER_TIMEOUT');
}
function barrier() {
  let arrive, release;
  const arrived = new Promise(resolve => { arrive = resolve; }), resumed = new Promise(resolve => { release = resolve; });
  return { arrived, release, async pause() { arrive(); await resumed; } };
}
async function auditCount(tenant, actor) {
  return (await tenant.pool.query('SELECT count(*)::int n FROM audit.event WHERE organization_id=$1 AND actor_id=$2',
    [tenant.organizationId, actor.id])).rows[0].n;
}

// Real application composition, authority writers, F7 and tenant PostgreSQL.
// Synthetic bootstrap sessions are used; this gate makes no OIDC/browser claim.
// Return only case IDs/counters/order evidence, never raw SQL, session IDs,
// connection strings, keys, grants payloads or error messages from dependencies.
async function runAuthorityGate(env) {
  assert(isPreparedEnvironment(env), 'PARTNER_GATE_ENVIRONMENT_REQUIRED');
  const tenant = env.tenants[0], service = env.composition('candidate'), cases = [];
  const membership = require('../../../backend/src/security/membershipRepository').createMembershipRepository(env.central.pool, env.central.coordinator);
  let sequence = 0;
  const previousHooks = { ...env.hooks };
  function clearHooks() { for (const key of Object.keys(env.hooks)) env.hooks[key] = null; }
  async function seed(label, count = 1, sharedApplication = false) {
    const applicationIds = [], partnerIds = [], body = { entity_name: `Authority ${label}`, country: 'Portugal',
      research_area_interest: '', responsible_person: '', contact: '', email: '', people: [] };
    const ordinal = ++sequence;
    for (let index = 0; index < count; index++) {
      let applicationId = sharedApplication && applicationIds[0];
      if (!applicationId) {
        applicationId = randomUUID(); applicationIds.push(applicationId);
        await tenant.pool.query(`INSERT INTO opportunity_catalog.application
          (organization_id,application_id,opportunity_id,title,responsible_membership_id,deadline,created_by)
          VALUES($1,$2,$3,$4,$5,'2027-01-01',$6)`, [tenant.organizationId, applicationId, tenant.opportunityId,
          `Authority ${label}`, tenant.owner.membershipId, tenant.owner.id]);
      }
      const partnerId = `70000000-0000-4000-8000-${String(ordinal).padStart(6, '0')}${String(index + 1).padStart(6, '0')}`;
      partnerIds.push(partnerId);
      await tenant.pool.query(`INSERT INTO opportunity_catalog.application_partner(organization_id,application_id,partner_id,body)
        VALUES($1,$2,$3,$4)`, [tenant.organizationId, applicationId, partnerId, body]);
    }
    return { applicationIds, partnerIds, q: `Authority ${label}`, async retire() {
      await tenant.pool.query('UPDATE opportunity_catalog.application_partner SET active=false WHERE organization_id=$1 AND partner_id=ANY($2::uuid[])',
        [tenant.organizationId, partnerIds]);
    } };
  }
  async function read(actor, fixture) { return service.execute('partnersBrowse', { q: fixture.q }, null, actor.request); }
  async function denyRead(actor, fixture, revocationKind) {
    let failure;
    try { await read(actor, fixture); } catch (error) { failure = error; }
    assert(failure, 'revoked authority cannot publish a result');
    return revocationKind ? assertRevocationRefusal(revocationKind, failure) : {
      refusalCode: typeof failure.code === 'string' && /^[A-Z0-9_]{2,80}$/.test(failure.code) ? failure.code : 'UNAVAILABLE' };
  }
  async function writer(kind, actor) {
    if (kind === 'membership') return membership.changeStatus({ membershipId: actor.membershipId, status: 'SUSPENDED', reason: 'Synthetic isolated partner gate' });
    return env.central.data.change({ organizationId: tenant.organizationId, membershipId: actor.membershipId,
      expectedVersion: actor.authorityVersion, grants: actor.grants, newPolicyVersion: 'partner-gate-changed-policy',
      assuranceRequirements: env.central.requirement });
  }
  async function participate(actor, fixture) {
    for (const applicationId of fixture.applicationIds) await tenant.pool.query(`INSERT INTO opportunity_catalog.application_participant
      (organization_id,application_id,membership_id) VALUES($1,$2,$3)`, [tenant.organizationId, applicationId, actor.membershipId]);
  }
  async function removeParticipant(actor, applicationId) {
    return service.execute('participantRemove', { expectedRevision: 1, idempotencyKey: randomUUID(), membershipId: actor.membershipId },
      applicationId, tenant.owner.request);
  }
  async function fixtureTeamUpdate(actor, applicationId) {
    // Isolate READ COMMITTED/team-cache semantics without waiting on the read's
    // F7 stream lock from a second audited application mutation. Reader ports,
    // guard, authority and audit stay real; writer is explicitly synthetic SQL.
    await tenant.pool.query(`UPDATE opportunity_catalog.application_participant SET active=false,updated_at=clock_timestamp()
      WHERE organization_id=$1 AND application_id=$2 AND membership_id=$3`, [tenant.organizationId, applicationId, actor.membershipId]);
  }
  async function record(id, operation) {
    clearHooks();
    try { cases.push({ id, status: 'PASS', evidence: await operation() }); }
    catch (error) { cases.push({ id, status: 'FAIL', evidence: { failureCode: error.code || 'ASSERTION_OR_PROBE_FAILURE' } }); }
    finally { clearHooks(); }
  }
  try {
    for (const kind of ['membership', 'policy']) {
      await record(`${kind}-authority-first`, async () => {
        const fixture = await seed(`${kind}-authority-first`), actor = await env.actor(tenant);
        try {
          assert.equal((await read(actor, fixture)).total, 1, 'authorized precondition must succeed');
          await writer(kind, actor); const refusal = await denyRead(actor, fixture, kind);
          return { authorizedBefore: true, writerCommittedBeforeRead: true, successfulRead: false, realCentralWriter: true, ...refusal };
        } finally { await fixture.retire(); }
      });
      await record(`${kind}-guard-first`, async () => {
        const fixture = await seed(`${kind}-guard-first`), actor = await env.actor(tenant), gate = barrier();
        let reading, writing, writerCommitted = false, beforeRelease = false, hookReached = false;
        const before = await auditCount(tenant, actor);
        try {
          // All resource decisions and CLOSE have finished, but final guard and
          // transaction completion have not. A Central writer must wait.
          env.hooks.afterQuery = async ({ sql }) => {
            if (!hookReached && /^CLOSE c4g_partner_browse_/.test(sql)) { hookReached = true; await gate.pause(); }
          };
          reading = read(actor, fixture); reading.catch(() => {});
          await Promise.race([gate.arrived, reading.then(() => { throw Error('PARTNER_GATE_BARRIER_NOT_REACHED'); })]);
          writing = writer(kind, actor).then(value => { writerCommitted = true; return value; }); writing.catch(() => {});
          await until(async () => (await env.central.pool.query(`SELECT EXISTS(SELECT 1 FROM public.authority_write_request
            WHERE state='WAITING' AND $1=ANY(scope_keys)) waiting`, [`MEMBER:${actor.membershipId}`])).rows[0].waiting);
          beforeRelease = writerCommitted; assert.equal(beforeRelease, false);
          gate.release();
          const result = await reading; await writing;
          assert.equal(result.total, 1); assert(writerCommitted);
          assert((await auditCount(tenant, actor)) > before, 'F7 evidence must be durable before successful completion');
          const refusal = await denyRead(actor, fixture, kind);
          return { realCentralWriter: true, writerWaitObserved: true, committedBeforeRelease: beforeRelease,
            firstReadSucceeded: true, nextReadRefused: true, durableAudit: true, ...refusal };
        } finally {
          gate.release(); await Promise.allSettled([reading, writing].filter(Boolean)); await fixture.retire();
        }
      });
    }
    await record('session-revoked', async () => {
      const fixture = await seed('session-revoked'), actor = await env.actor(tenant);
      try { assert.equal((await read(actor, fixture)).total, 1);
        await env.central.registry.revokeSession(actor.sid); const refusal = await denyRead(actor, fixture, 'session');
        return { authorizedBefore: true, realSessionRegistry: true, successfulRead: false, ...refusal }; }
      finally { await fixture.retire(); }
    });
    await record('team-before-read', async () => {
      const fixture = await seed('team-before-read'), actor = await env.actor(tenant, { profileCode: 'CONTRIBUTOR' });
      try {
        await participate(actor, fixture); assert.equal((await read(actor, fixture)).total, 1);
        await removeParticipant(actor, fixture.applicationIds[0]);
        const page = await read(actor, fixture); assert.equal(page.total, 0); assert.deepEqual(page.items, []);
        return { removalThroughApplicationService: true, resultTotal: 0 };
      } finally { await fixture.retire(); }
    });
    await record('team-during-unseen-resource', async () => {
      const fixture = await seed('team-during-unseen-resource', 2), actor = await env.actor(tenant, { profileCode: 'CONTRIBUTOR' });
      let removed = false;
      try {
        await participate(actor, fixture);
        env.hooks.onAuthorize = async ({ operation, allowed }) => {
          if (!removed && operation === 'OPPORTUNITY_READ' && allowed) {
            removed = true; await fixtureTeamUpdate(actor, fixture.applicationIds[1]);
          }
        };
        const page = await read(actor, fixture); assert(removed); assert.equal(page.total, 1);
        assert.equal(page.items[0].application_id, fixture.applicationIds[0]);
        return { writerKind: 'synthetic-direct-team-update', realReaderAuthorityAndAudit: true, changedUnseenResource: true, resultTotal: 1 };
      } finally { await fixture.retire(); }
    });
    await record('team-cache-hit', async () => {
      const fixture = await seed('team-cache-hit', 2, true), actor = await env.actor(tenant, { profileCode: 'CONTRIBUTOR' });
      let removed = false, applicationCalls = 0, teamQueries = 0;
      try {
        await participate(actor, fixture);
        env.hooks.afterQuery = ({ sql }) => { if (sql.includes('JOIN opportunity_catalog.application_participant p')) teamQueries++; };
        env.hooks.onAuthorize = async ({ operation, resource, allowed }) => {
          if (operation === 'APPLICATION_READ' && resource.id === fixture.applicationIds[0]) applicationCalls++;
          if (!removed && operation === 'OPPORTUNITY_READ' && allowed) {
            removed = true; await fixtureTeamUpdate(actor, fixture.applicationIds[0]);
          }
        };
        const page = await read(actor, fixture);
        assert.equal(page.total, 2, 'existing per-request cache retains its earlier decision with guard checks');
        assert.equal(applicationCalls, 2); assert.equal(teamQueries, 2, 'one application and one source team read, no reload on hits');
        clearHooks(); assert.equal((await read(actor, fixture)).total, 0);
        return { writerKind: 'synthetic-direct-team-update', existingCacheSemanticsPreserved: true, applicationPortCalls: applicationCalls,
          actualTeamQueries: teamQueries, firstResultTotal: 2, nextResultTotal: 0 };
      } finally { await fixture.retire(); }
    });
    await record('audit-failure', async () => {
      const fixture = await seed('audit-failure'), actor = await env.actor(tenant);
      let appends = 0, injected = false, injectedSqlState;
      const before = await auditCount(tenant, actor);
      try {
        env.hooks.beforeQuery = async ({ client, sql }) => {
          if (sql.startsWith('SELECT * FROM audit.append_event_v1(') && ++appends === 2) {
            injected = true;
            try { await client.query('SELECT 1 / 0'); } // Real server error; abort this owned fixture transaction.
            catch (error) { injectedSqlState = error.code; throw error; }
          }
        };
        const refusal = await denyRead(actor, fixture); assert(injected, 'fault must occur in actual resource audit, after global guard');
        assert.equal(injectedSqlState, '22012', 'fault must come from real PostgreSQL arithmetic failure');
        clearHooks(); assert.equal(await auditCount(tenant, actor), before, 'no partially committed tenant audit');
        await until(() => env.runtime.poolManager.snapshot().active === 0);
        return { realPostgresFault: true, successfulRead: false, partialAuditRows: 0, activeLeases: 0, injectedSqlState, ...refusal };
      } finally { await fixture.retire(); }
    });
  } finally { clearHooks(); Object.assign(env.hooks, previousHooks); }
  assert.deepEqual(cases.map(item => item.id), authorityCaseIds);
  return { environmentVerified: isPreparedEnvironment(env), cases, limitations: ['Synthetic authenticated sessions; no OIDC/browser proof.',
    'Concurrent team fixtures use direct synthetic SQL; they do not prove concurrent audited mutation endpoint ordering.',
    'Team cache semantics are characterized, not strengthened to immediate revocation within the same request.'] };
}

module.exports = { runAuthorityGate, authorityCaseIds, assertRevocationRefusal };
