'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const {randomUUID,createHash}=require('node:crypto');
const {AsyncLocalStorage}=require('node:async_hooks');
const {Client}=require('../../../backend/node_modules/pg');
const {centralAuthorityFixture}=require('../f13/central-authority-fixture');
const {createTaxonomySessionAuthority}=require('../../../backend/src/security/authenticatedAuthority');
const {createMembershipRepository}=require('../../../backend/src/security/membershipRepository');
const {SQL:securitySql}=require('../../../backend/src/security/authoritySecurityManifest');
const protocolSql=new Set(require('../../../backend/src/security/authorityProtocolQueries').queries);
const {hash}=require('../../../backend/src/security/authorityCoordinator');
const lockSql='SELECT pg_advisory_xact_lock(43001306,1)';
const digest=value=>createHash('sha256').update(value).digest('hex');
const protocolHashes=new Set([...protocolSql].map(digest));
const transportScope=new AsyncLocalStorage(),originalQuery=Client.prototype.query;
// The shared fixture expands protocol SQL for its own observations. Some raw
// infrastructure SQL also belongs to that catalog, so classify the transport
// before expansion instead. Capture only its static query hash, never parameters.
Client.prototype.query=function(...args){
 const transport=transportScope.getStore();
 if(transport&&args[0]==='SELECT authority_api.execute($1,$2::text[],$3) AS result'){
  const queryHash=args[1]?.[0];
  if(typeof queryHash==='string'&&protocolHashes.has(queryHash))transport.hashes.push(queryHash);
  else transport.unrecognized++;
 }
 return originalQuery.apply(this,args);
};
const reportName=process.env.AUTHORITY_SHORT_GROUPS_REPORT||'authority-short-groups';
assert(/^[a-z0-9-]+$/.test(reportName));
const output=path.resolve(__dirname,'../../../context/reviews',reportName,'postgres-short-groups.json');
const report={startedAt:new Date().toISOString(),status:'RUNNING',checks:[],pairs:[],boundaries:[],cleanupErrors:[],limits:[
 'Exclusive disposable PostgreSQL using the current Central fixture also used by the HTTP/OIDC gate; no Dev connection is read.',
 'Real limited authority LOGIN, session registry, persisted sessions, membership/F5 repositories and authority coordinator; synthetic identities, no OIDC browser.',
 'Pair probes invoke the unchanged F3 methods inside the same short withAuthority callback used by production. Actual composition callsites and HTTP totals are verified by the separate unchanged HTTP/profile gates.',
 'Prepare probes use a synthetic binding and an owned PostgreSQL client, and stop before issuing a guard. They prove fresh Central rejection, not a tenant commit or physical F4 binding.',
 'The existing audit-dashboard proof covers tenant durability and commit uncertainty separately; the authority-metadata proof covers an actual advisory-lock wait and committed post-lock drift.',
 'Clock advances below are deterministic dependency injections in this test process, not elapsed-time performance measurements.',
 'Only SQL hashes and counts are persisted. No SID, query parameters, connection URL, credentials or authority tokens are written to the report.'
]};
let fixture,authority,stage='owned target',instant=Date.now();
const clock={now:()=>new Date(instant)};
const save=()=>{fs.mkdirSync(path.dirname(output),{recursive:true});fs.writeFileSync(output,JSON.stringify(report,null,2)+'\n');};
const check=name=>{report.checks.push(name);console.log('PASS '+name);save();};
const code=error=>error?.code||error?.internalCode||error?.name||'UNKNOWN';
const fixedClock=()=>{instant=Date.now();};
function safeFailure(error){
 const frames=String(error?.stack||'').split('\n').filter(line=>line.trim().startsWith('at '))
  .map(line=>line.match(/authority-short-groups[\\/]proof\.js:(\d+):(\d+)/))
  .filter(Boolean).slice(0,4).map(match=>({file:'test/integration/authority-short-groups/proof.js',line:Number(match[1]),column:Number(match[2])}));
 const scalar=value=>typeof value==='boolean'||typeof value==='number'&&Number.isFinite(value);
 return {stage,code:code(error),frames,...(error?.code==='ERR_ASSERTION'?{
  assertionOperator:['strictEqual','deepStrictEqual','match','ifError','==','!='].includes(error.operator)?error.operator:'assertion',
  ...(scalar(error.actual)?{actual:error.actual}:{}),...(scalar(error.expected)?{expected:error.expected}:{})}: {})};
}
function counts(observations,transport){
 const sqlHashes={};for(const observation of observations){const key=digest(observation.sql||'UNDECODED_SQL');sqlHashes[key]=(sqlHashes[key]||0)+1;}
 return {sqlCalls:observations.length,authorityTransactions:observations.filter(o=>o.sql===lockSql).length,
  securityCollections:observations.filter(o=>o.sql===securitySql).length,
  protocolCalls:transport.hashes.length,protocolSequence:transport.hashes,unrecognizedProtocolCalls:transport.unrecognized,
  failedQueries:observations.filter(o=>o.errorCode).length,sqlHashes};
}
async function measured(callback){
 const start=fixture.observations.length,transport={hashes:[],unrecognized:0};let value,error;
 try{value=await transportScope.run(transport,callback);}catch(caught){error=caught;}
 return {value,error,counts:counts(fixture.observations.slice(start),transport)};
}
async function actor(){
 const value=await fixture.user(randomUUID(),randomUUID(),randomUUID());
 fixedClock();return value;
}
async function capture(user,grouped){
 const work=async()=>{const handle=await authority.captureAuthenticatedRequest(user.request);const context=await authority.resolve(handle);return {handle,context};};
 return grouped?fixture.coordinator.withAuthority(work):work();
}
async function projections(handle,grouped){
 const work=async()=>({identity:await authority.guardIdentity(handle),context:await authority.resolve(handle)});
 return grouped?fixture.coordinator.withAuthority(work):work();
}
function sameContext(a,b){assert.deepEqual(a.actor,b.actor);assert.deepEqual(a.assuranceEvidence,b.assuranceEvidence);}
function pairEvidence(name,before,after){
 assert.ifError(before.error);assert.ifError(after.error);
 assert.equal(before.counts.unrecognizedProtocolCalls,0);assert.equal(after.counts.unrecognizedProtocolCalls,0);
 assert(before.counts.protocolCalls>0);assert(after.counts.protocolCalls>0);
 assert.equal(before.counts.authorityTransactions,2);assert.equal(after.counts.authorityTransactions,1);
 assert.equal(before.counts.securityCollections,4);assert.equal(after.counts.securityCollections,2);
 assert.equal(before.counts.sqlCalls-after.counts.sqlCalls,33);
 assert.deepEqual(after.counts.protocolSequence,before.counts.protocolSequence);
 assert.equal(after.counts.protocolCalls,before.counts.protocolCalls);
 const record=report.pairs.find(pair=>pair.name===name);assert(record);
 record.protocolSequenceUnchanged=true;record.verified=true;check(name);
}
function recordPair(name,before,after){
 report.pairs.push({name,before:before.counts,after:after.counts,verified:false,
  beforeError:before.error?code(before.error):null,afterError:after.error?code(after.error):null});save();
}
async function pairs(){
 stage='capture and resolve pair';const user=await actor();
 const separate=await measured(()=>capture(user,false)),grouped=await measured(()=>capture(user,true));
 recordPair('capture plus resolve keeps every F3 query and uses one real authority transaction',separate,grouped);
 assert.ifError(separate.error);assert.ifError(grouped.error);
 sameContext(separate.value.context,grouped.value.context);
 pairEvidence('capture plus resolve keeps every F3 query and uses one real authority transaction',separate,grouped);
 stage='identity and resolve pair';const handle=grouped.value.handle;
 const first=await measured(()=>projections(handle,false)),second=await measured(()=>projections(handle,true));
 recordPair('guardIdentity plus resolve keeps every F3 query and uses one real authority transaction',first,second);
 assert.ifError(first.error);assert.ifError(second.error);
 sameContext(first.value.context,second.value.context);assert.deepEqual(first.value.identity,second.value.identity);
 pairEvidence('guardIdentity plus resolve keeps every F3 query and uses one real authority transaction',first,second);
 const nested=await measured(()=>fixture.coordinator.withAuthority(()=>projections(handle,true)));
 assert.ifError(nested.error);assert.equal(nested.counts.authorityTransactions,1);
 assert.deepEqual(nested.counts.protocolSequence,second.counts.protocolSequence);
 check('a nested short callback reuses only its active transaction');
 const repeated=await measured(async()=>{await projections(handle,true);await projections(handle,true);});
 assert.ifError(repeated.error);assert.equal(repeated.counts.authorityTransactions,2);assert.equal(repeated.counts.securityCollections,4);
 assert.deepEqual(repeated.counts.protocolSequence,[...second.counts.protocolSequence,...second.counts.protocolSequence]);
 check('successive short callbacks recollect admission and post-lock security metadata');
}
async function epoch(key){return BigInt((await fixture.pool.query('SELECT epoch::text FROM public.authority_scope_epoch WHERE scope_key=$1',[key])).rows[0]?.epoch||'0');}
async function prepareProbe(user,handle){
 const physical=await fixture.pool.connect(),correlationId=randomUUID();let entered=false,validated=false;
 try{
  const result=await measured(()=>fixture.coordinator.prepare({tenantId:user.request.organizationContext.organizationId,
   organizationId:user.request.organizationContext.organizationId,subjectId:user.id,membershipId:user.membershipId,
   transactionId:randomUUID(),correlationId,sessionDigest:hash(user.sid),deadline:instant+8000,
   sourceBinding:{snapshotDigest:digest('owned-synthetic-prepare-probe'),backendPid:physical.processID,backendStart:new Date().toISOString()}},
  async()=>{
   entered=true;await authority.resolve(handle);await authority.guardIdentity(handle);validated=true;
   // Deliberately stop before guard creation: this is a Central boundary proof,
   // not a tenant transaction or an artificial successful authorization.
   throw Object.assign(Error('PROOF_PREPARE_STOP'),{code:'PROOF_PREPARE_STOP'});
  },physical));
  assert(result.error,'The boundary probe must never create or return a guard.');
  const guards=await fixture.pool.query('SELECT count(*)::int AS n FROM public.authority_commit_guard WHERE correlation_id=$1',[correlationId]);
  assert.equal(guards.rows[0].n,0);
  return {...result,entered,validated,guards:0};
 }finally{physical.release();}
}
async function freshPrepare(){
 stage='fresh prepare after short group';const user=await actor(),group=await capture(user,true);
 const result=await prepareProbe(user,group.handle);
 assert.equal(code(result.error),'PROOF_PREPARE_STOP');assert.equal(result.entered,true);assert.equal(result.validated,true);
 assert.equal(result.counts.authorityTransactions,1);assert.equal(result.counts.securityCollections,2);
 assert(result.counts.protocolCalls>1);
 report.boundaries.push({name:'fresh prepare',freshValidationEntered:true,freshValidationCompleted:true,
  guards:0,controlledStop:true,counts:result.counts});
 check('prepare starts a separate fresh admission and post-lock validation after a completed short group');
}
async function revoked(kind){
 stage='committed '+kind+' revocation';const user=await actor(),group=await capture(user,true);
 const key=kind==='membership'?'MEMBER:'+user.membershipId:fixture.coordinator.sessionKey(user.sid),before=await epoch(key);
 if(kind==='membership')await createMembershipRepository(fixture.pool,fixture.coordinator).changeStatus({membershipId:user.membershipId,status:'SUSPENDED'});
 else await fixture.registry.revokeSession(user.sid);
 const after=await epoch(key);assert(after>before);
 const result=await prepareProbe(user,group.handle);
 assert.equal(code(result.error),'AUTHORITY_STALE');assert.equal(result.entered,true);assert.equal(result.validated,false);
 assert.equal(result.counts.authorityTransactions,1);assert.equal(result.counts.securityCollections,2);
 if(kind==='membership')assert.equal((await fixture.pool.query('SELECT status FROM public.organization_membership WHERE id=$1',[user.membershipId])).rows[0].status,'SUSPENDED');
 else assert.equal(await fixture.registry.validateSession({sid:user.sid,globalUserId:user.id,revocationVersion:1,now:instant}),false);
 report.boundaries.push({name:kind+' revocation',committed:true,epochAdvanced:true,enteredPrepare:true,
  validationCompleted:false,guards:0,rejection:'AUTHORITY_STALE',counts:result.counts});
 check('committed '+kind+' revocation between group and prepare advances epochs and denies stale authority');
}
async function aclDrift(){
 stage='ACL drift between group and prepare';const user=await actor(),group=await capture(user,true);let changed=false;
 try{
  await fixture.pool.query('GRANT SELECT ON public.global_user TO PUBLIC');changed=true;
  const result=await prepareProbe(user,group.handle);
  assert.match(String(result.error.message),/Central schema drift/);assert.equal(result.entered,false);
  assert.equal(result.counts.authorityTransactions,0);assert.equal(result.counts.securityCollections,1);
  report.boundaries.push({name:'ACL drift before prepare',committed:true,enteredPrepare:false,guards:0,
   rejection:'CENTRAL_SCHEMA_DRIFT',counts:result.counts});
 }finally{if(changed)await fixture.pool.query('REVOKE SELECT ON public.global_user FROM PUBLIC');}
 const restored=await measured(()=>projections(group.handle,true));assert.ifError(restored.error);
 assert.equal(restored.counts.authorityTransactions,1);assert.equal(restored.counts.securityCollections,2);
 check('committed ACL drift after the group is rejected by fresh prepare preflight and fixture restoration succeeds');
}
async function expiry(){
 stage='session expiry inside short callback';const user=await actor();
 const sess=(await fixture.pool.query('SELECT sess FROM public.application_session_store WHERE sid=$1',[user.sid])).rows[0].sess;
 sess.auth.absoluteExpiresAt=instant+4000;
 await fixture.registry.rotateSession({sid:user.sid,globalUserId:user.id,revocationVersion:1,expiresAt:sess.auth.absoluteExpiresAt,organizationContext:user.request.organizationContext});
 await fixture.coordinator.write([fixture.coordinator.sessionKey(user.sid)],()=>fixture.coordinator.pool.query(
  'INSERT INTO "public"."application_session_store" (sess, expire, sid) SELECT $1, to_timestamp($2), $3 ON CONFLICT (sid) DO UPDATE SET sess=$1, expire=to_timestamp($2) RETURNING sid',
  [sess,sess.auth.absoluteExpiresAt/1000,user.sid]));
 const group=await capture(user,true);let firstCompleted=false,returned=false;
 try{
  const result=await measured(()=>fixture.coordinator.withAuthority(async()=>{
   await authority.guardIdentity(group.handle);firstCompleted=true;instant=sess.auth.absoluteExpiresAt+1;
   await authority.resolve(group.handle);returned=true;
  }));
  assert.equal(firstCompleted,true);assert.equal(returned,false);assert.equal(code(result.error),'AUTHORITY_REQUIRED');
  assert.equal(result.counts.authorityTransactions,1);
  report.boundaries.push({name:'expiry within group',firstCompleted,returned,rejection:'AUTHORITY_REQUIRED',counts:result.counts});
  check('the second F3 validation still refuses session expiry inside the shared transaction');
 }finally{fixedClock();}
}
async function budget(){
 stage='shared authority budget';const user=await actor(),group=await capture(user,true);let firstCompleted=false,returned=false;
 try{
  const result=await measured(()=>fixture.coordinator.withAuthority(async()=>{
   await authority.guardIdentity(group.handle);firstCompleted=true;instant+=10001;
   await authority.resolve(group.handle);returned=true;
  }));
  assert.equal(firstCompleted,true);assert.equal(returned,false);assert.equal(code(result.error),'AUTHORITY_DEADLINE');
  assert.equal(result.counts.authorityTransactions,1);
  report.boundaries.push({name:'shared budget',firstCompleted,returned,rejection:'AUTHORITY_DEADLINE',counts:result.counts});
  check('the grouped pair shares one authority deadline and cannot restart its budget for the second method');
 }finally{fixedClock();}
}
async function run(){
 const target=new URL(process.env.AUTHORITY_SHORT_GROUPS_ADMIN_URL||'');
 assert.equal(target.hostname,'127.0.0.1');assert.equal(target.pathname,'/postgres');assert.equal(target.username,'proof_admin');
 assert(/^\d+$/.test(target.port)&&!['5432','5433'].includes(target.port));
 assert(/^[a-f0-9]{32}$/.test(process.env.AUTHORITY_SHORT_GROUPS_RUN||''));
 stage='current Central fixture';fixture=await centralAuthorityFixture(target.toString(),{clock,validateHistoricalRoundTrip:false});fixedClock();
 authority=createTaxonomySessionAuthority({sessionStore:fixture.store,sessionRegistry:fixture.registry,
  ...fixture.data,authorityCoordinator:fixture.coordinator,policyVersion:'c4g-assurance-v1',clock});
 const role=(await fixture.authorityPool.query('SELECT session_user,rolsuper,rolbypassrls,rolcreaterole,rolcreatedb FROM pg_roles WHERE rolname=session_user')).rows[0];
 assert.deepEqual(role,{session_user:'c4g_authority_runtime',rolsuper:false,rolbypassrls:false,rolcreaterole:false,rolcreatedb:false});
 await assert.rejects(()=>fixture.authorityPool.query('SELECT * FROM public.global_user'),error=>error.code==='42501');
 report.postgres=(await fixture.pool.query('SHOW server_version')).rows[0].server_version;
 check('current real limited authority LOGIN cannot directly read central application tables');
 await pairs();await freshPrepare();await revoked('membership');await revoked('session');await aclDrift();await expiry();await budget();
 report.status='PASS';
}
run().catch(error=>{report.status='FAIL';report.failure=safeFailure(error);process.exitCode=1;})
 .finally(async()=>{
  try{await fixture?.close({retain:true});}catch(error){report.status='FAIL';report.cleanupErrors.push({code:code(error)});process.exitCode=1;}
  Client.prototype.query=originalQuery;
  report.finishedAt=new Date().toISOString();save();console.log('AUTHORITY_SHORT_GROUPS_PROOF '+report.status+' checks='+report.checks.length);
 });
