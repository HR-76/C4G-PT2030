'use strict';
// Experimental external guard wrapper around the real directory service.
// It is not enforced by product writers or suitable for deployment.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {randomUUID}=require('node:crypto'),{Pool}=require('../../../backend/node_modules/pg');
const {databaseFixture,policyVersion,requirement}=require('../http-oidc/fixture');
const {createDirectoryComposition}=require('../../../backend/src/organizationDirectory/composition');
const name=process.env.MATCHING_INTEGRATED_REPORT,url=new URL(process.env.HTTP_PROOF_ADMIN_URL||'');
assert.match(name,/^[a-z0-9-]+$/);assert.equal(url.hostname,'127.0.0.1');assert.equal(url.pathname,'/postgres');assert(!['5432','5433'].includes(url.port));assert.match(process.env.HTTP_PROOF_RUN||'',/^[a-f0-9]{32}$/);
const report={status:'RUNNING',checks:[],limits:['Real directory writer, F4, F5 and Central session/authority with synthetic identities; no HTTP/OIDC browser.','Experimental external guard has no enforcement in production writers: the negative bypass is intentional and demonstrates the candidate is not safe to integrate.','No simulated real network partition, exhaustive writer coverage, snapshot publication or matching pagination.']};
const output=path.resolve(__dirname,'../../../context/reviews',name,'real-writers.json');
const save=()=>{fs.mkdirSync(path.dirname(output),{recursive:true});fs.writeFileSync(output,JSON.stringify(report,null,2)+'\n')};
let db,admin,guard,stage='fixture';
async function main(){
 db=await databaseFixture(report);const identity={issuer:'https://synthetic.invalid/real-writer',async user(username){return {username,subject:randomUUID()}}};
 const tenant=await db.tenant(identity,0),other=await db.tenant(identity,1),{runtime}=await db.configure([tenant,other]);
 stage='session';const sid='proof-'+randomUUID(),ctx={organizationId:tenant.organizationId,membershipId:tenant.owner.membershipId,membershipVersion:1},expiresAt=Date.now()+300000;
 const sess={auth:{user:{id:tenant.owner.id},absoluteExpiresAt:expiresAt,revocationVersion:1,policyVersion,organizationContext:ctx,evidence:{authTime:Math.floor(Date.now()/1000),acr:'c4g-loa1',amr:['pwd'],policyVersion}}};
 await db.central.registry.rotateSession({sid,globalUserId:tenant.owner.id,revocationVersion:1,expiresAt,organizationContext:ctx});
 await db.central.coordinator.write([db.central.coordinator.sessionKey(sid)],()=>db.central.coordinator.pool.query('INSERT INTO "public"."application_session_store" (sess, expire, sid) SELECT $1, to_timestamp($2), $3 ON CONFLICT (sid) DO UPDATE SET sess=$1, expire=to_timestamp($2) RETURNING sid',[sess,expiresAt/1000,sid]));
 const request={sessionID:sid,user:{id:tenant.owner.id},authContext:{sessionId:sid},organizationContext:ctx,headers:{'x-c4g-organization':tenant.organizationId}};
 let injectAck=false,ackObserved=false;
 const proofRuntime={...runtime,poolManager:{...runtime.poolManager,async acquire(args){const allocation=await runtime.poolManager.acquire(args),actual=allocation.client;let functional=false,personWritten=false;const client={on:(...x)=>actual.on(...x),removeListener:(...x)=>actual.removeListener(...x),async query(sql,values){if(sql==='BEGIN TRANSACTION READ WRITE')functional=true;if(sql==='BEGIN TRANSACTION READ ONLY')functional=false;const result=await actual.query(sql,values);if(functional&&typeof sql==='string'&&sql.startsWith('UPDATE organizational_scope.person SET'))personWritten=true;if(sql==='COMMIT'&&functional&&personWritten&&injectAck){injectAck=false;ackObserved=true;throw Object.assign(Error('SYNTHETIC_ACK_LOST'),{code:'SYNTHETIC_ACK_LOST'})}return result}};return {...allocation,client}}}};
 const directory=createDirectoryComposition({sessionStore:db.central.store,sessionRegistry:db.central.registry,authorityCoordinator:db.central.coordinator,centralPool:db.reader,authorizationCatalogs:db.central.catalogs,assurancePolicyVersion:policyVersion,recentMfaRequirement:requirement,tenantRuntimeDependencies:proofRuntime,tokenKeys:{proof:'synthetic-proof-key-'.repeat(3)},tokenKeyId:'proof'});
 stage='guard database';admin=new Pool({connectionString:url.toString(),max:2});await admin.query('CREATE DATABASE matching_guard_experiment');const guardUrl=new URL(url);guardUrl.pathname='/matching_guard_experiment';guard=new Pool({connectionString:guardUrl.toString(),max:4});
 await guard.query("CREATE TABLE fence(id int PRIMARY KEY);INSERT INTO fence VALUES(1);CREATE TABLE guard(id uuid PRIMARY KEY,nonce uuid NOT NULL,state text NOT NULL CHECK(state IN ('PREPARED','UNKNOWN','DONE')),outcome text)");
 async function activate(id,nonce){const c=await guard.connect();let destroyed=false;try{await c.query('BEGIN');await c.query('SELECT * FROM fence WHERE id=1 FOR UPDATE');assert.equal((await c.query("SELECT count(*)::int n FROM guard WHERE state<>'DONE'")).rows[0].n,0);await c.query("INSERT INTO guard VALUES($1,$2,'PREPARED',NULL)",[id,nonce]);await c.query('COMMIT');destroyed=true;c.release(new Error('SYNTHETIC_CONNECTION_LOSS'))}finally{if(!destroyed){await c.query('ROLLBACK').catch(()=>{});c.release()}}}
 async function wrapped(input){const c=await guard.connect();try{await c.query('BEGIN');await c.query('SELECT * FROM fence WHERE id=1 FOR UPDATE');if((await c.query("SELECT 1 FROM guard WHERE state<>'DONE'")).rowCount){await c.query('ROLLBACK');return {blocked:true}}const result=await directory.execute('personEdit',input,tenant.owner.membershipId,request);await c.query('COMMIT');return result}finally{await c.query('ROLLBACK').catch(()=>{});c.release()}}
 const person=async()=> (await tenant.pool.query('SELECT name,email,function_label,active,revision FROM organizational_scope.person WHERE organization_id=$1 AND person_id=$2',[tenant.organizationId,tenant.owner.membershipId])).rows[0];
 const input=(row,label)=>({name:label,email:row.email,functionLabel:row.function_label||'',active:true,unitIds:[],primaryUnitId:null,expectedRevision:Number(row.revision),idempotencyKey:randomUUID()});
 stage='real writer';let row=await person();const first=input(row,'Protected writer');const firstResult=await wrapped(first);assert.equal(firstResult.name,'Protected writer');
 assert.equal((await tenant.pool.query('SELECT count(*)::int n FROM organizational_scope.directory_receipt WHERE organization_id=$1 AND idempotency_key=$2',[tenant.organizationId,first.idempotencyKey])).rows[0].n,1);
 report.checks.push('real directory personEdit succeeds through F4/F5 and writes an idempotency receipt');
 const id=randomUUID(),nonce=randomUUID();await activate(id,nonce);row=await person();const candidate=input(row,'Blocked writer');
 assert.deepEqual(await Promise.all([wrapped(candidate),wrapped(candidate)]),[{blocked:true},{blocked:true}]);assert.equal((await person()).name,'Protected writer');
 report.checks.push('two participating real writers are refused after the guard connection is destroyed');
 const bypass=input(row,'Bypass writer');await directory.execute('personEdit',bypass,tenant.owner.membershipId,request);assert.equal((await person()).name,'Bypass writer');
 report.checks.push('negative control: direct real writer bypasses external guard and commits while it is active');
 await guard.query("UPDATE guard SET state='UNKNOWN' WHERE id=$1",[id]);
 const held=await tenant.pool.connect();try{await held.query('BEGIN');await held.query('SELECT pg_advisory_xact_lock(hashtextextended($1,43001305))',[nonce]);const observer=await tenant.pool.connect();try{await observer.query('BEGIN');assert.equal((await observer.query('SELECT pg_try_advisory_xact_lock(hashtextextended($1,43001305)) AS ok',[nonce])).rows[0].ok,false);await observer.query('ROLLBACK')}finally{observer.release()}assert.deepEqual(await wrapped(candidate),{blocked:true});await held.query('ROLLBACK')}finally{held.release()}
 const verifier=await tenant.pool.connect();try{await verifier.query('BEGIN');assert.equal((await verifier.query('SELECT pg_try_advisory_xact_lock(hashtextextended($1,43001305)) AS ok',[nonce])).rows[0].ok,true);await verifier.query('ROLLBACK')}finally{verifier.release()}
 await guard.query("UPDATE guard SET state='DONE',outcome='ROLLED_BACK' WHERE id=$1 AND state='UNKNOWN'",[id]);row=await person();const recovered=input(row,'After recovery');assert.equal((await wrapped(recovered)).name,'After recovery');
 assert.notEqual((await other.pool.query('SELECT name FROM organizational_scope.person WHERE organization_id=$1 AND person_id=$2',[other.organizationId,other.owner.membershipId])).rows[0].name,'After recovery');
 report.checks.push('synthetic recovery waits for nonce termination before releasing a participating writer; second tenant remains unchanged');
 stage='actual directory recovery';row=await person();const uncertain=input(row,'Real receipt recovery');
 const reconciled=await directory.execute('personEdit',uncertain,tenant.owner.membershipId,request);assert.equal(reconciled.name,'Real receipt recovery');
 const persisted=(await tenant.pool.query('SELECT intention_digest FROM organizational_scope.directory_receipt WHERE organization_id=$1 AND idempotency_key=$2',[tenant.organizationId,uncertain.idempotencyKey])).rows;
 assert.equal(persisted.length,1);
 const recoveredGuard=(await db.central.pool.query("SELECT * FROM public.authority_commit_guard WHERE idempotency_key=$1 AND state='TENANT_COMMITTED'",[uncertain.idempotencyKey])).rows;
 assert.equal(recoveredGuard.length,1);assert.equal(recoveredGuard[0].intention_digest,persisted[0].intention_digest);assert.equal(recoveredGuard[0].source_binding.sourceOperation,'DIRECTORY_PERSONEDIT');assert.match(recoveredGuard[0].transaction_id,/^[0-9a-f-]{36}$/);
 const recovery=require('../../../backend/src/security/tenantAuthorityRecovery').createTenantAuthorityRecovery(runtime);
 const observation=await recovery(recoveredGuard[0],{deadline:Date.now()+10000});
 assert.equal(observation.terminal,true);assert.equal(observation.outcome,'COMMITTED');assert.equal(observation.transactionId,recoveredGuard[0].transaction_id);
 await assert.rejects(recovery({...recoveredGuard[0],intention_digest:'f'.repeat(64)},{deadline:Date.now()+10000}),/AUTHORITY_INTENTION_CONFLICT/);
 report.checks.push('real directory recovery port verifies completed transaction nonce and matching receipt');
 stage='lost commit acknowledgement';row=await person();const lostAck=input(row,'Reconciled uncertain commit');injectAck=true;
 const retryResult=await directory.execute('personEdit',lostAck,tenant.owner.membershipId,request);
 assert(ackObserved);assert.equal(retryResult.name,'Reconciled uncertain commit');
 const realReceipt=(await tenant.pool.query('SELECT intention_digest FROM organizational_scope.directory_receipt WHERE organization_id=$1 AND idempotency_key=$2',[tenant.organizationId,lostAck.idempotencyKey])).rows;assert.equal(realReceipt.length,1);
 const realGuard=(await db.central.pool.query("SELECT * FROM public.authority_commit_guard WHERE idempotency_key=$1 AND state='RECOVERED'",[lostAck.idempotencyKey])).rows;assert.equal(realGuard.length,1);assert.equal(realGuard[0].reconciliation_result,'COMMITTED');assert.equal(realGuard[0].intention_digest,realReceipt[0].intention_digest);assert.equal(realGuard[0].source_binding.sourceOperation,'DIRECTORY_PERSONEDIT');
 report.checks.push('real directory reconciles an observed committed write after injected acknowledgement loss using its nonce and receipt');
 stage='mandatory tenant trigger';
 const fingerprint=require('../../../backend/src/security/tenantSchemaFingerprint');
 const beforeFingerprint=fingerprint.tenantSchemaFingerprint(await fingerprint.tenantSchemaSnapshot(tenant.pool));
 // Single-table proof only: a local guard row cannot itself fence Central writes.
 // The function owner is the disposable administrator; grants and deployment
 // architecture are deliberately not represented by this experiment.
 await tenant.pool.query(`CREATE TABLE public.perf03_guard_experiment (id int PRIMARY KEY,active boolean NOT NULL); INSERT INTO public.perf03_guard_experiment VALUES(1,true);
  CREATE FUNCTION public.perf03_reject_write() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$ BEGIN
   IF (SELECT active FROM public.perf03_guard_experiment WHERE id=1 FOR SHARE) IS DISTINCT FROM false THEN RAISE EXCEPTION 'PERF03_GUARD_ACTIVE'; END IF; RETURN NEW; END $$;
  CREATE TRIGGER perf03_guard BEFORE UPDATE ON organizational_scope.person FOR EACH ROW EXECUTE FUNCTION public.perf03_reject_write()`);
 const afterFingerprint=fingerprint.tenantSchemaFingerprint(await fingerprint.tenantSchemaSnapshot(tenant.pool));assert.notEqual(afterFingerprint,beforeFingerprint);
 const direct=await tenant.pool.connect();try{await direct.query('BEGIN');await direct.query('SET LOCAL ROLE c4g_opportunity_tenant_runtime');await direct.query("SELECT set_config('app.organization_id',$1,true)",[tenant.organizationId]);
  await assert.rejects(direct.query('UPDATE organizational_scope.person SET name=$3,revision=revision+1 WHERE organization_id=$1 AND person_id=$2',[tenant.organizationId,tenant.owner.membershipId,'Forbidden bypass']),e=>e.code==='P0001'&&e.message.includes('PERF03_GUARD_ACTIVE'));await direct.query('ROLLBACK');
 }finally{await direct.query('ROLLBACK').catch(()=>{});direct.release()}
 await tenant.pool.query('DELETE FROM public.perf03_guard_experiment WHERE id=1');
 const missing=await tenant.pool.connect();try{await missing.query('BEGIN');await missing.query('SET LOCAL ROLE c4g_opportunity_tenant_runtime');await missing.query("SELECT set_config('app.organization_id',$1,true)",[tenant.organizationId]);await assert.rejects(missing.query('UPDATE organizational_scope.person SET name=$3,revision=revision+1 WHERE organization_id=$1 AND person_id=$2',[tenant.organizationId,tenant.owner.membershipId,'Missing guard bypass']),e=>e.code==='P0001'&&e.message.includes('PERF03_GUARD_ACTIVE'));await missing.query('ROLLBACK')}finally{await missing.query('ROLLBACK').catch(()=>{});missing.release()}
 row=await person();await assert.rejects(directory.execute('personEdit',input(row,'Refused after drift'),tenant.owner.membershipId,request));assert.equal((await person()).name,'Reconciled uncertain commit');
 report.checks.push('experimental tenant trigger rejects direct SQL with an active or missing guard; schema fingerprint changes and the unchanged runtime rejects the modified tenant');
 stage='central tenant coordination';
 await tenant.pool.query('INSERT INTO public.perf03_guard_experiment VALUES(1,false)');
 const ongoing=await tenant.pool.connect(),activation=await tenant.pool.connect();let pending;
 try{
  await ongoing.query('BEGIN');await ongoing.query('SET LOCAL ROLE c4g_opportunity_tenant_runtime');await ongoing.query("SELECT set_config('app.organization_id',$1,true)",[tenant.organizationId]);
  const changed=await ongoing.query('UPDATE organizational_scope.person SET name=$3,revision=revision+1 WHERE organization_id=$1 AND person_id=$2',[tenant.organizationId,tenant.owner.membershipId,'Preexisting writer']);assert.equal(changed.rowCount,1);
  await activation.query('BEGIN');const pid=activation.processID;pending=activation.query('UPDATE public.perf03_guard_experiment SET active=true WHERE id=1');pending.catch(()=>{});
  let blocked=false;for(let i=0;i<200;i++){const observation=await other.pool.query('SELECT wait_event_type FROM pg_stat_activity WHERE pid=$1',[pid]);if(observation.rows[0]?.wait_event_type==='Lock'){blocked=true;break}await new Promise(r=>setTimeout(r,10))}assert(blocked);
  await ongoing.query('COMMIT');await pending;await activation.query('COMMIT');
 }finally{await ongoing.query('ROLLBACK').catch(()=>{});await activation.query('ROLLBACK').catch(()=>{});ongoing.release();activation.release()}
 // No Central guard exists yet: interruption in this interval must still fail closed.
 const checkBlock=async()=>{const c=await tenant.pool.connect();try{await c.query('BEGIN');await c.query('SET LOCAL ROLE c4g_opportunity_tenant_runtime');await c.query("SELECT set_config('app.organization_id',$1,true)",[tenant.organizationId]);await assert.rejects(c.query('UPDATE organizational_scope.person SET name=$3,revision=revision+1 WHERE organization_id=$1 AND person_id=$2',[tenant.organizationId,tenant.owner.membershipId,'Should be denied']),e=>e.code==='P0001');await c.query('ROLLBACK')}finally{await c.query('ROLLBACK').catch(()=>{});c.release()}};
 await checkBlock();const coordinatedId=randomUUID();await activate(coordinatedId,randomUUID());await checkBlock();
 await guard.query("UPDATE guard SET state='DONE',outcome='ROLLED_BACK' WHERE id=$1",[coordinatedId]);await tenant.pool.query('UPDATE public.perf03_guard_experiment SET active=false WHERE id=1');
 report.checks.push('tenant activation waits for an in-flight tenant writer and remains fail-closed before and after Central guard activation');
 report.status='PASS';
}
main().catch(e=>{report.status='FAIL';report.error={stage,name:e.name,code:e.internalCode||e.code||null};process.exitCode=1}).finally(async()=>{await guard?.end();await admin?.end();try{await db?.close()}catch(e){report.status='FAIL';report.cleanupError=e.code||e.name;process.exitCode=1}save();console.log('MATCHING_REAL_WRITERS_'+report.status)});
