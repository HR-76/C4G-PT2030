'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createPlatformAccess}=require('../src/platformDirectory/access');
const {RECOGNIZED_ASSURANCE_POLICIES:policies}=require('../src/security/authConfig');
const q=require('../src/platformOnboarding/memberSql');
const org='00000000-0000-4000-8000-000000000001',id='00000000-0000-4000-8000-000000000002',actor='00000000-0000-4000-8000-000000000003',other='00000000-0000-4000-8000-000000000004',key='00000000-0000-4000-8000-000000000005';
const now=2000000;
function fixture({version='c4g-user-mfa-v1',assigned=true,activeOrg=true,auditFail=false,target={},requirement=policies[version].policy[policies[version].privilegedCategory]}={}){
 const events=[],committed=[],writes=[],reads=[];
 const row={id,organization_id:org,global_user_id:other,status:'ACTIVE',base_role_code:'VIEWER',membership_version:1,valid_from:new Date(0),valid_until:null,...target};
 const client={async query(sql,params){
  reads.push({sql,params});
  if(sql===q.admin)return {rows:assigned?[{id:actor}]:[]};
  if(sql===q.orgActive)return {rows:activeOrg?[{id:params[0]}]:[]};
  if(sql===q.detail)return {rows:params[0]===id&&params[1]===row.organization_id?[{...row}]:[]};
  if(sql===q.accessList)return {rows:[{membershipId:id,profileCode:row.base_role_code,revision:row.membership_version}]};
  if(sql===q.state)return {rows:[{grants:[]}]};
  if([q.statusUpdate,q.profileUpdate,q.grantsUpdate].includes(sql)){
   writes.push({sql,params});
   if(sql!==q.grantsUpdate){row[sql===q.statusUpdate?'status':'base_role_code']=params[2];row.status_reason=params[3];row.membership_version++;}
   return {rows:[]};
  }
  throw Error('Unexpected query');
 }};
 const coordinator={pool:client,withAuthority:fn=>fn(),async write(scopes,work){
  assert.deepEqual(scopes,['POLICY',`ORG:${org}`,`MEMBER:${id}`]);
  const result=await work(client);committed.push(result);return result;
 }};
 const audit=async(_client,event)=>{events.push(event);if(auditFail)throw Error('AUDIT_UNAVAILABLE');};
 const service=createPlatformAccess({coordinator,policyVersion:version,assuranceRequirements:requirement,recentMfaRequirement:requirement,audit,clock:()=>now});
 const evidence={authTime:now/1000-10,acr:requirement?.mfa?'c4g-loa2':'c4g-loa1',amr:requirement?.mfa?['otp']:['pwd'],policyVersion:version};
 const request=(proof=evidence)=>({sessionID:'sid',user:{id:actor},authContext:{sessionId:'sid',evidence:proof}});
 return {service,request,evidence,events,committed,writes,reads,row};
}
const command=kind=>({[kind==='status'?'status':'profileCode']:kind==='status'?'SUSPENDED':'CONTRIBUTOR',expectedRevision:1,idempotencyKey:key});
const unchanged=f=>{assert.equal(f.writes.length,0);assert.equal(f.events.length,0);assert.equal(f.committed.length,0);};
for(const kind of ['status','profile']){
 for(const version of ['c4g-user-mfa-v1','c4g-assurance-v1']){
  test(`${kind}: accepts fresh evidence under ${version} and audits the change`,async()=>{
   const f=fixture({version});
   assert.deepEqual(await f.service.change(org,id,command(kind),f.request(),kind),{membershipId:id,revision:2});
   assert.equal(f.writes.length,kind==='status'?1:2);assert.equal(f.events.length,1);
   assert.equal(f.events[0].eventCode,'PLATFORM_ACCESS_CHANGED');assert.equal(f.events[0].actorId,actor);
   assert.equal(f.events[0].previousVersion,1);assert.equal(f.events[0].newVersion,2);
   if(kind==='profile'){
    const values=f.writes.find(w=>w.sql===q.grantsUpdate).params;
    assert.deepEqual(values.slice(0,3),[org,id,version]);
    const grants=JSON.parse(values[3]);
    assert.ok(grants.length>0);assert.ok(grants.every(g=>g.scope.organizationId===org));
    assert.ok(!grants.some(g=>g.permission==='organization_membership.manage'));
    assert.deepEqual(JSON.parse(values[4]),policies[version].policy[policies[version].privilegedCategory]);
   }
  });
  test(`${kind}: ${version} rejects absent, expired, future and foreign policy evidence before data access`,async()=>{
   for(const change of [null,{authTime:1699},{authTime:2001},{policyVersion:'unrecognized'},{authTime:NaN}]){
    const f=fixture({version}),evidence=change===null?null:{...f.evidence,...change};
    await assert.rejects(()=>f.service.change(org,id,command(kind),f.request(evidence),kind),{code:version==='c4g-user-mfa-v1'?'REAUTH_REQUIRED':'MFA_REQUIRED'});
    unchanged(f);assert.ok(!f.reads.some(r=>r.sql===q.detail));
   }
  });
 }
 test(`${kind}: strict policy rejects password-only or mismatched MFA claims`,async()=>{
  for(const claims of [{acr:'c4g-loa1',amr:['pwd']},{acr:'c4g-loa2',amr:['pwd']},{acr:'unknown',amr:['otp']}]){
   const f=fixture({version:'c4g-assurance-v1'});
   await assert.rejects(()=>f.service.change(org,id,command(kind),f.request({...f.evidence,...claims}),kind),{code:'MFA_REQUIRED'});unchanged(f);
  }
 });
 test(`${kind}: active administrator and matching session remain mandatory`,async()=>{
  for(const change of ['revoked','session','missing']){
   const f=fixture({assigned:change!=='revoked'}),request=f.request();
   if(change==='session')request.sessionID='other';if(change==='missing')delete request.authContext;
   await assert.rejects(()=>f.service.change(org,id,command(kind),request,kind),{code:'C4G_ADMIN_REQUIRED'});unchanged(f);
  }
 });
 test(`${kind}: optional MFA preserves organization, self-access and revision protections`,async()=>{
  for(const [options,code] of [
   [{activeOrg:false},'RESOURCE_NOT_AVAILABLE'],[{target:{organization_id:other}},'RESOURCE_NOT_AVAILABLE'],
   [{target:{status:'REVOKED'}},'RESOURCE_NOT_AVAILABLE'],[{target:{global_user_id:actor}},'SELF_ACCESS_PROTECTED'],
   [{target:{membership_version:2}},'STALE_REVISION']
  ]){
   const f=fixture(options);
   await assert.rejects(()=>f.service.change(org,id,command(kind),f.request(),kind),{code});unchanged(f);
  }
 });
 test(`${kind}: idempotent replay requires fresh authentication and never repeats writes or audit`,async()=>{
  const f=fixture(),input=command(kind),result=await f.service.change(org,id,input,f.request(),kind),count=f.writes.length;
  assert.deepEqual(await f.service.change(org,id,input,f.request(),kind),result);
  await assert.rejects(()=>f.service.change(org,id,input,f.request({...f.evidence,authTime:1699}),kind),{code:'REAUTH_REQUIRED'});
  await assert.rejects(()=>f.service.change(org,id,input,{...f.request(),sessionID:'other'},kind),{code:'C4G_ADMIN_REQUIRED'});
  assert.equal(f.writes.length,count);assert.equal(f.events.length,1);
 });
 test(`${kind}: audit failure propagates without confirming the transaction`,async()=>{
  const f=fixture({auditFail:true});
  await assert.rejects(()=>f.service.change(org,id,command(kind),f.request(),kind),/AUDIT_UNAVAILABLE/);
  assert.equal(f.events.length,1);assert.equal(f.committed.length,0);
 });
}
test('missing assurance requirement fails closed',async()=>{
 const f=fixture({requirement:null});
 await assert.rejects(()=>f.service.change(org,id,command('status'),f.request(),'status'),{code:'MFA_REQUIRED'});unchanged(f);
});
test('optional MFA permits reactivation within the membership validity window',async()=>{
 const f=fixture({target:{status:'SUSPENDED'}});
 assert.equal((await f.service.change(org,id,{...command('status'),status:'ACTIVE'},f.request(),'status')).revision,2);
});
test('optional MFA does not permit reactivation of expired membership',async()=>{
 const f=fixture({target:{status:'SUSPENDED',valid_until:new Date(0)}});
 await assert.rejects(()=>f.service.change(org,id,{...command('status'),status:'ACTIVE'},f.request(),'status'),{code:'MEMBERSHIP_UNAVAILABLE'});unchanged(f);
});
test('access listing remains available after recent authentication expires',async()=>{
 const f=fixture();assert.equal((await f.service.list(org,f.request({...f.evidence,authTime:1}))).items.length,1);unchanged(f);
});
for(const kind of ['status','profile'])for(const code of ['MFA_REQUIRED','REAUTH_REQUIRED'])test(`${kind} route returns explicit 403 for ${code}`,async()=>{
 const registered=[];const router={use(){},get(path,fn){registered.push({verb:'get',path,fn});},post(path,fn){registered.push({verb:'post',path,fn});},put(path,fn){registered.push({verb:'put',path,fn});}};
 const express={Router:()=>router},access={change:async()=>{throw Object.assign(Error('Internal details'),{code});}};
 require('../src/routes/platformDirectoryRoutes').createPlatformDirectoryRouter({express,service:{},authenticate(){},access,members:{}});
 const route=registered.find(x=>x.verb==='put'&&x.path===`/entities/:id/memberships/:membershipId/${kind}`);assert.ok(route);
 const response={statusCode:200,status(n){this.statusCode=n;return this;},json(body){this.body=body;return this;}};
 await route.fn({query:{},params:{id:org,membershipId:id},body:{}},response);
 assert.equal(response.statusCode,403);assert.deepEqual(response.body.error,{code});assert.ok(response.body.correlationId);
});
