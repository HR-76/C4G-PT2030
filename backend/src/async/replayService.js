'use strict';
const crypto=require('node:crypto');
const {canonical,isTrustedObservability,validateEnvelope}=require('./envelope');
const {replayEnvelope}=require('./deadLetter');
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function digest(value){return crypto.createHash('sha256').update(canonical(value)).digest('hex');}
function exact(value,keys){return value&&typeof value==='object'&&Object.getPrototypeOf(value)===Object.prototype&&Reflect.ownKeys(value).length===keys.length&&keys.every(key=>Object.hasOwn(value,key));}
function human(actor){return actor&&actor.type==='HUMAN'&&UUID.test(actor.id||'')&&UUID.test(actor.organizationId||'')&&UUID.test(actor.membershipId||'')&&Number.isInteger(actor.membershipVersion)&&Number.isInteger(actor.authorizationVersion);}
function transactionPort(value){if(typeof value==='function')return value;if(value&&typeof value.transaction==='function')return value.transaction.bind(value);throw new TypeError('Replay transaction port is invalid.');}
function denial(code){return Object.freeze({allowed:false,code,publicCode:'RESOURCE_NOT_AVAILABLE'});}
function createReplayService({authorization,repository,centralTransaction,tenantLocator,tenantReplayPort,registry,clock=()=>new Date(),id=()=>crypto.randomUUID(),observabilityFactory,capacity=null,policyVersion='f12-replay-policy-v1'}){
 if(!authorization||typeof authorization.authorize!=='function'||!repository||typeof repository.create!=='function'||!tenantLocator||typeof tenantLocator.resolve!=='function'||!tenantReplayPort||typeof tenantReplayPort.run!=='function'||!registry||typeof registry.supports!=='function'||typeof observabilityFactory!=='function')throw new TypeError('Replay service dependencies are invalid.');const central=transactionPort(centralTransaction);
 if(capacity!==null&&(typeof capacity.lockReplay!=='function'||typeof capacity.reserveReplay!=='function'))throw new TypeError('Replay capacity port is invalid.');
 async function request(command){const keys=['originalExecutionId','actor','assuranceEvidence','correlationId','idempotencyKey'];if(!exact(command,keys)||!UUID.test(command.originalExecutionId||'')||!human(command.actor)||!UUID.test(command.correlationId||'')||typeof command.idempotencyKey!=='string')throw new TypeError('Replay request command is invalid.');const execution=await central(c=>repository.loadExecution(c,{executionId:command.originalExecutionId,organizationId:command.actor.organizationId}));if(!execution)return denial('ASYNC_REPLAY_NOT_AVAILABLE');const decision=await authorization.authorize({operationCode:'ASYNC_JOB_REPLAY',actor:command.actor,resourceId:execution.executionId,assuranceEvidence:command.assuranceEvidence,correlationId:command.correlationId});if(!decision.allowed)return denial(decision.reasonCode);const tenant=await tenantLocator.resolve(execution.organizationId);if(!tenant||!UUID.test(tenant.tenantId||''))return denial('ASYNC_REPLAY_NOT_AVAILABLE');return central(async c=>{const existing=await repository.findByCommand(c,{organizationId:execution.organizationId,idempotencyKey:command.idempotencyKey});const replayRequestId=existing?.replayRequestId||id(),requestDigest=digest({organizationId:execution.organizationId,replayRequestId,originalExecutionId:execution.executionId,requesterActorId:command.actor.id,requesterMembershipId:command.actor.membershipId,contentDigest:execution.contentDigest,policyVersion});return repository.create(c,{replayRequestId,organizationId:execution.organizationId,originalExecutionId:execution.executionId,tenantId:tenant.tenantId,requesterActorId:command.actor.id,requesterMembershipId:command.actor.membershipId,policyVersion,requesterRevocationVersion:command.actor.authorizationVersion,idempotencyKey:command.idempotencyKey,requestDigest,correlationId:command.correlationId});});}
 async function approve(command){const keys=['replayRequestId','actor','assuranceEvidence','correlationId'];if(!exact(command,keys)||!UUID.test(command.replayRequestId||'')||!human(command.actor)||!UUID.test(command.correlationId||''))throw new TypeError('Replay approval command is invalid.');const replay=await central(c=>repository.load(c,{replayRequestId:command.replayRequestId,organizationId:command.actor.organizationId}));if(!replay)return denial('ASYNC_REPLAY_NOT_AVAILABLE');const decision=await authorization.authorize({operationCode:'ASYNC_JOB_REPLAY_APPROVE',actor:command.actor,resourceId:replay.originalExecutionId,assuranceEvidence:command.assuranceEvidence,correlationId:command.correlationId});if(!decision.allowed)return denial(decision.reasonCode);if(['APPROVED','RESERVED','CONSUMED'].includes(replay.state))return replay.approverActorId===command.actor.id&&replay.approverMembershipId===command.actor.membershipId?replay:denial('ASYNC_REPLAY_APPROVAL_CONFLICT');const now=clock(),assuranceEnd=new Date((command.assuranceEvidence.authTime+300)*1000),notAfter=new Date(Math.min(now.getTime()+300000,assuranceEnd.getTime())),approvalEvidenceDigest=digest({replayRequestId:replay.replayRequestId,organizationId:replay.organizationId,originalExecutionId:replay.originalExecutionId,rootExecutionId:replay.rootExecutionId,jobType:replay.jobType,contentDigest:replay.contentDigest,requesterActorId:replay.requesterActorId,requesterMembershipId:replay.requesterMembershipId,approverActorId:command.actor.id,approverMembershipId:command.actor.membershipId,policyVersion,requesterRevocationVersion:replay.requesterRevocationVersion,approverRevocationVersion:command.actor.authorizationVersion,approvedAt:now.toISOString(),notAfter:notAfter.toISOString()});return central(async c=>{await capacity?.lockReplay(c,replay);return repository.approve(c,{replayRequestId:replay.replayRequestId,organizationId:replay.organizationId,approverActorId:command.actor.id,approverMembershipId:command.actor.membershipId,approverRevocationVersion:command.actor.authorizationVersion,approvalEvidenceDigest,policyVersion,approvedAt:now.toISOString(),notAfter:notAfter.toISOString(),correlationId:command.correlationId});});}
 async function execute({replayRequestId,organizationId}) {
  if(!UUID.test(replayRequestId||'')||!UUID.test(organizationId||''))throw new TypeError('Replay execution command is invalid.');
  const replay=await central(async client=>{
   const observed=await repository.load(client,{replayRequestId,organizationId});
   if(!observed||!['APPROVED','RESERVED','CONSUMED'].includes(observed.state))return null;
   if(observed.state==='CONSUMED')return observed;
   await capacity?.lockReplay(client,observed);
   const current=capacity?await repository.load(client,{replayRequestId,organizationId}):observed;
   if(current.state==='CONSUMED')return current;
   const executionId=current.reservedExecutionId||id();
   const reservationDigest=digest({replayRequestId,organizationId,tenantId:current.tenantId,jobType:current.jobType,
    contentDigest:current.contentDigest,executionId,policyVersion});
   const reserved=await repository.reserve(client,{replayRequestId,organizationId,executionId,reservationDigest});
   if(capacity&&await capacity.reserveReplay(client,reserved)!==true) {
    throw Object.assign(new Error('ASYNC_REPLAY_CAPACITY_RETRY_LATER'),{code:'ASYNC_REPLAY_CAPACITY_RETRY_LATER'});
   }
   return reserved;
  });
  if(!replay)return denial('ASYNC_REPLAY_NOT_AVAILABLE');
  if(replay.state==='CONSUMED')return replay;
  const executionId=replay.reservedExecutionId;
  await tenantReplayPort.run({organizationId,tenantId:replay.tenantId,jobType:replay.jobType},async ports=>{
   if(capacity&&await ports.lockAndCheckReplayIntent({replayRequestId,executionId,
    rootExecutionId:replay.rootExecutionId,previousExecutionId:replay.originalExecutionId,contentDigest:replay.contentDigest}))return;
   const original=await ports.loadEnvelopeByExecution(ports.client,replay.originalExecutionId);
   if(!original)throw new Error('ASYNC_REPLAY_SOURCE_UNAVAILABLE');
   const observability=observabilityFactory(original);
   if(!isTrustedObservability(observability))throw new TypeError('Replay observability is invalid.');
   const envelope=replayEnvelope({original,authorized:true,newExecutionId:executionId,now:clock(),observability});
   const validated=validateEnvelope(envelope,registry);
   if(validated.contentDigest!==replay.contentDigest)throw new Error('ASYNC_REPLAY_CONTENT_CONFLICT');
   await ports.outboxRepository.enqueueLineage(ports.client,{organizationId,logicalId:`replay:${replayRequestId}`,envelope,
    lineage:{deliveryKind:'REPLAY',attempt:1,rootExecutionId:replay.rootExecutionId,previousExecutionId:replay.originalExecutionId,
     contentDigest:validated.contentDigest,envelopeDigest:validated.envelopeDigest,replayRequestId}});
   await ports.auditWriter.append(ports.client,{eventCode:'ASYNC_REPLAY_EXECUTION_CREATED',organizationId,tenantId:replay.tenantId,
    actorId:replay.requesterActorId,membershipId:replay.requesterMembershipId,idempotencyKey:`replay-created:${replayRequestId}`,
    correlationId:envelope.correlationId,causationId:envelope.causationId,resourceId:executionId,detailCode:'REPLAY_CREATED'});
  });
  return central(client=>repository.consume(client,{replayRequestId,organizationId,executionId}));
 }
 async function reconcile({replayRequestId,organizationId}){const replay=await central(c=>repository.load(c,{replayRequestId,organizationId}));if(!replay||replay.state!=='RESERVED')return replay;const exists=await tenantReplayPort.exists({organizationId,tenantId:replay.tenantId,jobType:replay.jobType,replayRequestId,executionId:replay.reservedExecutionId,rootExecutionId:replay.rootExecutionId,previousExecutionId:replay.originalExecutionId,contentDigest:replay.contentDigest});return exists?central(c=>repository.consume(c,{replayRequestId,organizationId,executionId:replay.reservedExecutionId})):execute({replayRequestId,organizationId});}
 return Object.freeze({request,approve,execute,reconcile});
}
module.exports={createReplayService};
