'use strict';

const { OpportunityError } = require('./errors');

const METHOD_CONTRACTS = Object.freeze({
  create: Object.freeze({ operationCode: 'OPPORTUNITY_PRIVATE_CREATE', actor: 'HUMAN' }),
  get: Object.freeze({ operationCode: 'OPPORTUNITY_PRIVATE_GET', actor: 'ANY' }),
  list: Object.freeze({ operationCode: 'OPPORTUNITY_PRIVATE_LIST', actor: 'ANY' }),
  update: Object.freeze({ operationCode: 'OPPORTUNITY_PRIVATE_UPDATE', actor: 'HUMAN' }),
  archive: Object.freeze({ operationCode: 'OPPORTUNITY_PRIVATE_ARCHIVE', actor: 'HUMAN' }),
  restore: Object.freeze({ operationCode: 'OPPORTUNITY_PRIVATE_RESTORE', actor: 'HUMAN' }),
  reviewDuplicate: Object.freeze({ operationCode: 'OPPORTUNITY_DUPLICATE_REVIEW', actor: 'HUMAN' }),
  runDuplicateScan: Object.freeze({ operationCode: 'OPPORTUNITY_DUPLICATE_SCAN_JOB', actor: 'F12_DUPLICATE_SCANNER' }),
  runCatalogReconcile: Object.freeze({ operationCode: 'OPPORTUNITY_CATALOG_RECONCILE_JOB', actor: 'F12_CATALOG_RECONCILER' }),
  bindDocument: Object.freeze({ operationCode: 'OPPORTUNITY_DOCUMENT_BIND', actor: 'HUMAN', document: true })
});

function closed(value, keys) {
  return value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype
    && Reflect.ownKeys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
}

function createF12TenantLeaseAdapters({ authorization, resolver, operations }) {
  if (!authorization || typeof authorization.authorize !== 'function' || !resolver || typeof resolver.resolve !== 'function'
      || !operations || !operations.catalog || !operations.adapters) {
    throw new TypeError('F12 tenant lease adapter dependencies are invalid.');
  }
  async function execute(contract, input) {
    if (!closed(input, ['actor', 'resourceId', 'assuranceEvidence', 'correlationId', 'organizationContext', 'payload'])) {
      throw new TypeError('F12 tenant lease adapter input is invalid.');
    }
    const adapter = operations.adapters[contract.operationCode];
    const operation = operations.catalog.resolveAdapter(adapter);
    if (!operation) throw new OpportunityError('OPPORTUNITY_UNAVAILABLE');
    if (contract.actor === 'HUMAN' && input.actor?.type !== 'HUMAN') throw new OpportunityError('OPPORTUNITY_NOT_FOUND');
    if (contract.actor !== 'ANY' && contract.actor !== 'HUMAN'
        && (input.actor?.type !== 'SERVICE' || input.actor.id !== contract.actor
          || input.actor.operationCode !== operation.requiredPermission)) {
      throw new OpportunityError('OPPORTUNITY_NOT_FOUND');
    }
    const decision = await authorization.authorize({ operationCode: operation.requiredPermission, actor: input.actor,
      resourceId: input.resourceId, assuranceEvidence: input.assuranceEvidence, correlationId: input.correlationId });
    if (!decision?.allowed || decision.operation?.code !== operation.requiredPermission) {
      throw new OpportunityError('OPPORTUNITY_NOT_FOUND');
    }
    if (contract.document) {
      const documentId = input.payload?.documentId;
      const documentDecision = await authorization.authorize({ operationCode: 'DOCUMENT_READ', actor: input.actor,
        resourceId: documentId, assuranceEvidence: input.assuranceEvidence, correlationId: input.correlationId });
      if (!documentDecision?.allowed || documentDecision.operation?.code !== 'DOCUMENT_READ') {
        throw new OpportunityError('OPPORTUNITY_NOT_FOUND');
      }
    }
    const lease = await resolver.resolve({ organizationContext: input.organizationContext,
      operationAdapter: adapter, correlationId: input.correlationId });
    return lease.execute(Object.freeze({
      payload: input.payload,
      trustedContext: Object.freeze({
        actor: input.actor,
        correlationId: input.correlationId,
        assuranceEvidence: input.assuranceEvidence,
        organizationContext: input.organizationContext,
        resourceId: input.resourceId
      })
    }));
  }
  return Object.freeze(Object.fromEntries(Object.entries(METHOD_CONTRACTS).map(([method, contract]) => [method,
    input => execute(contract, input)
  ])));
}

module.exports = { METHOD_CONTRACTS, createF12TenantLeaseAdapters };
