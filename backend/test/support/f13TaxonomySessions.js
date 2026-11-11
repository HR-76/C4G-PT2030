'use strict';
const { InMemorySessionRegistry } = require('../../src/security/sessionRegistry');
const { createTaxonomySessionAuthority } = require('../../src/organizationalProfile/taxonomySessionAuthority');

// Synthetic F3 session registry and F5 data ports; SQL/effects use the production tenant composition.
function createTaxonomySessions({ organizationId, clock = { now: () => new Date() },authorityCoordinator=null }) {
  const registry = new InMemorySessionRegistry(), sessions = new Map(), memberships = new Map(), snapshots = new Map();
  const membershipPort = { async revalidate(actor) { return memberships.get(actor.membershipId) || null; } };
  const authorizationDataPort = { async load(actor) { return snapshots.get(actor.membershipId) || null; } };
  const sessionStore = { get(sid, callback) { callback(null, sessions.get(sid)); } };
  const authority = createTaxonomySessionAuthority({ sessionStore,
    sessionRegistry: registry, membershipPort, authorizationDataPort, clock,authorityCoordinator, policyVersion: 'c4g-assurance-v1' });
  async function user(id, membershipId, org = organizationId) {
    const sid = `synthetic-${id}`, organizationContext = { organizationId: org, membershipId, membershipVersion: 1 };
    memberships.set(membershipId, { id: membershipId, organizationId: org, globalUserId: id, membershipVersion: 1, status: 'ACTIVE' });
    snapshots.set(membershipId, { organizationId: org, membershipVersion: 1, authorizationVersion: 1, profileCode: 'ORG_ADMIN',
      grants: [], sodRules: [{ code: 'F13_TAXONOMY_CONCEPT_SOD', distinctFromActorIds: [] },
        { code: 'F13_TAXONOMY_RELEASE_SOD', distinctFromActorIds: [] }], supportGrant: null });
    sessions.set(sid, { auth: { user: { id }, absoluteExpiresAt: clock.now().getTime() + 3600000, revocationVersion: 1,
      policyVersion: 'c4g-assurance-v1', organizationContext,
      evidence: { authTime: Math.floor(clock.now().getTime() / 1000), acr: 'c4g-loa2', amr: ['otp'], policyVersion: 'c4g-assurance-v1' } } });
    await registry.rotateSession({ sid, globalUserId: id, revocationVersion: 1,
      expiresAt: sessions.get(sid).auth.absoluteExpiresAt, organizationContext });
    const request = { sessionID: sid, user: { id }, authContext: { sessionId: sid }, organizationContext };
    return { id, membershipId, sid, request, handle: await authority.captureAuthenticatedRequest(request) };
  }
  function grants(user, entries) {
    snapshots.get(user.membershipId).grants = entries.map(entry => ({ permission: entry.permission,
      ...(entry.resourceId ? { resourceId: entry.resourceId } : {}), ...(entry.resourceType ? { resourceType: entry.resourceType } : {}),
      scope: { type: 'ORGANIZATION', id: snapshots.get(user.membershipId).organizationId,
        organizationId: snapshots.get(user.membershipId).organizationId } }));
  }
  return { authority, sessionStore, registry, sessions, memberships, snapshots, membershipPort, authorizationDataPort, user, grants };
}
module.exports = { createTaxonomySessions };
