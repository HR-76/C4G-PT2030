'use strict';
const VALIDATORS = require('./editorialContracts');
const { isPreparedTenantTransaction } = require('../security/tenantLeaseExecutor');
const { OrganizationalProfileContractError } = require('./errors');
const OPS = Object.freeze({ submit: 'F13_PROFILE_SUBMIT', approve: 'F13_PROFILE_APPROVE', publish: 'F13_PROFILE_PUBLISH',
  readCandidate: 'F13_PROFILE_READ', readVersion: 'F13_PROFILE_READ' });
function createPreparedEditorialService({ repository, contexts, revalidate, protectAuthorization, admitAuthorization }) {
  return Object.freeze({ async execute(client, method, command, context, reconciliation = false) {
    if (!contexts.has(context) || !isPreparedTenantTransaction(client, { organizationId: context.organizationId,
      tenantId: context.organizationId, workload: 'API', requiredCapabilities: ['F13_EDITORIAL_BASELINE_PUBLICATION', 'F7_AUDIT_LEDGER'] })) {
      throw new OrganizationalProfileContractError('F13_AUTHORIZATION_REQUIRED');
    }
    await admitAuthorization(method, command, context);
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended('F13-P1:' || $1::text,43001301))", [context.organizationId]);
    const replay = await repository.lockIntention(client, method, command);
    const loaded = await repository.resource(client, method, command, replay);
    context = await revalidate(context);
    const protectedDecision = await protectAuthorization(client, method, command, context, loaded);
    const decision = protectedDecision.decision;
    if (!decision.allowed || !decision.evaluation) throw new OrganizationalProfileContractError('F13_AUTHORIZATION_REQUIRED');
    const input = Object.freeze({ ...decision.trustedContext, authorizationEvidence: decision.evaluation,
      editorialAuthorityEvidence: protectedDecision.editorialAuthorityEvidence, idempotencyKey: command.idempotencyKey });
    if (reconciliation && !method.startsWith('read')) return repository.reconcile(client, method, command);
    return repository.execute(client, method, command, input, loaded);
  } });
}
module.exports = { OPS, VALIDATORS, createPreparedEditorialService };
