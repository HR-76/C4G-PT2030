'use strict';
// Called only after the bootstrap gate's replay checks, against its own cluster.
const assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');
const {Pool}=require('../../../backend/node_modules/pg');
const {LOGINS}=require('../../../backend/scripts/installProductionCentral');
const {ROLES,createRolePool}=require('../../../backend/src/security/productionCentralProfile');

async function rollbackProbe(pool,work){
 const client=await pool.connect();
 try{await client.query('BEGIN');return await work(client);}
 finally{try{await client.query('ROLLBACK');}finally{await client.release();}}
}
async function denied(pool,sql,values){await assert.rejects(pool.query(sql,values),{code:'42501'});}

async function run({central,tenant,config,credentials,connection,check}){
 assert.equal(connection.host,'127.0.0.1');
 assert.equal(config.target.host,connection.host);
 assert.equal(config.target.port,connection.port);
 assert.equal((await central.query('SELECT current_database() AS name')).rows[0].name,config.target.centralDatabase);
 assert.equal((await tenant.query('SELECT current_database() AS name')).rows[0].name,config.target.tenantDatabase);
 const raws={},caps={};
 const serviceOptions=(login,password,database=config.target.centralDatabase)=>({host:connection.host,port:connection.port,
  ssl:config.target.ssl,database,user:login,password,max:1,connectionTimeoutMillis:5000,statement_timeout:30000,
  options:'-c timezone=UTC'});
 try{
  for(const [key,login] of Object.entries({...LOGINS,authority:'c4g_authority_runtime'})){
   raws[key]=new Pool(serviceOptions(login,credentials.central[key]));
   if(Object.hasOwn(ROLES,key))caps[key]=createRolePool(raws[key],key);
   await check(key+': actual login has no direct application authority',async()=>{
    const row=(await raws[key].query(`SELECT session_user=current_user AS reset,rolcanlogin,
     rolsuper,rolbypassrls,rolcreatedb,rolcreaterole,rolreplication,rolinherit FROM pg_roles WHERE rolname=session_user`)).rows[0];
    assert.equal(row.reset,true);assert.equal(row.rolcanlogin,true);
    for(const name of ['rolsuper','rolbypassrls','rolcreatedb','rolcreaterole','rolreplication','rolinherit'])assert.equal(row[name],false);
    await denied(raws[key],'SET ROLE c4g_f12_admin');
    await denied(raws[key],'SELECT * FROM public.global_user');
    await denied(raws[key],'CREATE TEMP TABLE unauthorized_bootstrap_probe(id integer)');
   });
  }

  await check('read: entity is visible; identities, sessions and directory cannot be mutated',async()=>{
   const rows=(await caps.read.query('SELECT id FROM public.organization WHERE id=$1',[config.organization.id])).rows;
   assert.deepEqual(rows,[{id:config.organization.id}]);
   for(const sql of ['SELECT * FROM public.application_session_store','SELECT * FROM public.tenant_workload_connection_version',
    'UPDATE public.global_user SET display_name=display_name','DELETE FROM public.organization','CREATE TABLE public.unauthorized_bootstrap_probe(id integer)'])await denied(caps.read,sql);
   assert.equal((await caps.read.query('SELECT c4g_production.administrator($1,$2,false) AS allowed',['missing-disposable-session',config.administrator.globalUserId])).rows[0].allowed,false);
  });

  await check('commands: closed email commands execute; arbitrary DML, retention and claim do not',async()=>{
   await rollbackProbe(caps.commands,async client=>{
    const id=randomUUID();
    await client.query('SELECT public.email_delivery_begin($1,NULL,$2,false)',[id,'permission-probe@example.invalid']);
    await client.query("SELECT public.email_delivery_finish($1,'ACCEPTED')",[id]);
    assert.equal((await client.query('SELECT public.email_organization_admin($1,$2,$3) AS allowed',['missing-disposable-session',config.administrator.globalUserId,config.organization.id])).rows[0].allowed,false);
   });
   for(const sql of ['UPDATE public.organization_membership SET membership_version=membership_version','DELETE FROM public.global_user',
    'SELECT public.email_delivery_retention()','SELECT public.billing_validation_email_claim()'])await denied(caps.commands,sql);
  });

  await check('authoring: catalog reads and administrator gate execute; collection and generic updates do not',async()=>{
   await caps.authoring.query('SELECT count(*) FROM opportunity_catalog.opportunity');
   assert.equal((await caps.authoring.query('SELECT c4g_production.active_administrator($1) AS allowed',[config.administrator.globalUserId])).rows[0].allowed,true);
   await rollbackProbe(caps.authoring,client=>client.query('INSERT INTO opportunity_catalog.opportunity SELECT * FROM opportunity_catalog.opportunity WHERE false'));
   for(const sql of ['SELECT * FROM public.application_session','SELECT * FROM public.global_user','SELECT * FROM async_exec.outbox',
    'SELECT * FROM opportunity_catalog.funding_run',"UPDATE opportunity_catalog.opportunity SET title='unauthorized'",'DELETE FROM opportunity_catalog.revision'])await denied(caps.authoring,sql);
  });

  await check('logs: support event insertion works while reading and deleting events are forbidden',async()=>{
   await rollbackProbe(caps.logs,client=>client.query("INSERT INTO public.platform_support_event(code,global_user_id) VALUES('LOGIN',$1)",[config.administrator.globalUserId]));
   await denied(caps.logs,'SELECT * FROM public.platform_support_event');
   await denied(caps.logs,'DELETE FROM public.platform_support_event');
   await denied(caps.logs,'SELECT * FROM public.global_user');
  });

  await check('retention: dedicated retention command works without access to email content',async()=>{
   await rollbackProbe(caps.retention,client=>client.query('SELECT public.email_delivery_retention()'));
   await denied(caps.retention,'SELECT * FROM public.email_delivery_history');
   await denied(caps.retention,'SELECT * FROM public.global_user');
   await denied(caps.retention,'SELECT public.email_delivery_begin($1,NULL,$2,false)',[randomUUID(),'forbidden@example.invalid']);
  });

  await check('catalog: dedicated reader admission and catalog SELECT work, writes and identities fail',async()=>{
   const client=await raws.catalog.connect();
   try{
    const admission=await require('../../../backend/src/security/catalogReaderSchema').createReaderSchemaAdmission(client);
    await require('../../../backend/src/security/catalogReaderSecurity').assertReaderSession(client,admission);
    await client.query('BEGIN');await client.query('SET LOCAL ROLE c4g_catalog_reader');
    await client.query('SELECT count(*) FROM opportunity_catalog.opportunity');
    await client.query('SELECT count(*) FROM opportunity_catalog.revision_allocation_v2');
    await client.query('ROLLBACK');
    for(const sql of ["UPDATE opportunity_catalog.opportunity SET title='unauthorized'",'SELECT * FROM public.global_user']){
     await client.query('BEGIN');await client.query('SET LOCAL ROLE c4g_catalog_reader');
     await denied(client,sql);await client.query('ROLLBACK');
    }
   }finally{await client.query('ROLLBACK').catch(()=>{});client.release();}
  });

  await check('authority: exact identity lookup works through coordinator; direct DML and arbitrary SQL fail',async()=>{
   const coordinator=require('../../../backend/src/security/authorityCoordinator').createAuthorityCoordinator({pool:raws.authority,permitSecret:credentials.permitSecret});
   const rows=(await coordinator.pool.query(require('../../../backend/src/security/identityQueries').resolveIdentity,[config.administrator.issuer,config.administrator.subject])).rows;
   assert.equal(rows.length,1);assert.equal(rows[0].id,config.administrator.globalUserId);
   await denied(raws.authority,'UPDATE public.global_user SET display_name=display_name');
   await denied(raws.authority,'SELECT * FROM public.authority_f5_state');
   await assert.rejects(coordinator.pool.query('DROP TABLE public.global_user'),/AUTHORITY_COORDINATOR_REQUIRED/);
  });

  await check('tenant API cannot connect to a second physically separate database',async()=>{
   const database='bootstrap_permission_'+randomUUID().replaceAll('-','');
   assert.match(database,/^bootstrap_permission_[a-f0-9]{32}$/);
   let created=false,candidate;
   try{
    await central.query(`CREATE DATABASE "${database}" TEMPLATE template0`);created=true;
    await central.query(`REVOKE ALL ON DATABASE "${database}" FROM PUBLIC`);
    assert.equal((await central.query("SELECT has_database_privilege($1,$2,'CONNECT') AS allowed",[config.tenant.apiLogin,database])).rows[0].allowed,false);
    candidate=new Pool(serviceOptions(config.tenant.apiLogin,credentials.tenantApi,database));
    await assert.rejects(candidate.query('SELECT current_database()'),{code:'42501'});
   }finally{
    if(candidate)await candidate.end();
    // Only the uniquely named database created by this invocation is removed.
    if(created)await central.query(`DROP DATABASE "${database}"`);
   }
  });
 }finally{await Promise.all(Object.values(raws).map(pool=>pool.end()));}
}

module.exports={run};
