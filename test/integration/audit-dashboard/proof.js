'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const {randomUUID,createHash}=require('node:crypto');
const {databaseFixture,policyVersion,requirement}=require('../http-oidc/fixture');
const {createTenantRuntime}=require('../../../backend/src/security/tenantRuntime');
const {createAuthorizedTenantOperationCatalog}=require('../../../backend/src/security/tenantOperationCatalog');
const {preparedAuthorityBinding,deferPreparedReadAudit,flushPreparedReadAudit}=require('../../../backend/src/security/tenantLeaseExecutor');
const {createAuditEvent}=require('../../../backend/src/audit/event');
const {createUuidV7}=require('../../../backend/src/audit/uuidV7');
const {eventHash,GENESIS_HASH}=require('../../../backend/src/audit/integrity');
const {createAppendService}=require('../../../backend/src/audit/appendService');
const {PostgresAppendRepository}=require('../../../backend/src/audit/postgresAppendRepository');
const reportName=process.env.AUDIT_DASHBOARD_REPORT||'audit-dashboard-contention';
assert(/^[a-z0-9-]+$/.test(reportName));
const output=path.resolve(__dirname,'../../../context/reviews',reportName,'postgres-proof.json');
const report={startedAt:new Date().toISOString(),status:'RUNNING',checks:[],cases:[],cleanupErrors:[],limits:[
 'Exclusive disposable PostgreSQL with synthetic identities; no OIDC/HTTP or production capacity claim.',
 'Real F4 resolver, pool, metadata verification, functional LOGIN/role, PostgreSQL audit functions and durable Central guards.',
 'The proof query module supplies synthetic authorization evidence to the real guard; it does not replace the separate HTTP/F5 authorization gate.',
 'Negative membership/fence/clock probes alter only dependency observations in this process after a real PostgreSQL audit-row wait; no production source is patched.',
 'Second-append and lost-commit-ack faults are injected in the acquired client wrapper, while other SQL executes normally.'
]};
let stage='target',db;
const save=()=>{fs.mkdirSync(path.dirname(output),{recursive:true});fs.writeFileSync(output,JSON.stringify(report,null,2)+'\n');};
const check=name=>{report.checks.push(name);console.log('PASS '+name);save();};
const failureCode=error=>error?.internalCode||error?.code||error?.name||'UNKNOWN';
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));

function candidate(tenant,snapshot,control,index,eventCode='AUTHORIZATION_ALLOWED'){
 return createAuditEvent({trustedContext:{organizationId:tenant.organizationId,tenantId:snapshot.tenantId,
  operationAuthority:'TENANT',operationCode:'APPLICATION_READ',catalogVersion:'f13-editorial-events-v1',source:'API',channel:'APPLICATION',synchronous:true},
  input:{eventCode,actor:{type:'HUMAN',id:tenant.owner.id,membershipId:tenant.owner.membershipId,serviceActorCode:null,supportGrantId:null},
   subject:null,resource:{type:'APPLICATION',id:tenant.organizationId},decision:'ALLOW',outcome:'SUCCESS',observedAt:new Date().toISOString(),
   correlationId:control.correlationId,causationId:null,idempotencyKey:'AUDIT-PROOF:'+control.correlationId+':'+index,
   streamType:'ACCESS',payload:{detailCode:'AUTHORIZED',policyVersion}}});
}

async function rowsFor(tenant,correlationId){
 return (await tenant.pool.query('SELECT event_code,event_hash,event_data,sequence FROM audit.event WHERE correlation_id=$1 ORDER BY sequence',[correlationId])).rows;
}
async function verifyChain(tenant){
 const rows=(await tenant.pool.query("SELECT event_hash,event_data,sequence,previous_hash FROM audit.event WHERE organization_id=$1 AND stream_type='ACCESS' ORDER BY sequence",[tenant.organizationId])).rows;
 let previous=GENESIS_HASH,sequence=0;
 for(const row of rows){assert.equal(Number(row.sequence),++sequence);assert.equal(row.previous_hash,previous);assert.equal(eventHash(row.event_data),row.event_hash);previous=row.event_hash;}
 const head=(await tenant.pool.query("SELECT last_sequence,last_hash FROM audit.chain_head WHERE organization_id=$1 AND stream_type='ACCESS'",[tenant.organizationId])).rows[0];
 assert.equal(Number(head.last_sequence),sequence);assert.equal(head.last_hash,previous);
 return rows.length;
}

function harness(tenant,dependencies,central,snapshot,control){
 const append=createAppendService({appendPort:new PostgresAppendRepository()});
 const poolManager={...dependencies.poolManager,
  getFence:(...args)=>dependencies.poolManager.getFence(...args)+(control.invalidFence?1:0),
  async acquire(input){
   const allocation=await dependencies.poolManager.acquire(input),actual=allocation.client;
   const client={on:(...args)=>actual.on(...args),removeListener:(...args)=>actual.removeListener(...args),
    async query(sql,values){
     if(typeof sql==='string'&&sql.startsWith('SELECT * FROM audit.prepare_append_v1')){
      control.prepareCalls++;control.timeline.push('audit-prepare:'+control.phase);
     }
     if(typeof sql==='string'&&sql.startsWith('SELECT * FROM audit.append_event_v1')){
      control.appendCalls++;
      if(control.failSecondAppend&&control.appendCalls===2)throw Object.assign(Error('SYNTHETIC_APPEND_FAILURE'),{code:'SYNTHETIC_APPEND_FAILURE'});
     }
     if(sql==='COMMIT'&&control.phase!=='preparation'){
      const result=await actual.query(sql,values);control.commitConfirmed=true;control.timeline.push('commit');
      if(control.loseCommitAck)throw Object.assign(Error('SYNTHETIC_ACK_LOST'),{code:'SYNTHETIC_ACK_LOST'});
      return result;
     }
     if(sql==='ROLLBACK')control.timeline.push('rollback');
     return actual.query(sql,values);
    }};
   return {...allocation,client};
  }};
 const queryModule=Object.freeze({moduleCode:'APPLICATION_READ_AUDIT_PROOF',requiresAuditWrite:true,
  async execute({client}){
   control.phase='execute';
   await client.query('SET LOCAL ROLE c4g_opportunity_tenant_runtime');
   await client.query("SELECT set_config('app.organization_id',$1,true),set_config('app.membership_id',$2,true)",[tenant.organizationId,tenant.owner.membershipId]);
   const identity=(await client.query('SELECT session_user,current_user')).rows[0];
   assert.equal(identity.session_user,tenant.credentials.login);assert.equal(identity.current_user,'c4g_opportunity_tenant_runtime');
   const physical=preparedAuthorityBinding(client);
   control.guardDeadline=Math.min(physical.deadline,Date.now()+(control.shortGuard?2500:10000));
   const keys=['POLICY','ORG:'+tenant.organizationId,'SUBJECT:'+tenant.owner.id,'MEMBER:'+tenant.owner.membershipId,'SESSION:'+control.sessionDigest];
   control.guard=await central.coordinator.prepare({...physical,subjectId:tenant.owner.id,membershipId:tenant.owner.membershipId,
    sessionDigest:control.sessionDigest,deadline:control.guardDeadline,sourceBinding:{...physical.sourceBinding,sourceOperation:'APPLICATION_REPORT'}},async()=>({
     versions:{assuranceLevel:'SESSION',policyVersion,membershipVersion:1,authorizationVersion:1,sessionRevocationVersion:1,
      permissionCatalogVersion:central.catalogs.permissionCatalog.version,operationCatalogVersion:central.catalogs.operationCatalog.version,
      scopeEpochs:await central.coordinator.snapshotEpochs(keys)},assurance:{level:'SESSION',policyVersion},
     operations:[{operation:'APPLICATION_READ',permission:'application.read',resourceType:'APPLICATION',resourceId:tenant.organizationId}]
    }),client);
   for(let index=0;index<2;index++)assert.equal(deferPreparedReadAudit(client,'APPLICATION_REPORT',candidate(tenant,snapshot,control,index)),true);
   assert.equal(control.prepareCalls,0,'Enqueue must not acquire the audit-row lock.');
   assert.equal((await rowsFor(tenant,control.correlationId)).length,0,'Buffered events are not durable evidence.');
   control.preFlushInvisible=true;
   if(control.critical){
    const event=candidate(tenant,snapshot,control,2,'EXPORT_ALLOWED');
    assert.equal(deferPreparedReadAudit(client,'APPLICATION_REPORT',event),false);
    await flushPreparedReadAudit(client);await append.append(event,client);
    assert.equal(control.appendCalls,3);control.criticalBeforeReturn=true;
   }
   control.phase='executed';control.timeline.push('module-return');return {ok:true};
  },
  async beforeCommit({client}){control.timeline.push('reset-role');await client.query('RESET ROLE');},
  authorityGuard:Object.freeze({
   assert({client}){control.timeline.push('guard-assert');
    try{central.coordinator.assert(control.guard,client,preparedAuthorityBinding(client).transactionId);}
    catch(error){control.guardRefusal=failureCode(error);throw error;}},
   async complete({outcome}){control.completion=outcome;await central.coordinator.complete(control.guard,outcome);}
  })});
 const entry=Object.freeze({operationCode:'APPLICATION_READ',ownerModule:'APPLICATION_FIRST_SLICE',accessMode:'READ',workload:'API',workloadClass:'FUNCTIONAL',queryModule,
  compatibleSchemaVersions:Object.freeze([snapshot.schema.currentVersion]),requiredCapabilities:Object.freeze(['APPLICATION_FIRST_SLICE','F7_AUDIT_LEDGER','F4_RUNTIME_METADATA_ACCESS']),
  allowedCompatibilityStates:Object.freeze(['COMPATIBLE']),readOnlyEligible:false,inputSchema:Object.freeze({validate:v=>v&&Object.keys(v).length===0}),
  resultSchema:Object.freeze({validate:v=>v?.ok===true}),requiredPermission:'APPLICATION_READ',limits:Object.freeze({maxPageSize:25,maxRows:25,maxBytes:1048576}),timeoutMs:10000});
 const runtime=createTenantRuntime({...dependencies,poolManager,clock:{now:()=>new Date(Date.now()+(control.clockOffset||0))},
  membershipRepository:{async revalidateContext(...args){const valid=await dependencies.membershipRepository.revalidateContext(...args);control.timeline.push('membership');return control.revoked?null:valid;}},
  bindingVerifier:{async verify(input){const observed=await dependencies.bindingVerifier.verify(input);control.timeline.push('physical:'+String(input.phase||'TRANSACTION'));return observed;}},
  operationCatalog:createAuthorizedTenantOperationCatalog(Object.freeze({catalogVersion:'audit-proof-v1',operations:Object.freeze([entry])}),central.catalogs.operationCatalog)});
 const adapter=Object.freeze({operationCode:'APPLICATION_READ',queryModule});
 return async()=>{
  const lease=await runtime.resolve({correlationId:control.correlationId,operationAdapter:adapter,
   organizationContext:{organizationId:tenant.organizationId,membershipId:tenant.owner.membershipId,membershipVersion:1}});
  return lease.execute(Object.freeze({}));
 };
}

async function waitAuditLock(tenant){
 const deadline=Date.now()+8000;
 do{
  const {rows}=await tenant.pool.query("SELECT count(*)::int n FROM pg_stat_activity WHERE datname=current_database() AND usename=$1 AND wait_event_type='Lock' AND query LIKE 'SELECT * FROM audit.prepare_append_v1%' AND cardinality(pg_blocking_pids(pid))>0",[tenant.credentials.login]);
  if(rows[0].n===1)return true;
  await pause(20);
 }while(Date.now()<deadline);
 throw Error('REAL_AUDIT_ROW_WAIT_NOT_REACHED');
}

async function runCase(tenant,dependencies,central,snapshot,name,options={}){
 stage=name;const control={...options,correlationId:createUuidV7(),sessionDigest:createHash('sha256').update(randomUUID()).digest('hex'),
  phase:'preparation',prepareCalls:0,appendCalls:0,timeline:[],commitConfirmed:false};
 const execute=harness(tenant,dependencies,central,snapshot,control);
 let blocker,pending,settled=false,outcome,locked=false;
 try{
  if(options.block){blocker=await tenant.pool.connect();await blocker.query('BEGIN');
   await blocker.query("SELECT * FROM audit.chain_head WHERE organization_id=$1 AND stream_type='ACCESS' FOR UPDATE",[tenant.organizationId]);locked=true;}
  pending=execute().then(value=>{settled=true;return {value};},error=>{settled=true;return {error};});
  if(options.block){
   await waitAuditLock(tenant);control.realAuditRowWait=true;assert.equal(settled,false);
   assert.equal((await rowsFor(tenant,control.correlationId)).length,0);
   assert.equal((await central.pool.query("SELECT count(*)::int n FROM public.authority_commit_guard WHERE correlation_id=$1 AND state='PREPARED'",[control.correlationId])).rows[0].n,1);
   if(options.revokeDuringWait)control.revoked=true;
   if(options.fenceDuringWait)control.invalidFence=true;
   if(options.expireLeaseDuringWait)control.clockOffset=60000;
   if(options.shortGuard)await pause(Math.max(0,control.guardDeadline-Date.now()+25));
   await blocker.query('COMMIT');locked=false;
  }
  outcome=await pending;
  const rows=await rowsFor(tenant,control.correlationId);
  if(options.expectedFailure){
   assert(outcome.error,'Fault must not report a successful operation.');
   if(options.loseCommitAck){assert.equal(failureCode(outcome.error),'COMMIT_UNCERTAIN');assert.equal(rows.length,2);assert.equal(control.completion,'UNKNOWN');}
   else {assert.equal(rows.length,0,'A rejected operation must roll back all staged/partially appended events.');assert.equal(control.commitConfirmed,false);}
   if(options.failSecondAppend){assert.equal(control.appendCalls,2);assert.equal(failureCode(outcome.error),'TENANT_QUERY_FAILED');}
   if(options.revokeDuringWait){assert.equal(control.appendCalls,2);assert.equal(failureCode(outcome.error),'ORGANIZATION_MISMATCH');}
   if(options.fenceDuringWait)assert.equal(failureCode(outcome.error),'TRANSITION_CONFLICT');
   if(options.expireLeaseDuringWait)assert.equal(failureCode(outcome.error),'LEASE_TIMEOUT');
   if(options.shortGuard){assert.equal(control.appendCalls,2);assert.equal(control.guardRefusal,'AUTHORITY_GUARD_STALE');}
  }else{
   assert.ifError(outcome.error);assert.deepEqual(outcome.value,{ok:true});assert.equal(rows.length,options.critical?3:2);
   assert.equal(control.completion,'COMMITTED');assert.equal(control.commitConfirmed,true);
   const firstAudit=control.timeline.findIndex(x=>x.startsWith('audit-prepare:'));
   if(options.critical){assert.equal(control.criticalBeforeReturn,true);assert(firstAudit<control.timeline.indexOf('module-return'));
    assert.deepEqual(rows.map(row=>row.event_code),['AUTHORIZATION_ALLOWED','AUTHORIZATION_ALLOWED','EXPORT_ALLOWED']);}
   else assert(firstAudit>control.timeline.indexOf('module-return'));
   assert(control.timeline.indexOf('reset-role')>firstAudit);
   assert(control.timeline.lastIndexOf('physical:TRANSACTION')>firstAudit);
   assert(control.timeline.lastIndexOf('membership')>firstAudit);
   assert(control.timeline.indexOf('guard-assert')>firstAudit);
  }
  const count=await verifyChain(tenant);
  const guard=(await central.pool.query('SELECT state,reconciliation_result FROM public.authority_commit_guard WHERE correlation_id=$1',[control.correlationId])).rows[0];
  if(options.loseCommitAck)assert.equal(guard.state,'TENANT_COMMIT_UNKNOWN');
  report.cases.push({name,preFlushInvisible:control.preFlushInvisible===true,realAuditRowWait:control.realAuditRowWait===true,
   prepareCalls:control.prepareCalls,appendCalls:control.appendCalls,persistedEvents:rows.length,verifiedChainEvents:count,
   success:!outcome.error,errorCode:outcome.error?failureCode(outcome.error):null,guardRefusal:control.guardRefusal||null,guardState:guard.state,guardOutcome:guard.reconciliation_result,
   evidence:options.loseCommitAck?'Database commit was observed by fault injector; application reported COMMIT_UNCERTAIN and UNKNOWN, not durable success.':null});
  check(name);
 }finally{
  if(locked)await blocker.query('ROLLBACK').catch(()=>{});blocker?.release();
  if(pending)await pending;
 }
}

async function run(){
 const target=new URL(process.env.HTTP_PROOF_ADMIN_URL||'');
 assert.equal(target.hostname,'127.0.0.1');assert.equal(target.pathname,'/postgres');assert.equal(target.username,'proof_admin');
 assert(!['5432','5433'].includes(target.port));assert(/^[a-f0-9]{32}$/.test(process.env.HTTP_PROOF_RUN||''));
 stage='disposable fixture';db=await databaseFixture(report);
 const syntheticIdentity={issuer:'https://synthetic.invalid/isolated-proof',async user(username){return {username,subject:randomUUID()};}};
 const tenant=await db.tenant(syntheticIdentity,0),{runtime}=await db.configure([tenant]);
 const snapshot=await runtime.directoryRepository.resolveSnapshotByOrganization(tenant.organizationId,'API');
 assert(snapshot);assert.notEqual(tenant.credentials.login,'proof_admin');
 check('real tenant is provisioned and bound to the limited API LOGIN');
 await runCase(tenant,runtime,db.central,snapshot,'staged observations persist before successful return and preserve the chain');
 await runCase(tenant,runtime,db.central,snapshot,'a real audit-row lock delays return until append commit and final checks',{block:true});
 await runCase(tenant,runtime,db.central,snapshot,'critical export bypasses staging after its queued prefix',{critical:true});
 await runCase(tenant,runtime,db.central,snapshot,'second append failure rolls back the complete batch',{failSecondAppend:true,expectedFailure:true});
 await runCase(tenant,runtime,db.central,snapshot,'membership loss observed after a real audit wait prevents commit',{block:true,revokeDuringWait:true,expectedFailure:true});
 await runCase(tenant,runtime,db.central,snapshot,'fence divergence during a real audit wait prevents commit',{block:true,fenceDuringWait:true,expectedFailure:true});
 await runCase(tenant,runtime,db.central,snapshot,'lease expiry during a real audit wait prevents commit',{block:true,expireLeaseDuringWait:true,expectedFailure:true});
 await runCase(tenant,runtime,db.central,snapshot,'authority deadline expiry during a real audit wait rolls back the batch',{block:true,shortGuard:true,expectedFailure:true});
 await runCase(tenant,runtime,db.central,snapshot,'lost COMMIT acknowledgement remains uncertain despite persisted audit rows',{loseCommitAck:true,expectedFailure:true});
 report.status='PASS';
}
run().catch(error=>{report.status='FAIL';report.failure={stage,code:failureCode(error),assertion:error.code==='ERR_ASSERTION'?String(error.message).split('\n')[0].slice(0,180):null};process.exitCode=1;})
 .finally(async()=>{try{await db?.close();}catch(error){report.status='FAIL';report.cleanupErrors.push({code:failureCode(error)});process.exitCode=1;}
  report.finishedAt=new Date().toISOString();save();console.log('AUDIT_DASHBOARD_PROOF '+report.status+' checks='+report.checks.length);});
