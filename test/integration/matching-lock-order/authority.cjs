'use strict';
// Fresh Central authority baseline, independent of the synthetic lock protocol.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {randomUUID,createHash}=require('node:crypto'),{execFileSync}=require('node:child_process');
const {centralAuthorityFixture}=require('../f13/central-authority-fixture');
const {createTaxonomySessionAuthority}=require('../../../backend/src/security/authenticatedAuthority');
const {createMembershipRepository}=require('../../../backend/src/security/membershipRepository');
const {hash}=require('../../../backend/src/security/authorityCoordinator');
const run=process.env.MATCHING_PROOF_RUN,name=process.env.MATCHING_PROOF_REPORT,container=process.env.MATCHING_PROOF_CONTAINER,url=new URL(process.env.MATCHING_PROOF_URL);
assert.match(run,/^[a-f0-9]{32}$/);assert.match(name,/^[a-z0-9-]+$/);assert.equal(container,'c4g-matching-lock-'+run);assert.equal(url.hostname,'127.0.0.1');assert.equal(url.pathname,'/postgres');assert(!['5432','5433'].includes(url.port));
assert.equal(JSON.parse(execFileSync('docker',['inspect','--format','{{json .Config.Labels}}',container],{encoding:'utf8'}))['c4g.matching-lock'],run);
const output=path.resolve(__dirname,'../../../context/reviews',name,'authority.json');
const report={status:'RUNNING',checks:[],limits:['Real Central coordinator and session/membership revocation with synthetic identity and synthetic prepare binding; no tenant commit, proposed matching fence, OIDC, or end-to-end pagination.']};
const save=()=>fs.writeFileSync(output,JSON.stringify(report,null,2)+'\n');
async function main(){let fixture;try{
 fixture=await centralAuthorityFixture(url.toString(),{validateHistoricalRoundTrip:false});
 const clock={now:()=>new Date()},authority=createTaxonomySessionAuthority({sessionStore:fixture.store,sessionRegistry:fixture.registry,...fixture.data,authorityCoordinator:fixture.coordinator,policyVersion:'c4g-assurance-v1',clock});
 for(const kind of ['membership','session']){
  const user=await fixture.user(randomUUID(),randomUUID(),randomUUID());
  const handle=await fixture.coordinator.withAuthority(async()=>{const h=await authority.captureAuthenticatedRequest(user.request);await authority.resolve(h);return h});
  if(kind==='membership')await createMembershipRepository(fixture.pool,fixture.coordinator).changeStatus({membershipId:user.membershipId,status:'SUSPENDED'});
  else await fixture.registry.revokeSession(user.sid);
  const physical=await fixture.pool.connect(),correlationId=randomUUID();let entered=false;
  try{
   await assert.rejects(fixture.coordinator.prepare({tenantId:user.request.organizationContext.organizationId,organizationId:user.request.organizationContext.organizationId,subjectId:user.id,membershipId:user.membershipId,transactionId:randomUUID(),correlationId,sessionDigest:hash(user.sid),deadline:Date.now()+8000,sourceBinding:{snapshotDigest:createHash('sha256').update('matching-proof').digest('hex'),backendPid:physical.processID,backendStart:new Date().toISOString()}},async()=>{entered=true;await authority.resolve(handle);throw Error('UNEXPECTED_VALIDATION')},physical),{code:'AUTHORITY_STALE'});
   assert(entered);assert.equal((await fixture.pool.query('SELECT count(*)::int n FROM public.authority_commit_guard WHERE correlation_id=$1',[correlationId])).rows[0].n,0);
  }finally{physical.release()}
  report.checks.push(`committed ${kind} revocation rejects a fresh prepare and creates no guard`);
 }
 report.status='PASS';save();console.log('MATCHING_AUTHORITY_BASELINE_PASS');
 }finally{if(fixture)await fixture.close({retain:true});}}
main().catch(e=>{report.status='FAIL';report.error={name:e.name,code:e.code||null};save();console.error('MATCHING_AUTHORITY_BASELINE_FAIL',e.code||e.name);process.exitCode=1});
