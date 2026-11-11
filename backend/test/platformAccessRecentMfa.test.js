'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createPlatformAccess}=require('../src/platformDirectory/access');
const q=require('../src/platformOnboarding/memberSql');
const org='00000000-0000-4000-8000-000000000001',id='00000000-0000-4000-8000-000000000002',actor='00000000-0000-4000-8000-000000000003',other='00000000-0000-4000-8000-000000000004',key='00000000-0000-4000-8000-000000000005';
const policy={mfa:true,maxAgeSeconds:300,acceptedAcr:['loa2'],acceptedAmr:['otp'],amrMode:'all'},now=2000000;
function fixture({assigned=true,auditFail=false,requirement=policy}={}){
 const events=[],committed=[];let writes=0;
 const client={async query(sql){if(sql===q.admin)return {rows:assigned?[{id:actor}]:[]};if(sql===q.orgActive)return {rows:[{id:org}]};if(sql===q.detail)return {rows:[{global_user_id:other,status:'ACTIVE',base_role_code:'VIEWER',membership_version:1,valid_from:new Date(0),valid_until:null}]};if(sql===q.state)return {rows:[{grants:[]}]};if(sql===q.statusUpdate||sql===q.profileUpdate||sql===q.grantsUpdate){writes++;return {rows:[]}};throw Error('Unexpected query')}};
 const coordinator={pool:client,withAuthority:fn=>fn(),async write(_scopes,work){const result=await work(client);committed.push(writes);return result}};
 const audit=async(_client,event)=>{events.push(event);if(auditFail)throw Error('AUDIT_UNAVAILABLE')};
 const service=createPlatformAccess({coordinator,policyVersion:'p1',assuranceRequirements:policy,recentMfaRequirement:requirement,audit,clock:()=>now});
 const request=evidence=>({sessionID:'sid',user:{id:actor},authContext:{sessionId:'sid',evidence}});
 const evidence={authTime:now/1000-10,acr:'loa2',amr:['otp'],policyVersion:'p1'};
 return {service,request,evidence,events,committed,get writes(){return writes}};
}
for(const kind of ['status','profile'])test(`${kind} requires current MFA and active admin before mutation`,async()=>{
 for(const change of [null,{authTime:1,acr:'loa2',amr:['otp'],policyVersion:'p1'},{authTime:1990,acr:'loa2',amr:['pwd'],policyVersion:'p1'},{authTime:1990,acr:'loa2',amr:['otp'],policyVersion:'other'}]){const f=fixture();await assert.rejects(()=>f.service.change(org,id,{[kind==='status'?'status':'profileCode']:kind==='status'?'SUSPENDED':'CONTRIBUTOR',expectedRevision:1,idempotencyKey:key},f.request(change),kind),{code:'MFA_REQUIRED'});assert.equal(f.writes,0);assert.equal(f.events.length,0)}
 const denied=fixture({assigned:false});await assert.rejects(()=>denied.service.change(org,id,{status:'SUSPENDED',expectedRevision:1,idempotencyKey:key},denied.request(denied.evidence),'status'),{code:'C4G_ADMIN_REQUIRED'});assert.equal(denied.writes,0);
});
test('authorized change records audit and audit failure prevents transaction confirmation',async()=>{
 for(const kind of ['status','profile'])for(const auditFail of [false,true]){const f=fixture({auditFail});const action=f.service.change(org,id,{[kind==='status'?'status':'profileCode']:kind==='status'?'SUSPENDED':'CONTRIBUTOR',expectedRevision:1,idempotencyKey:key},f.request(f.evidence),kind);if(auditFail)await assert.rejects(action,/AUDIT_UNAVAILABLE/);else assert.equal((await action).revision,2);assert.equal(f.events[0].eventCode,'PLATFORM_ACCESS_CHANGED');assert.equal(f.events[0].actorId,actor);assert.equal(f.committed.length,auditFail?0:1)}
});
test('missing or password-only policy fails closed',async()=>{for(const requirement of [null,{...policy,mfa:false}]){const f=fixture({requirement});await assert.rejects(()=>f.service.change(org,id,{status:'SUSPENDED',expectedRevision:1,idempotencyKey:key},f.request(f.evidence),'status'),{code:'MFA_REQUIRED'});assert.equal(f.writes,0)}});
test('administrative route returns explicit 403 for missing MFA',async()=>{
 const registered=[];const router={use(){},get(path,fn){registered.push({verb:'get',path,fn})},post(path,fn){registered.push({verb:'post',path,fn})},put(path,fn){registered.push({verb:'put',path,fn})}};
 const express={Router:()=>router},access={change:async()=>{throw Object.assign(Error(),{code:'MFA_REQUIRED'})}};
 require('../src/routes/platformDirectoryRoutes').createPlatformDirectoryRouter({express,service:{},authenticate(){},access,members:{}});
 const route=registered.find(x=>x.verb==='put'&&x.path==='/entities/:id/memberships/:membershipId/status');assert.ok(route);
 const response={statusCode:200,status(n){this.statusCode=n;return this},json(body){this.body=body;return this}};
 await route.fn({query:{},params:{id:org,membershipId:id},body:{}},response);assert.equal(response.statusCode,403);assert.equal(response.body.error.code,'MFA_REQUIRED');
});
