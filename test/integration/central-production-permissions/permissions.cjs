'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {Pool}=require('../../../backend/node_modules/pg');
const {randomUUID}=require('node:crypto');
const {ROLES,createRolePool}=require('../../../backend/src/security/productionCentralProfile');
async function run({pool,port,base}) {
 const results=[],raws=[],caps={};
 const check=async(name,work)=>{await work();results.push({name,pass:true});console.log(JSON.stringify({check:name,pass:true}));};
 try {
  await require('../../../backend/src/security/centralMigrationPreflight').preflightCentral(pool);
  const installer=require('../../../backend/scripts/installProductionCentral');
  const passwords=Object.fromEntries(Object.keys(installer.LOGINS).map(key=>[key,'synthetic-private-password-'.repeat(2)]));
  await check('production installer applies only explicit target and provisions dedicated logins',async()=>{
   await assert.rejects(installer.install(pool,{expectedDatabase:'staging',apply:true,passwords}),/TARGET_REQUIRED/);
   await assert.rejects(installer.install(pool,{expectedDatabase:'wrong_target',apply:true,passwords}),/TARGET_MISMATCH/);
   assert.equal((await installer.install(pool,{expectedDatabase:'postgres'})).apply,false);
   await installer.install(pool,{expectedDatabase:'postgres',apply:true,passwords});
  });
  for(const [key,role] of Object.entries(ROLES)) {
   const login=installer.LOGINS[key];
   assert.ok(role);
   const raw=new Pool({host:'127.0.0.1',port,user:login,database:'postgres',max:2});raws.push(raw);
   caps[key]=createRolePool(raw,key);
   await check(key+': real limited login',async()=>{
    const r=(await raw.query('SELECT current_user,rolsuper FROM pg_roles WHERE rolname=current_user')).rows[0];
    assert.equal(r.current_user,login);assert.equal(r.rolsuper,false);
    await assert.rejects(raw.query('SELECT * FROM public.organization'),{code:'42501'});
    await assert.rejects(raw.query('SET ROLE c4g_authority_owner'),{code:'42501'});
   });
   await check(key+': preflight under capability',()=>require('../../../backend/src/security/centralMigrationPreflight').preflightCentral(caps[key]));
  }
  const {ids,sessions}=await require('../billing-account-validation/fixtures.cjs').fixtures(pool);
  await require('./directory.cjs').run({pool,port,ids,check});
  await require('./workflows.cjs').run({pool,caps,ids,sessions,check});
  await check('readiness with limited metadata observer',()=>require('../../../backend/src/security/databaseReadiness').observeCentralDatabase(caps.read));
  await check('read has no mutation or session contents',async()=>{
   assert.ok((await caps.read.query('SELECT id FROM public.organization')).rowCount>=2);
   for(const sql of ['SELECT * FROM public.application_session_store','SELECT * FROM public.tenant_workload_connection_version',"UPDATE public.global_user SET display_name='bad'",'DELETE FROM public.organization','CREATE TABLE public.bad(id int)','CREATE TEMP TABLE bad(id int)'])await assert.rejects(caps.read.query(sql),{code:'42501'});
  });
  await check('admin verifier checks expired/other actor and does not expose session',async()=>{
   const verify=async(s,u)=>(await caps.read.query('SELECT c4g_production.administrator($1,$2,false) AS allowed',[s,u])).rows[0].allowed;
   assert.equal(await verify(sessions.admin,ids.admin),true);
   assert.equal(await verify(sessions.expiredAdmin,ids.admin),false);
   assert.equal(await verify(sessions.admin,ids.outsider),false);
  });
  await check('platform directory factory with actual limited pool',async()=>{
   const service=require('../../../backend/src/platformDirectory/service').createPlatformDirectory({pool:caps.read});
   const request={sessionID:sessions.admin,authContext:{sessionId:sessions.admin},user:{id:ids.admin}};
   assert.ok(service);
   // The route's actual method performs authority checks before and after its data query.
   const result=await service.entities({},request);assert.ok(result.items.length>=2);
   await assert.rejects(service.entities({},{...request,user:{id:ids.outsider}}),/C4G_ADMIN_REQUIRED/);
  });
  await check('logs insert-only and rollback returns role',async()=>{
   await caps.logs.query("INSERT INTO public.platform_support_event(code,global_user_id) VALUES('LOGIN',$1)",[ids.admin]);
   await assert.rejects(caps.logs.query('SELECT * FROM public.platform_support_event'),{code:'42501'});
   await assert.rejects(caps.logs.query('DELETE FROM public.platform_support_event'),{code:'42501'});
  });
  await check('cross-organization template/logo authorization',async()=>{
   const allowed=async(who,org)=>(await caps.commands.query('SELECT public.email_organization_admin($1,$2,$3) AS allowed',[sessions[who],ids[who],org])).rows[0].allowed;
   assert.equal(await allowed('orgAdminA',ids.orgA),true);
   assert.equal(await allowed('orgAdminA',ids.orgB),false);
   assert.equal(await allowed('orgAdminB',ids.orgA),false);
   await assert.rejects(caps.commands.query('UPDATE public.organization_membership SET membership_version=2'),{code:'42501'});
  });
  await check('email recording separated from retention and delivery claim',async()=>{
   const id=randomUUID();
   await caps.commands.query('SELECT public.email_delivery_begin($1,NULL,$2,false)',[id,'synthetic@example.invalid']);
   await caps.commands.query("SELECT public.email_delivery_finish($1,'ACCEPTED')",[id]);
   await assert.rejects(caps.commands.query('SELECT public.email_delivery_retention()'),{code:'42501'});
   await assert.rejects(caps.commands.query('SELECT public.billing_validation_email_claim()'),{code:'42501'});
   await assert.rejects(caps.retention.query('SELECT * FROM public.email_delivery_history'),{code:'42501'});
   await caps.retention.query('SELECT public.email_delivery_retention()');
  });
  await check('authoring has no collection, identities or generic update',async()=>{
   for(const sql of ['SELECT * FROM public.application_session','SELECT * FROM public.global_user','SELECT * FROM async_exec.outbox','SELECT * FROM opportunity_catalog.funding_run',"UPDATE opportunity_catalog.opportunity SET title='bad'",'DELETE FROM opportunity_catalog.revision'])await assert.rejects(caps.authoring.query(sql),{code:'42501'});
  });
  await check('revocation waits for authoring transaction lock',async()=>{
   const c=await caps.authoring.connect(),admin=await pool.connect();
   try {
    await c.query('BEGIN');
    assert.equal((await c.query('SELECT c4g_production.administrator($1,$2,true) AS allowed',[sessions.admin,ids.admin])).rows[0].allowed,true);
    await admin.query('BEGIN');await admin.query("SET LOCAL session_replication_role='replica'; SET LOCAL lock_timeout='100ms'");
    await assert.rejects(admin.query("UPDATE public.global_user SET status='SUSPENDED' WHERE id=$1",[ids.admin]),{code:'55P03'});
    await admin.query('ROLLBACK');await c.query('ROLLBACK');
   } finally {await c.release();admin.release();}
  });
  await check('unexpected membership is refused at checkout',async()=>{
   await pool.query('GRANT c4g_prod_commands_role TO c4g_prod_api_read WITH INHERIT FALSE, SET TRUE, ADMIN FALSE');
   await assert.rejects(caps.read.query('SELECT 1'),/PRODUCTION_LOGIN_PRIVILEGE_DRIFT/);
   await pool.query('REVOKE c4g_prod_commands_role FROM c4g_prod_api_read');
  });
  await check('capability grant drift is refused by preflight',async()=>{
   await pool.query('GRANT DELETE ON public.platform_support_event TO c4g_prod_logs_role');
   await assert.rejects(require('../../../backend/src/security/centralMigrationPreflight').preflightCentral(caps.read),/drift/i);
   await pool.query('REVOKE DELETE ON public.platform_support_event FROM c4g_prod_logs_role');
   await require('../../../backend/src/security/centralMigrationPreflight').preflightCentral(caps.read);
  });
  await check('PUBLIC function grant drift blocks all production capability admission',async()=>{
   await pool.query('GRANT EXECUTE ON FUNCTION c4g_production.administrator(text,uuid,boolean) TO PUBLIC');
   await assert.rejects(caps.logs.query('SELECT 1'),/SECURITY_DRIFT/);
   await pool.query('REVOKE EXECUTE ON FUNCTION c4g_production.administrator(text,uuid,boolean) FROM PUBLIC');
   await caps.logs.query('SELECT 1');
  });
  fs.writeFileSync(path.join(base,'results.json'),JSON.stringify({pass:true,checks:results},null,2));
  console.log(JSON.stringify({permissionChecks:results.length,pass:true}));
 } finally {await Promise.all(raws.map(p=>p.end()));}
}
module.exports={run};
