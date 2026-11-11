'use strict';
const contracts = require('./taxonomyContracts');
const { OrganizationalProfileContractError } = require('./errors');
const { isPreparedTenantTransaction }=require('../security/tenantLeaseExecutor');
const OPS = Object.freeze({ createRelease: 'F13_TAXONOMY_RELEASE_CREATE', createConcept: 'F13_TAXONOMY_LOCAL_CONCEPT_CREATE',
  approveConcept: 'F13_TAXONOMY_LOCAL_CONCEPT_APPROVE', createRelation: 'F13_TAXONOMY_RELATION_CREATE',
  createMapping: 'F13_TAXONOMY_MAPPING_CREATE', publishRelease: 'F13_TAXONOMY_RELEASE_PUBLISH', readRelease: 'F13_TAXONOMY_READ' });
const VALIDATORS = Object.freeze({ createRelease: contracts.validateCreateRelease, createConcept: contracts.validateCreateConcept,
  approveConcept: contracts.validateApproveConcept, createRelation: contracts.validateRelation,
  createMapping: contracts.validateMapping, publishRelease: contracts.validatePublish, readRelease: contracts.validateRead });

// Contexts are instance-local capabilities issued only by the tenant composition.
function createPreparedTaxonomyService({ repository, loader, authorization, contexts, revalidate, protectAuthorization = null }) {
  return Object.freeze({ async execute(client, method, command, context, reconciliation = false) {
    if (!contexts.has(context) || typeof protectAuthorization!=='function'
      || !isPreparedTenantTransaction(client,{organizationId:context.organizationId,tenantId:context.organizationId,workload:'API',
        requiredCapabilities:['F13_PROFILE_CATALOG_FOUNDATION','F7_AUDIT_LEDGER']})) throw new OrganizationalProfileContractError('F13_AUTHORIZATION_REQUIRED');
    if (method !== 'readRelease') await client.query("SELECT pg_advisory_xact_lock(hashtextextended('F13-TAXONOMY-DAG',43001304))");
    let input = { ...command, ...context };
    const replay = method === 'readRelease' ? false : await repository.lockIntention(client, method, input);
    const resource = await loader.load(client, method, command, replay);
    context = await revalidate(context);
    input = { ...command, ...context };
    const decision = await protectAuthorization(client,method,command,context,resource);
    if (!decision.allowed || !decision.evaluation) throw new OrganizationalProfileContractError('F13_AUTHORIZATION_REQUIRED');
    const authorized = Object.freeze({ ...input,...decision.trustedContext,authorizationEvidence: decision.evaluation });
    if (method === 'readRelease') return repository.readRelease(client, command.releaseId, { global: resource.global });
    if (reconciliation) return repository.reconcile(client, method, authorized);
    return repository[method](client, authorized);
  } });
}
module.exports = { OPS, VALIDATORS, createPreparedTaxonomyService };
