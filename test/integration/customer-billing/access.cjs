'use strict';
const assert=require('node:assert/strict'),{randomUUID}=require('node:crypto'),{Pool}=require('../../../backend/node_modules/pg');
async function verify({pool,port,org}){
 const users=Array.from({length:3},()=>({id:randomUUID(),member:randomUUID(),sid:randomUUID()}));
 const [admin,manager,target]=users,policy='billing-test-v1',requirement={maxAgeSeconds:3600,mfa:false,acceptedAcr:[],acceptedAmr:[],amrMode:'all'};
 const c=await pool.connect();
 try{await c.query('BEGIN');await c.query("SET LOCAL session_replication_role='replica'");
  for(const [index,u] of users.entries()){
   await c.query("INSERT INTO public.global_user(id,display_name,primary_email,status) VALUES($1,$2,$3,'ACTIVE')",[u.id,'Financial user '+index,u.id+'@example.invalid']);
   await c.query("INSERT INTO public.organization_membership(id,global_user_id,organization_id,base_role_code,status,activated_at) VALUES($1,$2,$3,$4,'ACTIVE',clock_timestamp())",[u.member,u.id,org,['ORG_ADMIN','FUNDING_MANAGER','CONTRIBUTOR'][index]]);
   await c.query("INSERT INTO public.authority_f5_state(organization_id,membership_id,authorization_version,policy_version,assurance_requirements,grants) VALUES($1,$2,1,$3,$4,'[]')",[org,u.member,policy,JSON.stringify(requirement)]);
  }await c.query('COMMIT');
 }catch(e){await c.query('ROLLBACK');throw e}finally{c.release()}
 await pool.query('ALTER ROLE c4g_authority_runtime LOGIN');
 const authPool=new Pool({host:'127.0.0.1',port,user:'c4g_authority_runtime',database:'postgres'});
 try{
  const coordinator=require('../../../backend/src/security/authorityCoordinator').createAuthorityCoordinator({pool:authPool,permitSecret:'billing-test-disposable-authority-key-123456'});
  const contexts=new Map(users.map(u=>[u.sid,{organizationId:org,membershipId:u.member,membershipVersion:1}]));
  const stores=new Map(users.map(u=>[u.sid,{cookie:{expires:new Date(Date.now()+3600000)},auth:{user:{id:u.id},organizationContext:contexts.get(u.sid),revocationVersion:1,policyVersion:policy,absoluteExpiresAt:Date.now()+3600000,evidence:{policyVersion:policy,authTime:Math.floor(Date.now()/1000),amr:['pwd'],acr:'urn:test:pwd'}}}]));
  const deps={sessionStore:{get:(sid,cb)=>cb(null,stores.get(sid))},sessionRegistry:{validateSession:async({sid,globalUserId})=>stores.get(sid)?.auth.user.id===globalUserId,resolveOrganizationContext:async({sid})=>({state:'VALID',context:contexts.get(sid),expiresAt:Date.now()+3600000})},authorityCoordinator:coordinator,authorizationCatalogs:require('../../../backend/src/authorization/productionAuthorization').validateProductionAuthorizationBootstrap(),assurancePolicyVersion:policy,recentMfaRequirement:requirement};
  const service=require('../../../backend/src/organizationDirectory/membershipAccess').createMembershipAccess(deps);
  const request=u=>({sessionID:u.sid,user:{id:u.id},authContext:{sessionId:u.sid},organizationContext:contexts.get(u.sid),headers:{'x-c4g-organization':org}});
  const command={billingRead:true,expectedRevision:1,idempotencyKey:randomUUID()};
  const granted=await service.changeBilling(target.member,command,request(admin));assert.equal(granted.revision,2);assert.equal(granted.billingRead,true);
  assert.deepEqual(await service.changeBilling(target.member,command,request(admin)),granted);
  assert.equal((await service.list(request(admin))).items.find(m=>m.membershipId===target.member).billingRead,true);
  await assert.rejects(()=>service.changeBilling(target.member,{billingRead:false,expectedRevision:2,idempotencyKey:randomUUID()},request(manager)),{code:'NOT_AUTHORIZED'});
  await assert.rejects(()=>service.changeBilling(randomUUID(),command,request(admin)),{code:'RESOURCE_NOT_AVAILABLE'});
  await assert.rejects(()=>service.changeBilling(admin.member,command,request(admin)),{code:'SELF_ACCESS_PROTECTED'});
  await service.changeBilling(target.member,{billingRead:false,expectedRevision:2,idempotencyKey:randomUUID()},request(admin));
  assert.equal((await service.list(request(admin))).items.find(m=>m.membershipId===target.member).billingRead,false);
  await assert.rejects(()=>service.changeBilling(target.member,command,request(admin)),{code:'STALE_REVISION'});
  const state=(await pool.query('SELECT grants,authorization_version FROM public.authority_f5_state WHERE membership_id=$1',[target.member])).rows[0];assert.deepEqual(state.grants,[]);assert.equal(Number(state.authorization_version),3);
  console.log('FINANCIAL_ACCESS_REAL_COORDINATOR_GRANT_RETRY_REVOKE_DENIAL_PASS');
 }finally{await authPool.end()}
}
module.exports={verify};

