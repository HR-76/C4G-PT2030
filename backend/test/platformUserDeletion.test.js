'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {createUserDeletion}=require('../src/platformDirectory/deletion');
const q=require('../src/platformDirectory/deletionSql');
const adminSql=require('../src/platformOnboarding/sql').admin;
const actor='10000000-0000-4000-8000-000000000001',target='10000000-0000-4000-8000-000000000002',key='10000000-0000-4000-8000-000000000003';
const issuer='https://identity.example.invalid/realms/c4g';
const input={requestId:key,expectedRevision:1,confirmation:'ELIMINAR'};
const request={user:{id:actor},sessionID:'sid',authContext:{sessionId:'sid',evidence:{policyVersion:'v1',authTime:100,acr:'mfa',amr:['otp']}}};
function setup(options={}){
 let operation=null;const writes=[],external=[],auditEvents=[];
 const identities=[{issuer,subject:'10000000-0000-4000-8000-000000000004'}];
 const memberships=[{organizationId:'10000000-0000-4000-8000-000000000005',membershipId:'10000000-0000-4000-8000-000000000006'}];
 const c={async query(sql,values){
  let rows=[];
  if(sql===adminSql)rows=options.unauthorized?[]:[{id:actor}];
  else if(sql===q.operation)rows=operation?[structuredClone(operation)]:[];
  else if(sql===q.target)rows=[{id:target,status:'ACTIVE',session_revocation_version:1}];
  else if(sql===q.protected)rows=[{protected:!!options.lastAdmin}];
  else if(sql===q.pending)rows=[{pending:!!options.pending}];
  else if(sql===q.identities)rows=options.identities||identities;
  else if(sql===q.memberships)rows=memberships;
  else if(sql===q.start){operation={global_user_id:target,request_key:key,phase:'BLOCKED',identities,memberships};rows=[structuredClone(operation)];writes.push(sql);}
  else if(sql===q.phase){operation.phase=values[2];rows=[structuredClone(operation)];}
  else if(sql===q.finish){operation.phase='COMPLETE';operation.identities=[];rows=[structuredClone(operation)];}
  else writes.push(sql);
  return {rows,rowCount:rows.length};
 }};
 const coordinator={pool:c,withAuthority:fn=>fn(),async write(scopes,fn){assert.ok(scopes.includes('POLICY'));assert.ok(scopes.includes('MEMBER:'+memberships[0].membershipId));const before=structuredClone(operation),length=writes.length;try{return await fn(c);}catch(e){operation=before;writes.length=length;throw e;}}};
 const identity={async remove(reference){external.push('identity');if(options.failIdentity)throw Error('unavailable');return {...reference,deleted:true};}};
 const projection={async anonymize(value){external.push('projection');if(options.failProjection)throw Error('unavailable');return {...value,anonymized:true};}};
 const service=createUserDeletion({coordinator,identity,projection,issuer,policyVersion:'v1',recentMfaRequirement:options.requirement===null?null:options.requirement||{mfa:true,maxAgeSeconds:300,acceptedAcr:['mfa'],acceptedAmr:['otp'],amrMode:'all'},clock:()=>110000,audit:async(c,event)=>auditEvents.push(event)});
 return {service,writes,external,auditEvents,operation:()=>operation};
}
test('blocks access before external deletion, anonymizes and preserves technical history',async()=>{
 const h=setup();const result=await h.service.remove(target,input,request);
 assert.equal(result.phase,'COMPLETE');assert.deepEqual(h.external,['identity','projection']);
 for(const command of ['archive','sessions','sessionPayloads','roles','removeMemberships','anonymize','memberInputs','references'])assert.ok(h.writes.includes(q[command]));
 assert.deepEqual(h.auditEvents.map(e=>e.detailCode),['ACCOUNT_DELETION_STARTED','ACCOUNT_DELETION_COMPLETED']);
 assert.ok(!h.writes.some(sql=>/DELETE FROM public\.(global_user|organization_membership)/.test(sql)));
});
test('replay returns the same result without another provider mutation',async()=>{
 const h=setup();await h.service.remove(target,input,request);const count=h.writes.length;
 await h.service.remove(target,input,request);assert.equal(h.writes.length,count);assert.deepEqual(h.external,['identity','projection']);
});
test('rejects unauthorized, self, last administrator, stale and missing MFA without changes',async()=>{
 const cases=[{options:{unauthorized:true},code:'C4G_ADMIN_REQUIRED'},{id:actor,code:'SELF_ACCESS_PROTECTED'},{options:{lastAdmin:true},code:'LAST_ADMIN_PROTECTED'},{options:{pending:true},code:'ONBOARDING_IN_PROGRESS'},{body:{...input,expectedRevision:2},code:'STALE_REVISION'},{req:{...request,authContext:{sessionId:'sid'}},code:'MFA_REQUIRED'}];
 for(const example of cases){const h=setup(example.options);await assert.rejects(h.service.remove(example.id||target,example.body||input,example.req||request),{code:example.code});assert.equal(h.writes.length,0);assert.equal(h.external.length,0);}
});
test('an external failure never completes or re-enables the account; the same request resumes',async()=>{
 for(const kind of ['failIdentity','failProjection']){
  const options={[kind]:true},h=setup(options);await assert.rejects(h.service.remove(target,input,request));
  assert.ok(h.writes.includes(q.archive));assert.notEqual(h.operation().phase,'COMPLETE');
  options[kind]=false;assert.equal((await h.service.remove(target,input,request)).phase,'COMPLETE');
  assert.equal(h.writes.filter(s=>s===q.archive).length,1);
 }
});
test('a different retry key and a foreign issuer cannot delete another identity',async()=>{
 const h=setup();await h.service.remove(target,input,request);
 await assert.rejects(h.service.remove(target,{...input,requestId:actor},request),{code:'DELETION_CONFLICT'});
 const foreign=setup({identities:[{issuer:'https://foreign.invalid',subject:target}]});
 await assert.rejects(foreign.service.remove(target,input,request),{code:'IDENTITY_RECONCILIATION_REQUIRED'});assert.equal(foreign.writes.length,0);
});

test('optional MFA policy accepts recent password authentication but refuses missing, stale and foreign evidence',async()=>{
 const requirement={mfa:false,maxAgeSeconds:300,acceptedAcr:['c4g-loa1'],acceptedAmr:['pwd'],amrMode:'any'};
 const evidence={policyVersion:'v1',authTime:100,acr:'c4g-loa1',amr:['pwd']};
 const req={...request,authContext:{sessionId:'sid',evidence}};
 assert.equal((await setup({requirement}).service.remove(target,input,req)).phase,'COMPLETE');
 for(const value of [undefined,{...evidence,authTime:-300},{...evidence,policyVersion:'another-policy'}]){
  const h=setup({requirement});
  await assert.rejects(h.service.remove(target,input,{...req,authContext:{sessionId:'sid',evidence:value}}),{code:'REAUTH_REQUIRED'});
  assert.equal(h.writes.length,0);assert.equal(h.external.length,0);
 }
 const absent=setup({requirement:null});
 await assert.rejects(absent.service.remove(target,input,req),{code:'MFA_REQUIRED'});
 assert.equal(absent.writes.length,0);
});
