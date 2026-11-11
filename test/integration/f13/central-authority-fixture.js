'use strict';
const {Pool}=require('../../../backend/node_modules/pg');
const {applyCentralMigrations,rollbackCentralMigration}=require('../../../backend/scripts/runCentralMigrations');
const {preflightCentral}=require('../../../backend/src/security/centralMigrationPreflight');
const assert=require('node:assert/strict');
const {createAuthorityCoordinator}=require('../../../backend/src/security/authorityCoordinator');
const {createAuthorityDataRepository}=require('../../../backend/src/authorization/authorityDataRepository');
const {createProductionCatalogs}=require('../../../backend/src/authorization/catalogs');
const {createPgSessionRegistry}=require('../../../backend/src/security/sessionRegistry');
const requirement=Object.freeze({maxAgeSeconds:300,mfa:true,acceptedAcr:['c4g-loa2'],acceptedAmr:['otp'],amrMode:'all'});
async function centralAuthorityFixture(adminUrl, { clock = { now: () => new Date() }, validateHistoricalRoundTrip = true } = {}) {
  const url=new URL(adminUrl),name='c4g_f13_authority_synthetic_central';
  const admin=new Pool({connectionString:url.toString(),max:2});
  let pool,authorityPool,created=false;
  try {
    for (const role of ['c4g_central_owner','c4g_central_runtime']) await admin.query(`DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='${role}') THEN CREATE ROLE ${role} NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS; END IF; END $$`);
    await admin.query(`CREATE DATABASE ${name} ENCODING 'UTF8' TEMPLATE template0`);created=true;
    url.pathname=`/${name}`;pool=new Pool({connectionString:url.toString(),max:8});
    const migrationTools=require('../../../backend/scripts/runCentralMigrations'),centralManifest=require('../../../backend/src/security/centralMigrationManifest');
    if(validateHistoricalRoundTrip){
      await pool.query("CREATE TABLE public.c4g_database_identity(product_code text NOT NULL,database_role text NOT NULL);INSERT INTO public.c4g_database_identity VALUES('C4G','CENTRAL')");
      await migrationTools.applyCentralMigrationsWithManifest(pool,Object.freeze(centralManifest.manifest.filter(entry=>entry.version<'015')),centralManifest.migrationSql);
      const before=(await pool.query('SELECT count(*)::int n FROM public.c4g_schema_migration')).rows[0].n;assert.equal(before,15);
      await rollbackCentralMigration(pool,'014');
      assert.equal((await preflightCentral(pool)).currentVersion,'013_pq1_effective_lookup');
      await rollbackCentralMigration(pool,'013');
      assert.equal((await preflightCentral(pool)).currentVersion,'012_pq1_intention_lookup');
      await rollbackCentralMigration(pool,'012');
      assert.equal((await preflightCentral(pool)).currentVersion,'011_criteria_intention_lookup');
      await rollbackCentralMigration(pool,'011');
      assert.equal((await preflightCentral(pool)).currentVersion,'010_editorial_intention_lookup');
      await rollbackCentralMigration(pool,'010');
      assert.equal((await preflightCentral(pool)).currentVersion,'009_authority_commit_guard');
      const failing={async connect(){const client=await pool.connect();return{release:error=>client.release(error),query(sql,values){
        if(sql.startsWith('DELETE FROM public.c4g_schema_migration'))throw new Error('AUTHORITY_DOWN_LEDGER_FAILURE');return client.query(sql,values);}};}};
      await assert.rejects(()=>rollbackCentralMigration(failing,'009'),/AUTHORITY_DOWN_LEDGER_FAILURE/);
      assert.equal((await pool.query("SELECT to_regclass('public.authority_commit_guard') IS NOT NULL AS present")).rows[0].present,true);
      await rollbackCentralMigration(pool,'009');
      assert.equal((await preflightCentral(pool)).currentVersion,'008_f44_tenant_workload_identity');
      assert.equal((await pool.query("SELECT count(*)::int n FROM pg_roles WHERE rolname IN('c4g_authority_coordinator','c4g_authority_runtime','c4g_authority_owner')")).rows[0].n,0);
      assert.equal((await pool.query("SELECT to_regnamespace('authority_api') IS NULL AS removed")).rows[0].removed,true);
      assert.deepEqual(await applyCentralMigrations(pool),centralManifest.manifest.slice(9).map(entry=>entry.version));
    }else{
      await admin.query("DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='c4g_f12_admin') THEN CREATE ROLE c4g_f12_admin NOLOGIN NOINHERIT; END IF; END $$; ALTER ROLE c4g_f12_admin SUPERUSER");
      const installer=await pool.connect();
      try{
        await installer.query('SET SESSION AUTHORIZATION c4g_f12_admin');
        await installer.query("CREATE TABLE public.c4g_database_identity(product_code text NOT NULL,database_role text NOT NULL);INSERT INTO public.c4g_database_identity VALUES('C4G','CENTRAL')");
        const installerPool={connect:async()=>({query:(...args)=>installer.query(...args),release(){}})};
        assert.deepEqual(await migrationTools.applyCentralMigrationsWithManifest(installerPool,centralManifest.manifest,centralManifest.migrationSql),centralManifest.manifest.map(entry=>entry.version));
      }finally{
        await installer.query('RESET SESSION AUTHORIZATION').catch(()=>{});installer.release();
        await admin.query('ALTER ROLE c4g_f12_admin NOSUPERUSER NOCREATEROLE NOCREATEDB NOLOGIN');
      }
      assert.equal((await preflightCentral(pool)).currentVersion,centralManifest.manifest.at(-1).version);
    }
    const authorityUrl=new URL(url);authorityUrl.username='c4g_authority_runtime';
    authorityUrl.password=require('crypto').randomBytes(32).toString('hex');
    await pool.query(`ALTER ROLE c4g_authority_runtime PASSWORD '${authorityUrl.password}'`);
    authorityPool=new Pool({connectionString:authorityUrl.toString(),max:8});
    const permitSecret=require('crypto').randomBytes(32).toString('hex');
    if(process.env.F13_CAPTURE_AUTHORITY_FINGERPRINT!=='1')await preflightCentral(pool);
    const observations=[];
    const clients=new WeakMap();
    const observedPool={query:(...args)=>authorityPool.query(...args),async connect(){const client=await authorityPool.connect();
      if(clients.has(client))return clients.get(client);
      const wrapper={
      on:(...args)=>client.on(...args),removeListener:(...args)=>client.removeListener(...args),
      async query(sql,values){const query=sql==='SELECT authority_api.execute($1,$2::text[],$3) AS result'
        ?require('../../../backend/src/security/authorityProtocolQueries').queries.find(q=>require('crypto').createHash('sha256').update(q).digest('hex')===values[0]):sql;
        let result;try{result=await client.query(sql,values);}catch(error){observations.push({sql:query,errorCode:error.code,constraint:error.constraint});throw error;}
        observations.push({sql:query,rowCount:result.rowCount});return result;},release:error=>client.release(error)};
      clients.set(client,wrapper);return wrapper;}};
    const coordinator=createAuthorityCoordinator({pool:observedPool,permitSecret,clock}),catalogs=createProductionCatalogs({catalogVersion:'f13'});
    const data=createAuthorityDataRepository({coordinator,catalogs,policyVersion:'c4g-assurance-v1',recentMfaRequirement:requirement});
    const registry=createPgSessionRegistry(pool,coordinator);
    const store={get(sid,callback){coordinator.pool.query('SELECT sess FROM public.application_session_store WHERE sid=$1',[sid]).then(result=>callback(null,result.rows[0]?.sess),callback);}};
    async function user(organizationId,subjectId,membershipId,validUntil=null,sessionId=null,{profileCode='ORG_ADMIN',displayName='Synthetic'}={}) {
      await pool.query(`INSERT INTO public.organization(id,legal_name,display_name,slug,type_code,status,reporting_currency,mfa_policy_code)
        VALUES($1,'Synthetic','Synthetic',$2,'RESEARCH','ACTIVE','EUR','RECENT_MFA') ON CONFLICT(id) DO NOTHING`,[organizationId,`synthetic-${organizationId}`]);
      await pool.query(`INSERT INTO public.global_user(id,display_name,primary_email,status) VALUES($1,$3,$2,'ACTIVE') ON CONFLICT(id) DO NOTHING`,[subjectId,`${subjectId}@example.invalid`,displayName]);
      await pool.query(`INSERT INTO public.organization_membership(id,global_user_id,organization_id,base_role_code,status,activated_at,valid_until)
        VALUES($1,$2,$3,$5,'ACTIVE',clock_timestamp(),$4) ON CONFLICT(id) DO NOTHING`,[membershipId,subjectId,organizationId,validUntil,profileCode]);
      const sid=sessionId||`synthetic-authority-${subjectId}`,organizationContext={organizationId,membershipId,membershipVersion:1};
      const sess={auth:{user:{id:subjectId},absoluteExpiresAt:Date.now()+3600000,revocationVersion:1,policyVersion:'c4g-assurance-v1',organizationContext,
        evidence:{authTime:Math.floor(Date.now()/1000),acr:'c4g-loa2',amr:['otp'],policyVersion:'c4g-assurance-v1'}}};
      await registry.rotateSession({sid,globalUserId:subjectId,revocationVersion:1,expiresAt:sess.auth.absoluteExpiresAt,organizationContext});
      await coordinator.write([coordinator.sessionKey(sid)],()=>coordinator.pool.query('INSERT INTO "public"."application_session_store" (sess, expire, sid) SELECT $1, to_timestamp($2), $3 ON CONFLICT (sid) DO UPDATE SET sess=$1, expire=to_timestamp($2) RETURNING sid',[sess,sess.auth.absoluteExpiresAt/1000,sid]));
      const grants=catalogs.permissionCatalog.permissions.filter(entry=>entry.code.startsWith('profile_taxonomy.')).map(entry=>({permission:entry.code,scope:{type:'ORGANIZATION',id:organizationId,organizationId}}));
      await data.change({organizationId,membershipId,expectedVersion:0,grants,assuranceRequirements:requirement});
      return {id:subjectId,membershipId,sid,request:{sessionID:sid,user:{id:subjectId},authContext:{sessionId:sid},organizationContext},grants};
    }
    return {pool,authorityPool,permitSecret,authorityConnectionString:authorityUrl.toString(),coordinator,catalogs,data,registry,store,user,requirement,observations,connectionString:url.toString(),async close({retain=false}={}){await authorityPool.end();await pool.end();if(created&&!retain){await admin.query(`DROP DATABASE ${name}`);await admin.query('DROP ROLE c4g_authority_runtime,c4g_authority_coordinator,c4g_authority_owner');}await admin.end();}};
  } catch(error) {if(authorityPool)await authorityPool.end();if(pool)await pool.end();if(created)await admin.query(`DROP DATABASE ${name}`).catch(()=>{});await admin.end();throw error;}
}
module.exports={centralAuthorityFixture};
