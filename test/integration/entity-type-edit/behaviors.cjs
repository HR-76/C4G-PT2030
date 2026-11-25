 'use strict';
const assert=require('node:assert/strict'),{randomUUID}=require('node:crypto');
const {createAuthorityCoordinator}=require('../../../backend/src/security/authorityCoordinator');
const {createRegistrationService}=require('../../../backend/src/entityAdmission/registrationService');
async function verify(pool,port){
 const org=randomUUID(),actor=randomUUID(),sid=randomUUID();
 const c=await pool.connect();
 try{
  await c.query('BEGIN');await c.query("SET LOCAL session_replication_role='replica'");
  await c.query("INSERT INTO public.organization(id,legal_name,display_name,slug,type_code,status,reporting_currency,mfa_policy_code) VALUES($1,'Synthetic','Synthetic',$2,'UNSPECIFIED','ACTIVE','EUR','USER_OPTIONAL')",[org,'test-'+org]);
  await c.query("INSERT INTO public.global_user(id,display_name,primary_email,status) VALUES($1,'Synthetic',$2,'ACTIVE')",[actor,actor+'@example.invalid']);
  await c.query("INSERT INTO public.platform_admin_assignment(id,global_user_id,role_code,status) VALUES($1,$2,'C4G_ADMIN','ACTIVE')",[randomUUID(),actor]);
  await c.query("INSERT INTO public.application_session(sid,global_user_id,status,revocation_version,created_at,last_seen_at,expires_at) VALUES($1,$2,'ACTIVE',1,clock_timestamp(),clock_timestamp(),clock_timestamp()+interval '1 hour')",[sid,actor]);
  await c.query('COMMIT');
 }catch(e){await c.query('ROLLBACK');throw e}finally{c.release()}
 await pool.query('ALTER ROLE c4g_authority_runtime LOGIN');
 const runtime=new (require('../../../backend/node_modules/pg').Pool)({host:'127.0.0.1',port,user:'c4g_authority_runtime',database:'postgres'});
 try{
 const coordinator=createAuthorityCoordinator({pool:runtime,permitSecret:'synthetic-entity-type-gate-secret-32-characters',timeoutMs:60000});
 const organizationReader=async id=>(await pool.query('SELECT id,legal_name AS "legalName",display_name AS name,type_code AS "typeCode",status,reporting_currency AS currency FROM public.organization WHERE id=$1',[id])).rows[0];
 const service=createRegistrationService({coordinator,organizationReader});
 const req={user:{id:actor},sessionID:sid,authContext:{sessionId:sid}};
 const body={expectedRevision:0,expectedTypeCode:'UNSPECIFIED',typeCode:'CONSULTANCY',requestId:randomUUID()};
 const saved=await service.typeForPlatform(org,body,req);
 assert.equal(saved.complete,false);assert.equal(saved.fields.typeCode,'CONSULTANCY');
 assert.deepEqual(await service.typeForPlatform(org,body,req),saved);
 assert.equal((await organizationReader(org)).typeCode,'CONSULTANCY');
 await assert.rejects(()=>service.typeForPlatform(org,{...body,requestId:randomUUID()},req),e=>e.code==='ONBOARDING_STALE');
 // An audit failure must roll back BOTH identity and registration.
 const failing=createRegistrationService({coordinator,organizationReader,audit:async()=>{throw Error('SYNTHETIC_AUDIT_FAILURE')}});
 await assert.rejects(()=>failing.typeForPlatform(org,{...body,expectedRevision:saved.revision,expectedTypeCode:'CONSULTANCY',typeCode:'COMPANY',requestId:randomUUID()},req),/SYNTHETIC_AUDIT_FAILURE/);
 assert.equal((await organizationReader(org)).typeCode,'CONSULTANCY');
 assert.equal((await service.read(org)).fields.typeCode,'CONSULTANCY');
 assert.equal((await service.read(org)).revision,saved.revision);
 const results=await Promise.allSettled(['COMPANY','RESEARCH'].map(typeCode=>service.typeForPlatform(org,{...body,expectedRevision:saved.revision,expectedTypeCode:'CONSULTANCY',typeCode,requestId:randomUUID()},req)));
 assert.equal(results.filter(x=>x.status==='fulfilled').length,1);
 assert.equal(results.find(x=>x.status==='rejected').reason.code,'ONBOARDING_STALE');
 assert.equal((await organizationReader(org)).typeCode,(await service.read(org)).fields.typeCode);
 }finally{await runtime.end()}
}
module.exports={verify};
