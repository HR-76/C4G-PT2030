'use strict';
// Experimental no-wait ordering with real F4 executor and durable Central guards.
// Markers, query modules and authorization evidence are test-only; not matching runtime.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {randomUUID,createHash}=require('node:crypto');
const {databaseFixture,policyVersion}=require('../http-oidc/fixture');
const {createTenantRuntime}=require('../../../backend/src/security/tenantRuntime');
const {createAuthorizedTenantOperationCatalog}=require('../../../backend/src/security/tenantOperationCatalog');
const {preparedAuthorityBinding}=require('../../../backend/src/security/tenantLeaseExecutor');
const reportName=process.env.MATCHING_INTEGRATED_REPORT;
assert(/^[a-z0-9-]+$/.test(reportName));
const target=new URL(process.env.HTTP_PROOF_ADMIN_URL||'');assert.equal(target.hostname,'127.0.0.1');assert.equal(target.pathname,'/postgres');assert(!['5432','5433'].includes(target.port));assert.match(process.env.HTTP_PROOF_RUN||'',/^[a-f0-9]{32}$/);
const report={status:'RUNNING',checks:[],limits:['Real F4 tenant executor and durable Central guards; authorization evidence and marker protocol are synthetic, not product matching or F5.','No claim about trigger coverage, lock order of all writers, OIDC, cursor security, or production pagination.']};
const output=path.resolve(__dirname,'../../../context/reviews',reportName,'integrated.json');
const save=()=>{fs.mkdirSync(path.dirname(output),{recursive:true});fs.writeFileSync(output,JSON.stringify(report,null,2)+'\n')};
const barrier=()=>{let arrive,release;return {arrived:new Promise(r=>arrive=r),resume:new Promise(r=>release=r),arrive,release}};
const wait=async(check)=>{const end=Date.now()+7000;while(Date.now()<end){if(await check())return;await new Promise(r=>setTimeout(r,20))}throw Error('BARRIER_TIMEOUT')};
let db;
async function main(){
 db=await databaseFixture(report);const identity={issuer:'https://synthetic.invalid/lock-proof',async user(username){return {username,subject:randomUUID()}}};
 const tenant=await db.tenant(identity,0),other=await db.tenant(identity,1),{runtime:deps}=await db.configure([tenant,other]);
 const snapshot=await deps.directoryRepository.resolveSnapshotByOrganization(tenant.organizationId,'API');
 const catalog=new(require('../../../backend/src/opportunities/centralRepository').CentralOpportunityRepository)({pool:db.central.pool,identityFactory:require('../../../backend/src/opportunities/identity').createIdentityFactory()});
 const centralItem=await catalog.create({schemaVersion:1,requestId:randomUUID(),snapshot:{schemaVersion:1,title:'Central before',funderName:'Synthetic',provenanceId:randomUUID(),lifecycleState:'ACTIVE',validationState:'PENDING_REVIEW',normalizationVersion:'opportunity-normalization-v1',qualityRuleVersion:'opportunity-quality-v1'},provenance:{schemaVersion:1,sourceType:'C4G_MANUAL',sourceNamespace:'MATCHING_PROOF',observedAt:new Date().toISOString()}},{actor:{type:'HUMAN',reference:tenant.owner.id}});
 const sid='matching-proof-'+randomUUID(),expiresAt=Date.now()+60000,organizationContext={organizationId:tenant.organizationId,membershipId:tenant.owner.membershipId,membershipVersion:1};
 await db.central.registry.rotateSession({sid,globalUserId:tenant.owner.id,revocationVersion:1,expiresAt,organizationContext});
 const digest=createHash('sha256').update(sid).digest('hex');
 const keys=['POLICY','ORG:'+tenant.organizationId,'SUBJECT:'+tenant.owner.id,'MEMBER:'+tenant.owner.membershipId,'SESSION:'+digest];
 const gate=barrier(),resume=barrier(),state={};
 function operation(kind,windowControl=null){
  const control={id:randomUUID(),guard:null,central:null};
  const queryModule=Object.freeze({moduleCode:'PERF03_PROOF_'+kind,requiresAuditWrite:true,
   async execute({client}){
    await client.query('SET LOCAL ROLE c4g_opportunity_tenant_runtime');await client.query("SELECT set_config('app.organization_id',$1,true)",[tenant.organizationId]);
    if(kind==='writer'){
     await client.query("SELECT pg_advisory_xact_lock(hashtextextended('F13-P1:' || $1::text,43001301))",[tenant.organizationId]);
     gate.arrive();await gate.resume;
    }
    const physical=preparedAuthorityBinding(client);
    control.guard=await db.central.coordinator.prepare({...physical,subjectId:tenant.owner.id,membershipId:tenant.owner.membershipId,sessionDigest:digest,deadline:Math.min(physical.deadline,Date.now()+9000),sourceBinding:{...physical.sourceBinding,sourceOperation:'PERF03_PROOF'}},async()=>({
     versions:{assuranceLevel:'SESSION',policyVersion,membershipVersion:1,authorizationVersion:1,sessionRevocationVersion:1,permissionCatalogVersion:db.central.catalogs.permissionCatalog.version,operationCatalogVersion:db.central.catalogs.operationCatalog.version,scopeEpochs:await db.central.coordinator.snapshotEpochs(keys)},assurance:{level:'SESSION',policyVersion},operations:[{operation:'ORGANIZATION_DIRECTORY_EDIT',permission:'organization_directory.edit',resourceType:'ORGANIZATION',resourceId:tenant.organizationId}]
    }),client);
    if(kind==='capture'||kind==='window'||kind==='protected'){
     const ok=(await client.query('SELECT pg_try_advisory_xact_lock_shared(43009901,1) AS ok')).rows[0].ok;if(!ok)throw Error('TENANT_MARKER_BUSY');
     const central=await db.central.pool.connect();
     try{await central.query('BEGIN');const c=(await central.query('SELECT pg_try_advisory_xact_lock_shared(43009902,1) AS ok')).rows[0].ok;if(!c){state.centralBusy=true;throw Error('CENTRAL_MARKER_BUSY')}state.markers=true;
      if(windowControl)windowControl.observed=(await central.query('SELECT title FROM opportunity_catalog.opportunity WHERE opportunity_id=$1',[centralItem.opportunityId])).rows[0].title;
      if(kind==='capture'){resume.arrive();await resume.resume;}
      if(kind==='protected'){control.central=central;if(windowControl)windowControl.central=central}else await central.query('COMMIT');
     }finally{if(control.central!==central){await central.query('ROLLBACK').catch(()=>{});central.release()}}
    }else{
     await client.query('SELECT pg_advisory_xact_lock(43009901,1)');
     const updated=await client.query('UPDATE organizational_scope.person SET name=$3,revision=revision+1,updated_at=transaction_timestamp(),updated_by=$4 WHERE organization_id=$1 AND person_id=$2 RETURNING person_id',[tenant.organizationId,tenant.owner.membershipId,'Synthetic updated',tenant.owner.id]);assert.equal(updated.rowCount,1);
    }
    return {ok:true};
   },async beforeCommit({client}){await client.query('RESET ROLE');if(windowControl){windowControl.gate.arrive();await windowControl.gate.resume;if(windowControl.abort)throw Error('SYNTHETIC_ABORT')}},authorityGuard:Object.freeze({assert({client}){db.central.coordinator.assert(control.guard,client,preparedAuthorityBinding(client).transactionId)},async complete({outcome}){try{await db.central.coordinator.complete(control.guard,outcome)}finally{if(control.central){if(!windowControl?.disconnected){await control.central.query('ROLLBACK').catch(()=>{});control.central.release()}control.central=null}}}})});
  const entry=Object.freeze({operationCode:'ORGANIZATION_DIRECTORY_EDIT',ownerModule:'ORGANIZATION_DIRECTORY',accessMode:'WRITE',workload:'API',workloadClass:'FUNCTIONAL',queryModule,compatibleSchemaVersions:Object.freeze([snapshot.schema.currentVersion]),requiredCapabilities:Object.freeze(['ORGANIZATION_DIRECTORY','F13_P1_ORGANIZATIONAL_SCOPE','F7_AUDIT_LEDGER','F4_RUNTIME_METADATA_ACCESS']),allowedCompatibilityStates:Object.freeze(['COMPATIBLE']),readOnlyEligible:false,inputSchema:Object.freeze({validate:v=>v&&Object.keys(v).length===0}),resultSchema:Object.freeze({validate:v=>v?.ok===true}),requiredPermission:'ORGANIZATION_DIRECTORY_EDIT',limits:Object.freeze({maxPageSize:25,maxRows:25,maxBytes:1048576}),timeoutMs:10000});
  const runtime=createTenantRuntime({...deps,operationCatalog:createAuthorizedTenantOperationCatalog(Object.freeze({catalogVersion:'perf03-proof-v1',operations:Object.freeze([entry])}),db.central.catalogs.operationCatalog)});
  const adapter=Object.freeze({operationCode:'ORGANIZATION_DIRECTORY_EDIT',queryModule});
  return async()=>{const lease=await runtime.resolve({correlationId:control.id,operationAdapter:adapter,organizationContext});return lease.execute(Object.freeze({}))};
 }
 async function centralMutation(title){const client=await db.central.pool.connect();try{await client.query('BEGIN');const lock=(await client.query('SELECT pg_try_advisory_xact_lock(43009902,1) AS ok')).rows[0].ok;if(!lock){await client.query('ROLLBACK');return false}await client.query('UPDATE opportunity_catalog.opportunity SET title=$2 WHERE opportunity_id=$1',[centralItem.opportunityId,title]);await client.query('COMMIT');return true}finally{await client.query('ROLLBACK').catch(()=>{});client.release()}}
 const unsafe={gate:barrier()},unsafeRun=operation('window',unsafe)();unsafeRun.catch(()=>{});
 try{await unsafe.gate.arrived;assert.equal(unsafe.observed,'Central before');assert.equal(await centralMutation('Central changed'),true);unsafe.gate.release();await unsafeRun;assert.equal(unsafe.observed,'Central before');assert.equal((await db.central.pool.query('SELECT title FROM opportunity_catalog.opportunity WHERE opportunity_id=$1',[centralItem.opportunityId])).rows[0].title,'Central changed');report.checks.push('releasing Central before tenant commit permits a changed Central row while stale capture commits');}finally{unsafe.gate.release();await Promise.allSettled([unsafeRun])}
 const protectedWindow={gate:barrier()},protectedRun=operation('protected',protectedWindow)();protectedRun.catch(()=>{});
 try{await protectedWindow.gate.arrived;assert.equal(protectedWindow.observed,'Central changed');assert.equal(await centralMutation('Central later'),false);protectedWindow.gate.release();await protectedRun;assert.equal(await centralMutation('Central later'),true);report.checks.push('keeping Central marker through tenant commit refuses concurrent mutation and permits it after completion');}finally{protectedWindow.gate.release();await Promise.allSettled([protectedRun])}
 const aborted={gate:barrier(),abort:true},abortRun=operation('protected',aborted)();abortRun.catch(()=>{});
 try{await aborted.gate.arrived;assert.equal(await centralMutation('Central after abort'),false);aborted.gate.release();await assert.rejects(abortRun);assert.equal(await centralMutation('Central after abort'),true);report.checks.push('tenant rollback releases retained Central marker');}finally{aborted.gate.release();await Promise.allSettled([abortRun])}
 const lost={gate:barrier()},lostRun=operation('protected',lost)();lostRun.catch(()=>{});
 try{await Promise.race([lost.gate.arrived,lostRun.then(()=>{throw Error('LOST_GATE_NOT_REACHED')})]);assert.equal(await centralMutation('Central before disconnect'),false);lost.disconnected=true;lost.central.release(new Error('SYNTHETIC_CONNECTION_LOSS'));await wait(()=>centralMutation('Central after disconnect'));lost.gate.release();await lostRun;assert.equal(lost.observed,'Central after abort');report.checks.push('negative control: losing Central connection before tenant commit allows stale capture to succeed');}finally{lost.gate.release();await Promise.allSettled([lostRun])}
 state.markers=undefined;const capture=operation('capture'),blocked=await db.central.pool.connect();
 try{
  await blocked.query('BEGIN');await blocked.query('SELECT pg_advisory_xact_lock(43009902,1)');
  await assert.rejects(capture());assert.equal(state.centralBusy,true);assert.equal(state.markers,undefined);
  report.checks.push('busy Central marker makes guarded capture fail without publishing a result');
 }finally{await blocked.query('ROLLBACK').catch(()=>{});blocked.release()}
 const writer=operation('writer')();writer.catch(()=>{});
 try{
  await gate.arrived;const reading=capture();reading.catch(()=>{});await resume.arrived;assert(state.markers);
  gate.release();
  await wait(async()=>Number((await tenant.pool.query("SELECT count(*)::int n FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE 'SELECT pg_advisory_xact_lock(43009901,1)%'")).rows[0].n)>0);
  let revoked=false;const revoke=db.central.registry.revokeSession(sid).then(()=>{revoked=true});revoke.catch(()=>{});
  await wait(async()=>Number((await db.central.pool.query("SELECT count(*)::int n FROM public.authority_write_request WHERE state='WAITING' AND scope_keys && $1::text[]",[['SESSION:'+digest]])).rows[0].n)>0);
  assert.equal(revoked,false);resume.release();await reading;await writer;await revoke;
  assert.equal(await db.central.registry.validateSession({sid,globalUserId:tenant.owner.id,revocationVersion:1,now:Date.now()}),false);
  assert.equal((await tenant.pool.query('SELECT name FROM organizational_scope.person WHERE organization_id=$1 AND person_id=$2',[tenant.organizationId,tenant.owner.membershipId])).rows[0].name,'Synthetic updated');
  assert.notEqual((await other.pool.query('SELECT name FROM organizational_scope.person WHERE organization_id=$1 AND person_id=$2',[other.organizationId,other.owner.membershipId])).rows[0].name,'Synthetic updated');
  report.checks.push('real tenant tree lock and guarded write complete after experimental no-wait capture releases marker');
  report.checks.push('real session revocation waits for guards and invalidates the session after protected commits');
  report.checks.push('second tenant remains unchanged');
 }finally{gate.release();resume.release();await Promise.allSettled([writer])}
 report.status='PASS';
}
main().catch(e=>{report.status='FAIL';report.error={name:e.name,code:e.internalCode||e.code||null};process.exitCode=1}).finally(async()=>{try{await db?.close()}catch(e){report.status='FAIL';report.cleanupError=e.code||e.name;process.exitCode=1}save();console.log('MATCHING_INTEGRATED_'+report.status)});
