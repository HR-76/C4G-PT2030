'use strict';
const assert = require('node:assert/strict');
const { Pool } = require('../../../backend/node_modules/pg');
const centralManifest = require('../../../backend/src/security/centralMigrationManifest').manifest;
const tenantManifest = require('../../../backend/src/security/tenantMigrationManifest').manifest;
const { createEnvelopeV2, createTrustedObservability } = require('../../../backend/src/async/envelope');
const { OutboxRepository } = require('../../../backend/src/async/outboxRepository');
const { ReplayRequestRepository } = require('../../../backend/src/async/replayRequestRepository');
const { createReplayAuditWriter } = require('../../../backend/src/async/replayAuditWriter');
const { createReplayExecutionAuditWriter } = require('../../../backend/src/async/replayExecutionAuditWriter');
const { createReplayService } = require('../../../backend/src/async/replayService');
const { createTenantReplayPort } = require('../../../backend/src/async/tenantReplayPort');
const { assertTarget } = require('../../../backend/src/opportunities/migrationRunner');

const ORG='11111111-1111-4111-8111-111111111111', TENANT='22222222-2222-4222-8222-222222222222';
const ORIGINAL='01890f3e-7b12-7abc-8def-012345678921', REQUEST='01890f3e-7b12-7abc-8def-012345678922', REPLAY='01890f3e-7b12-7abc-8def-012345678923';
const REQUESTER='01890f3e-7b12-7abc-8def-012345678924', RM='01890f3e-7b12-7abc-8def-012345678925', APPROVER='01890f3e-7b12-7abc-8def-012345678926', AM='01890f3e-7b12-7abc-8def-012345678927';
const CORR='01890f3e-7b12-7abc-8def-012345678928', CAUSE='01890f3e-7b12-7abc-8def-012345678929';
const clock=()=>new Date('2030-01-01T00:00:00.000Z'), registry=Object.freeze({supports:type=>type==='opportunity.duplicate.scan'});
function pool(name){const url=process.env.F12_GATE_URL.replace('/postgres',`/${name}`);assertTarget(url);return new Pool({connectionString:url,max:4});}
async function tx(pool,work){const client=await pool.connect();try{await client.query('BEGIN');const value=await work(client);await client.query('COMMIT');return value;}catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}}
async function main(){const central=pool('f12_synthetic_central'),tenant=pool('f12_synthetic_tenant_a');try{
 const centralLedger=(await central.query('SELECT version FROM public.c4g_schema_migration ORDER BY version')).rows.map(row=>row.version);assert.deepEqual(centralLedger,centralManifest.map(entry=>entry.version));
 const tenantLedger=(await tenant.query('SELECT migration_id,resulting_fingerprint FROM c4g_system.schema_migration ORDER BY ordinal')).rows;assert.deepEqual(tenantLedger.map(row=>row.migration_id),tenantManifest.map(entry=>entry.version));assert.equal(tenantLedger.at(-1)?.resulting_fingerprint,tenantManifest.at(-1).schemaFingerprint);
 const observability=createTrustedObservability({traceparent:'00-11111111111111111111111111111111-2222222222222222-01',tracestate:null});
 const original=createEnvelopeV2({trustedContext:{organizationId:ORG,actor:{kind:'SERVICE',serviceActorCode:'F12_DUPLICATE_SCANNER'},operation:'opportunity.duplicate.scan',correlationId:CORR,causationId:CAUSE},job:{type:'opportunity.duplicate.scan',version:1,payloadVersion:1,idempotencyKey:'synthetic-replay-effect-0001',deadlineMs:300000},payload:{opportunityId:'01890f3e-7b12-7abc-8def-012345678930',revisionId:'01890f3e-7b12-7abc-8def-012345678931',ruleVersion:'opportunity-dedup-v1'},registry,observability,clock,id:()=>ORIGINAL});
 const outbox=new OutboxRepository({clock});await tx(tenant,c=>outbox.enqueueLineage(c,{organizationId:ORG,logicalId:'initial-replay-source',envelope:original.envelope,lineage:{deliveryKind:'INITIAL',attempt:1,rootExecutionId:ORIGINAL,previousExecutionId:null,contentDigest:original.contentDigest,envelopeDigest:original.envelopeDigest,replayRequestId:null}}));
 await central.query(`INSERT INTO async_exec.execution(execution_id,organization_id,job_type,state,deadline_at,lineage_version,delivery_kind,attempt,root_execution_id,previous_execution_id,content_digest,envelope_digest,replay_request_id) VALUES($1,$2,'opportunity.duplicate.scan','FAILED','2030-01-01T00:05:00Z',1,'INITIAL',1,$1,NULL,$3,$4,NULL)`,[ORIGINAL,ORG,original.contentDigest,original.envelopeDigest]);
 const repository=new ReplayRequestRepository({auditWriter:createReplayAuditWriter({clock}),clock});let failConsume=true;const repositoryWithProbe=Object.create(repository);repositoryWithProbe.consume=async(...args)=>{if(failConsume){failConsume=false;throw new Error('synthetic Central consume loss');}return repository.consume(...args);};
 const tenantReplayPort=createTenantReplayPort({transactionFor:(_target,work)=>tx(tenant,work),outboxRepository:outbox,auditWriterFor:()=>createReplayExecutionAuditWriter({tenantId:TENANT,clock})});
 let idIndex=0;const ids=[REQUEST,REPLAY];const authorizations=[];const service=createReplayService({authorization:{authorize:async input=>{authorizations.push(input.operationCode);return Object.freeze({allowed:true});}},repository:repositoryWithProbe,centralTransaction:work=>tx(central,work),tenantLocator:{resolve:async()=>Object.freeze({tenantId:TENANT})},tenantReplayPort,registry,clock,id:()=>ids[idIndex++],observabilityFactory:()=>createTrustedObservability({traceparent:'00-33333333333333333333333333333333-4444444444444444-01',tracestate:null})});
 const actor=(id,membershipId)=>({type:'HUMAN',id,organizationId:ORG,membershipId,membershipVersion:1,authorizationVersion:1});
 const requested=await service.request({originalExecutionId:ORIGINAL,actor:actor(REQUESTER,RM),assuranceEvidence:{authTime:1893456000},correlationId:CORR,idempotencyKey:'replay-command-service-0001'});assert.equal(requested.state,'REQUESTED');
 const approved=await service.approve({replayRequestId:REQUEST,actor:actor(APPROVER,AM),assuranceEvidence:{authTime:1893456000},correlationId:CORR});assert.equal(approved.state,'APPROVED');
 await assert.rejects(()=>service.execute({replayRequestId:REQUEST,organizationId:ORG}),/synthetic Central consume loss/);assert.equal((await tx(central,c=>repository.load(c,{replayRequestId:REQUEST,organizationId:ORG}))).state,'RESERVED');
 const lookup={organizationId:ORG,tenantId:TENANT,jobType:'opportunity.duplicate.scan',replayRequestId:REQUEST,executionId:REPLAY,rootExecutionId:ORIGINAL,previousExecutionId:ORIGINAL,contentDigest:original.contentDigest};
 assert.equal(await tenantReplayPort.exists(lookup),true);
 for(const change of [{executionId:REQUEST},{rootExecutionId:REQUEST},{previousExecutionId:REQUEST},{jobType:'opportunity.catalog.reconcile'},{contentDigest:'0'.repeat(64)}]) await assert.rejects(()=>tenantReplayPort.exists({...lookup,...change}),/ASYNC_REPLAY_SOURCE_CONFLICT/);
 const consumed=await service.reconcile({replayRequestId:REQUEST,organizationId:ORG});assert.equal(consumed.state,'CONSUMED');assert.equal((await tenant.query(`SELECT count(*)::int n FROM async_exec.outbox WHERE replay_request_id=$1`,[REQUEST])).rows[0].n,1);
 assert.equal((await tenant.query(`SELECT count(*)::int n FROM audit.event WHERE event_code='ASYNC_REPLAY_EXECUTION_CREATED' AND idempotency_key=$1`,[`replay-created:${REQUEST}`])).rows[0].n,1);assert.deepEqual(authorizations,['ASYNC_JOB_REPLAY','ASYNC_JOB_REPLAY_APPROVE']);
 const again=await service.reconcile({replayRequestId:REQUEST,organizationId:ORG});assert.equal(again.state,'CONSUMED');assert.equal((await tenant.query(`SELECT count(*)::int n FROM async_exec.outbox WHERE replay_request_id=$1`,[REQUEST])).rows[0].n,1);
 process.stdout.write(JSON.stringify({requested:true,approved:true,reserved:true,reconciled:true,tenantOutbox:1,tenantAudit:1,authorizations:2,idempotent:true})+'\n');
 }finally{await central.end();await tenant.end();}}
main().catch(error=>{process.stderr.write(`${error.code||error.name}: ${error.message}\n${error.stack||''}\n`);process.exitCode=1;});
