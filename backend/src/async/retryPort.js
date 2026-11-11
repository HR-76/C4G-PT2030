'use strict';
const crypto=require('node:crypto');
const {validateEnvelope,isTrustedObservability}=require('./envelope');
const {isTrustedResult}=require('./jobResult');
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function createPersistentRetryPort({outboxRepository,registry,clock=()=>new Date(),id=()=>crypto.randomUUID(),observabilityFactory}){
 if(!outboxRepository||typeof outboxRepository.enqueueLineage!=='function'||typeof outboxRepository.findLineage!=='function'||!registry||typeof registry.supports!=='function'||typeof observabilityFactory!=='function')throw new TypeError('Retry port dependencies are invalid.');
 return Object.freeze({async schedule({client,envelope,result,runAt,attempt,rootExecutionId}){
  if(!client||!isTrustedResult(result,'RETRYABLE')||!Number.isInteger(attempt)||attempt<2||attempt>5||!UUID.test(rootExecutionId||'')||!(runAt instanceof Date)||!Number.isFinite(runAt.getTime()))throw new TypeError('Retry transition is invalid.');
  const previous=validateEnvelope(envelope,registry);if(Date.parse(envelope.deadlineAt)<=runAt.getTime())throw Object.assign(new Error('Retry deadline expired.'),{code:'EXPIRED'});const logicalId=`retry:${previous.envelope.executionId}:${attempt}`,existing=await outboxRepository.findLineage(client,{organizationId:envelope.organizationId,logicalId});if(existing){if(existing.delivery_kind!=='RETRY'||existing.attempt!==attempt||existing.root_execution_id!==rootExecutionId||existing.previous_execution_id!==envelope.executionId||existing.content_digest!==previous.contentDigest||existing.available_at!==runAt.toISOString())throw new Error('RETRY_LINEAGE_CONFLICT');return Object.freeze({executionId:existing.execution_id,attempt,runAt:existing.available_at,created:false,contentDigest:existing.content_digest,envelopeDigest:existing.envelope_digest});}const now=clock(),executionId=id(),observability=observabilityFactory(previous.envelope);if(!(now instanceof Date)||!UUID.test(executionId)||!isTrustedObservability(observability))throw new TypeError('Retry trusted context is invalid.');
  const retry={...previous.envelope,executionId,createdAt:now.toISOString(),observability};const validated=validateEnvelope(retry,registry);if(validated.contentDigest!==previous.contentDigest)throw new Error('RETRY_CONTENT_CONFLICT');
  const lineage=Object.freeze({deliveryKind:'RETRY',attempt,rootExecutionId,previousExecutionId:previous.envelope.executionId,contentDigest:validated.contentDigest,envelopeDigest:validated.envelopeDigest,replayRequestId:null});const persisted=await outboxRepository.enqueueLineage(client,{organizationId:retry.organizationId,logicalId,envelope:validated.envelope,lineage,availableAt:runAt});return Object.freeze({executionId,attempt,runAt:runAt.toISOString(),created:persisted.created,contentDigest:validated.contentDigest,envelopeDigest:validated.envelopeDigest});
 }});
}
module.exports={createPersistentRetryPort};
