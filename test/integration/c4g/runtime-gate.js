'use strict';
const assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');
const {Pool}=require('../../../backend/node_modules/pg');
const express=require('../../../backend/node_modules/express');
const cors=require('../../../backend/node_modules/cors');
const signature=require('../../../backend/node_modules/cookie-signature');
const {centralAuthorityFixture}=require('../f13/central-authority-fixture');

const {createTenantPoolManager}=require('../../../backend/src/security/tenantPoolManager');
const {createTenantMigrationRunner}=require('../../../backend/src/security/tenantMigrationRunner');
const {manifest}=require('../../../backend/src/security/tenantMigrationManifest');
const {preflightTenant}=require('../../../backend/src/security/tenantMigrationPreflight');
const {TenantOpportunityRepository}=require('../../../backend/src/opportunities/tenantRepository');
const {createIdentityFactory}=require('../../../backend/src/opportunities/identity');
const {createProductionComposition}=require('../../../backend/src/productionComposition');
const {createMembershipRepository}=require('../../../backend/src/security/membershipRepository');
async function run(){
  if(process.env.F13_S2_DISPOSABLE_PROOF!=='C4G_F13_S2_DISPOSABLE_V1')throw new Error('Disposable proof required.');
  const url=new URL(process.env.F13_S2_ADMIN_URL);
  if(url.hostname!=='127.0.0.1'||['5432','5433'].includes(url.port))throw new Error('Unsafe target.');
  const assignedReviewProof=process.env.APPLICATION_ASSIGNED_REVIEW_PROOF==='1';
  const uiOrigin=assignedReviewProof?'http://localhost:5272':'http://localhost:5173';
  const admin=new Pool({connectionString:url.toString()}),tenants=[],fixtures=[];
  let central,manager,server,auditFailure=false,loseCommit=false,metadataTamper=null;
  const failures=[];
  try{
    for(const role of ['c4g_tenant_owner','c4g_tenant_migrator','c4g_tenant_runtime'])await admin.query(`CREATE ROLE ${role} NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`);
    await admin.query(`DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='c4g_import_worker_runtime') THEN CREATE ROLE c4g_import_worker_runtime NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS; END IF; END $$`);
    const importWorkerRole=(await admin.query(`SELECT rolcanlogin,rolinherit,rolsuper,rolcreatedb,rolcreaterole,rolreplication,rolbypassrls FROM pg_roles WHERE rolname='c4g_import_worker_runtime'`)).rows[0];
    assert.deepEqual(importWorkerRole,{rolcanlogin:false,rolinherit:false,rolsuper:false,rolcreatedb:false,rolcreaterole:false,rolreplication:false,rolbypassrls:false});
    await admin.query('GRANT c4g_tenant_owner TO c4g_tenant_migrator');await admin.query('GRANT c4g_tenant_migrator TO c4g_f12_admin');
    central=await centralAuthorityFixture(url.toString());
    for(let n=0;n<(assignedReviewProof?1:2);n++){
      const name=`c4g_tenant_synthetic_${n}`,org=randomUUID(),gen=randomUUID();
      await admin.query(`CREATE DATABASE ${name} ENCODING 'UTF8' LOCALE_PROVIDER icu ICU_LOCALE 'und' TEMPLATE template0`);
      const tenantUrl=new URL(url);tenantUrl.pathname=`/${name}`;
      const pool=new Pool({connectionString:tenantUrl.toString(),max:8}),db={name,org,gen,pool};tenants.push(db);
      await pool.query('REVOKE ALL ON SCHEMA public FROM PUBLIC');await pool.query(`REVOKE CONNECT,TEMP ON DATABASE ${name} FROM PUBLIC`);
      await pool.query(`GRANT CONNECT,CREATE ON DATABASE ${name} TO c4g_tenant_owner`);
      await pool.query(`GRANT CONNECT ON DATABASE ${name} TO c4g_tenant_migrator,c4g_tenant_runtime`);
      await pool.query(`ALTER ROLE c4g_tenant_runtime IN DATABASE ${name} SET search_path TO pg_catalog,c4g_app`);
      const migrationResult=await createTenantMigrationRunner({pool,entries:manifest,observationPublisher:{async publish(){}},timeoutMs:15000,scheduler:{setTimeout,clearTimeout}})
        .migrate({tenantId:org,databaseGenerationId:gen,expectedRevision:1,correlationId:'synthetic-c4g',idempotencyKey:'synthetic-c4g'});
      const apiLogin=`c4g_isolated_api_${n}`,workerLogin=`c4g_isolated_worker_${n}`,loginPassword=require('node:crypto').randomBytes(32).toString('hex');
      const provisioner=await require('../../../backend/src/security/localTenantIdentityProvisioner').createLocalTenantIdentityProvisioner(admin);
      await provisioner.reconcile({apiLogin,workerLogin,apiPassword:loginPassword,workerPassword:require('node:crypto').randomBytes(32).toString('hex'),apiRoles:['c4g_opportunity_tenant_runtime'],workerRoles:['c4g_opportunity_tenant_runtime']});
      await pool.query(`GRANT CONNECT ON DATABASE ${name} TO ${apiLogin}`);
      const apiUrl=new URL(tenantUrl);apiUrl.username=apiLogin;apiUrl.password=loginPassword;db.limitedPool=new Pool({connectionString:apiUrl.toString(),max:8});
      let evidence=migrationResult.evidence;
      if(assignedReviewProof){
        const {createRegisteredTenantMigrationRunner,createAssignedReviewMigrationRunner}=require('../../../backend/src/security/tenantMigrationRunner');
        const options={pool,observationPublisher:{async publish(){}},timeoutMs:30000,scheduler:{setTimeout,clearTimeout}};
        const input={tenantId:org,databaseGenerationId:gen,expectedRevision:1,correlationId:'synthetic-assigned-review',idempotencyKey:'synthetic-assigned-review'};
        const {PACKAGE_ID:packageId}=require('../../../backend/src/security/opportunityV2MigrationPackage');
        await createRegisteredTenantMigrationRunner({...options,packageId}).migrate(input);
        evidence=(await createAssignedReviewMigrationRunner(options).migrate(input)).evidence;
      }else if(n===0){
        const input={tenantId:org,databaseGenerationId:gen,expectedRevision:1,correlationId:'synthetic-down-import',idempotencyKey:'synthetic-down-import',targetVersion:manifest[13].version};
        const runner=createTenantMigrationRunner({pool,observationPublisher:{async publish(){}},timeoutMs:15000,scheduler:{setTimeout,clearTimeout}});
        const failedDownPool={async connect(){const client=await pool.connect();return{release:error=>client.release(error),async query(sql,values){
          if(sql.includes('DELETE FROM c4g_system.schema_migration')&&values?.[0]===manifest.at(-1).version)throw new Error('SYNTHETIC_DOWN_LEDGER_FAILURE');return client.query(sql,values);}};}};
        await assert.rejects(()=>createTenantMigrationRunner({pool:failedDownPool,observationPublisher:{async publish(){}},timeoutMs:15000,scheduler:{setTimeout,clearTimeout}}).downgrade(input));
        assert.equal((await preflightTenant(pool,{tenantId:org,databaseGenerationId:gen},manifest,{timeoutMs:10000})).schemaFingerprint,evidence.schemaFingerprint);
        assert.equal((await pool.query('SELECT max(ordinal)::int n FROM c4g_system.schema_migration')).rows[0].n,15);
        const down=await runner.downgrade(input);assert.equal(down.evidence.currentVersion,manifest[13].version);assert.equal(down.evidence.schemaFingerprint,manifest[13].schemaFingerprint);
        assert.equal((await pool.query('SELECT max(ordinal)::int n FROM c4g_system.schema_migration')).rows[0].n,14);
        const metadataDown={...input,correlationId:'synthetic-down-metadata',idempotencyKey:'synthetic-down-metadata',targetVersion:manifest[12].version};
        const metadataRunner=createTenantMigrationRunner({pool,entries:Object.freeze(manifest.slice(0,14)),observationPublisher:{async publish(){}},timeoutMs:15000,scheduler:{setTimeout,clearTimeout}});
        const downMetadata=await metadataRunner.downgrade(metadataDown);assert.equal(downMetadata.evidence.currentVersion,manifest[12].version);assert.equal(downMetadata.evidence.schemaFingerprint,manifest[12].schemaFingerprint);
        assert.equal((await pool.query('SELECT max(ordinal)::int n FROM c4g_system.schema_migration')).rows[0].n,12);
        assert.equal((await pool.query("SELECT count(*)::int n FROM pg_roles WHERE rolname IN('c4g_f4_metadata_owner','c4g_f4_metadata_executor')")).rows[0].n,0);
        const failurePool={async connect(){const client=await pool.connect();return{release:error=>client.release(error),async query(sql,values){
          if(sql.includes('INSERT INTO c4g_system.schema_migration')&&values?.[0]===manifest.at(-1).version)throw new Error('SYNTHETIC_LEDGER_FAILURE');return client.query(sql,values);}};}};
        await assert.rejects(()=>createTenantMigrationRunner({pool:failurePool,observationPublisher:{async publish(){}},timeoutMs:15000,scheduler:{setTimeout,clearTimeout}}).migrate(metadataDown));
        assert.equal((await preflightTenant(pool,{tenantId:org,databaseGenerationId:gen},Object.freeze(manifest.slice(0,13)),{timeoutMs:10000})).schemaFingerprint,manifest[12].schemaFingerprint);
        assert.equal((await runner.migrate(metadataDown)).evidence.schemaFingerprint,evidence.schemaFingerprint);
        assert.equal((await pool.query('SELECT count(*)::int n FROM c4g_system.schema_migration WHERE ordinal=13')).rows[0].n,0);
      }
      const probe=await db.limitedPool.connect();try{
        assert.equal((await probe.query('SELECT session_user AS login')).rows[0].login,apiLogin);
        await assert.rejects(()=>probe.query('SELECT tenant_id FROM c4g_system.tenant_identity'),{code:'42501'});
        await probe.query('BEGIN');const observationClient={async query(sql,values){try{return await probe.query(sql,values);}catch(error){process.stderr.write(JSON.stringify({inspectionSql:sql.slice(0,180),sqlState:error.code})+'\n');throw error;}}};
        const observed=await require('../../../backend/src/security/tenantRuntimeMetadata').observeTenantRuntimeMetadata(observationClient,{tenantId:org,databaseGenerationId:gen});
        assert.equal(observed.schemaFingerprint,evidence.schemaFingerprint);assert.equal((await probe.query('SELECT current_user AS role')).rows[0].role,apiLogin);await probe.query('ROLLBACK');
      }finally{probe.release();}
      for(const deniedSql of ['SELECT tenant_id FROM c4g_system.tenant_identity','UPDATE c4g_system.schema_migration SET ordinal=ordinal','SELECT title FROM opportunity_catalog.opportunity']){
        await assert.rejects(()=>db.limitedPool.query(deniedSql),{code:'42501'});
      }
      for(const deniedSql of ['SET ROLE c4g_f4_metadata_owner','SET ROLE c4g_tenant_migrator','CREATE ROLE synthetic_forbidden_role','CREATE TABLE public.synthetic_forbidden(id int)','ALTER FUNCTION c4g_system.runtime_metadata_v1(uuid,uuid) RENAME TO synthetic_forbidden']){
        await assert.rejects(()=>db.limitedPool.query(deniedSql),{code:'42501'});
      }
      const executorProbe=await db.limitedPool.connect();
      try{
        await executorProbe.query('BEGIN');await executorProbe.query('SET LOCAL ROLE c4g_f4_metadata_executor');
        await assert.rejects(()=>executorProbe.query('SELECT tenant_id FROM c4g_system.tenant_identity'),{code:'42501'});
        await executorProbe.query('ROLLBACK');assert.equal((await executorProbe.query('SELECT current_user AS role')).rows[0].role,apiLogin);
        await executorProbe.query('BEGIN');await executorProbe.query("SELECT set_config('app.organization_id',$1,true)",[org]);
        await assert.rejects(()=>require('../../../backend/src/security/tenantRuntimeMetadata').observeTenantRuntimeMetadata(executorProbe,{tenantId:org,databaseGenerationId:randomUUID()}));
        await executorProbe.query('ROLLBACK');assert.equal((await executorProbe.query('SELECT current_user AS role')).rows[0].role,apiLogin);
        assert.equal((await executorProbe.query("SELECT current_setting('app.organization_id',true) value")).rows[0].value,'');
      }finally{executorProbe.release();}
      assert.equal((await pool.query("SELECT has_function_privilege('public','c4g_system.runtime_metadata_v1(uuid,uuid)','EXECUTE') allowed")).rows[0].allowed,false);
      const general=await pool.connect();try{await general.query('SET ROLE c4g_tenant_runtime');await assert.rejects(()=>general.query('SELECT c4g_system.runtime_metadata_v1($1,$2)',[org,gen]),{code:'42501'});}finally{await general.query('RESET ROLE');general.release();}
      db.snapshot={organizationId:org,tenantId:org,workload:'API',deploymentMode:'DATABASE_PER_ORGANIZATION',provisioningStatus:'READY',
        connectionState:'AVAILABLE',connectionVersion:1,connectionRevision:1,versionState:'VALIDATED',databaseGenerationId:gen,databaseRef:name,credentialRef:`synthetic-api-${n}`,
        bindingDigest:require('../../../backend/src/security/localTenantCredentialAdapter').bindingDigest({tenantId:org,workload:'API',connectionVersion:1,credentialRef:`synthetic-api-${n}`,database:name,login:apiLogin}),
        observedSystemIdentifier:evidence.systemIdentifier,regionCode:'SYNTHETIC',residencyPolicyVersion:'synthetic-v1',fence:0,
        schema:{compatibilityState:'COMPATIBLE',currentVersion:evidence.currentVersion,schemaFingerprint:evidence.schemaFingerprint,revision:1,verifiedCapabilities:Object.fromEntries(evidence.capabilities.map(code=>[code,true]))}};
      db.credentials={tenantId:org,credentialRef:db.snapshot.credentialRef,connectionVersion:1,host:apiUrl.hostname,port:Number(apiUrl.port),database:name,login:apiLogin,password:loginPassword,ssl:false};
      db.preparedPool={async connect(){const client=await db.limitedPool.connect();let functional=false;return{release:error=>client.release(error),async query(sql,values){
        if(sql==='BEGIN TRANSACTION READ WRITE')functional=true;
        if(sql==='BEGIN TRANSACTION READ ONLY')functional=false;
        if(auditFailure&&sql.includes('audit.append_event_v1')&&values?.[2]?.startsWith('OPPORTUNITY_'))throw new Error('SYNTHETIC_AUDIT_FAILURE');const result=await client.query(sql,values);
        if(metadataTamper&&sql.startsWith('SELECT c4g_system.runtime_metadata_v1')){
          const record=result.rows[0].metadata;
          if(metadataTamper==='MARKER')record.marker.tenant_id=randomUUID();
          if(metadataTamper==='LEDGER')record.ledger.at(-1).checksum_sha256='0'.repeat(64);
          if(metadataTamper==='FLAGS')record.flags.v1_complete=false;
          if(metadataTamper==='FLAG_TYPE')record.flags.v1_complete='false';
        }
        if(sql==='COMMIT'&&loseCommit&&functional){loseCommit=false;throw new Error('SYNTHETIC_COMMIT_ACK_LOST');}return result;}};}};
      const repo=new TenantOpportunityRepository({pool,organizationId:org,identityFactory:createIdentityFactory()});
      db.repository=repo;
      db.seed=await repo.create({schemaVersion:1,requestId:randomUUID(),snapshot:{schemaVersion:1,title:`Synthetic private ${n}`,funderName:'Synthetic funder',
        provenanceId:randomUUID(),lifecycleState:'ACTIVE',validationState:'PENDING_REVIEW',normalizationVersion:'opportunity-normalization-v1',qualityRuleVersion:'opportunity-quality-v1',
        summary:'SYNTHETIC C4G FIXTURE',fundingAmountMin:'0',fundingAmountMax:'20.5',currencyCode:'USD'},
        provenance:{schemaVersion:1,sourceType:'ORGANIZATION_MANUAL',sourceNamespace:'SYNTHETIC_FIXTURE',observedAt:new Date().toISOString()}},
        {actor:{type:'HUMAN',reference:randomUUID()}});
    }
    const configured=require('../../../backend/src/config/opportunityRuntime').createConfiguredOpportunityRuntime({centralPool:central.pool,authorityCoordinator:central.coordinator,
      env:{OPPORTUNITY_API_CREDENTIALS_JSON:JSON.stringify(tenants.map(db=>db.credentials)),OPPORTUNITY_ALLOWED_RESIDENCY_JSON:JSON.stringify([{regionCode:'SYNTHETIC',policyVersion:'synthetic-v1'}])}});
    fixtures.push({manager:configured.poolManager});const deps=configured;
    manager=createTenantPoolManager({clock:deps.clock,scheduler:deps.scheduler,jitter:()=>0,
      poolFactory:async({tenantId})=>({connect:()=>tenants.find(db=>db.org===tenantId).preparedPool.connect(),async end(){}}),
      policy:{globalLimit:8,perTenantLimit:5,operationalReserve:1,globalQueueLimit:20,perTenantQueueLimit:10,operationalQueueReserve:1,
        acquireTimeoutMs:10000,leaseTimeoutMs:30000,idleTimeoutMs:30000,drainTimeoutMs:10000,circuitFailureThreshold:100,
        circuitResetMs:1,backoffBaseMs:1,maxBackoffMs:1}});
    const runtime={...deps,poolManager:manager,membershipRepository:createMembershipRepository(central.pool,central.coordinator),
      directoryRepository:{async resolveSnapshotByOrganization(org){return structuredClone(tenants.find(db=>db.org===org)?.snapshot||null);}},
      bindingVerifier:configured.bindingVerifier};
    const secret='synthetic-session-secret-at-least-32-characters';
    const env={AUTH_MODE:'oidc',NODE_ENV:'development',PUBLIC_APP_URL:uiOrigin,
      OIDC_ISSUER:'https://synthetic-idp.example.invalid',OIDC_REDIRECT_URI:uiOrigin+'/api/auth/oidc/callback',OIDC_CLIENT_ID:'synthetic',
      SESSION_SECRET:secret,SESSION_IDLE_MS:'1800000',SESSION_ABSOLUTE_MS:'28800000',OIDC_TRANSACTION_MS:'600000',
      AUTH_POLICY_VERSION:'c4g-assurance-v1',AUTH_ASSURANCE_POLICY_JSON:JSON.stringify({'recent-mfa':central.requirement}),
      AUTHORITY_COMMIT_PERMIT_SECRET:central.permitSecret};
    const composition=createProductionComposition({env,dependencies:{express,cors,
      centralPool:central.pool,authorityPool:central.authorityPool,routes:{},opportunityRuntimeDependencies:runtime,
      opportunityFailureObserver:error=>failures.push({code:error.code,internalCode:error.internalCode,message:error.message,stack:error.stack}),
      applicationFailureObserver:assignedReviewProof?error=>failures.push({code:error.code,internalCode:error.internalCode,message:error.message,stack:error.stack}):undefined}});
    server=composition.app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
    const base=`http://127.0.0.1:${server.address().port}`;
    async function actor(org,grants=['opportunity.read','opportunity.private.update'],profile){
      const user=await central.user(org,randomUUID(),randomUUID(),null,null,profile);
      await central.data.change({organizationId:org,membershipId:user.membershipId,expectedVersion:1,
        grants:grants.map(permission=>({permission,scope:{type:'ORGANIZATION',id:org,organizationId:org}})),assuranceRequirements:central.requirement});
      const stored=(await central.coordinator.pool.query('SELECT sess FROM public.application_session_store WHERE sid=$1',[user.sid])).rows[0].sess;
      stored.auth.identity={providerCode:'SYNTHETIC',subject:user.id};stored.cookie={originalMaxAge:1800000,expires:new Date(Date.now()+1800000).toISOString(),httpOnly:true,path:'/',sameSite:'lax'};
      await central.coordinator.write([central.coordinator.sessionKey(user.sid)],()=>central.coordinator.pool.query('INSERT INTO "public"."application_session_store" (sess, expire, sid) SELECT $1, to_timestamp($2), $3 ON CONFLICT (sid) DO UPDATE SET sess=$1, expire=to_timestamp($2) RETURNING sid',[stored,stored.auth.absoluteExpiresAt/1000,user.sid]));
      user.cookie=`c4g_session_dev=${encodeURIComponent('s:'+signature.sign(user.sid,secret))}`;return user;
    }
    async function http(user,path,method='GET',body){
      const headers={Cookie:user?.cookie||'',Origin:uiOrigin};
      if(method!=='GET'){
        const csrf=await fetch(`${base}/api/auth/csrf`,{headers});const value=await csrf.json();headers['X-CSRF-Token']=value.csrfToken;headers['Content-Type']='application/json';
      }
      const response=await fetch(base+path,{method,headers,...(body?{body:JSON.stringify(body)}:{})});
      if(response.headers.get('set-cookie'))user.cookie=response.headers.get('set-cookie').split(';')[0];
      const data=await response.json();return{status:response.status,data};
    }
    if(assignedReviewProof){
      await require('../applications/assigned-review-flow').run({base,uiOrigin,tenant:tenants[0],actor,http,failures});
      return;
    }
    const [a,b]=tenants,userA=await actor(a.org),userB=await actor(b.org),reader=await actor(a.org,['opportunity.read']),writer=await actor(a.org,['opportunity.private.update']);
    let result=await http(userA,'/api/auth/session');assert.equal(result.status,200);assert.equal(result.data.organization.id,a.org);
    assert.equal((await http(userA,'/api/auth/organizations')).data.organizations.length,1);
    assert.equal((await http(userA,'/api/auth/organization','POST',{organizationId:b.org})).status,403);
    assert.equal((await http(userA,'/api/auth/organization','POST',{organizationId:a.org})).status,200);
    result=await http(userA,'/api/opportunities');assert.equal(result.status,200,JSON.stringify({result,failures}));assert.equal(result.data.items.length,1);assert.equal(result.data.items[0].opportunityId,a.seed.opportunityId);
    assert.equal((await http(userB,`/api/opportunities/${a.seed.opportunityId}`)).status,404);
    assert.equal((await http(reader,`/api/opportunities/${a.seed.opportunityId}`)).data.permissions.edit,false);
    const command={requestId:randomUUID(),expectedRowVersion:1,changes:{title:'Synthetic edited',fundingAmountMax:'21.5'}};
    assert.equal((await http(reader,`/api/opportunities/${a.seed.opportunityId}`,'PUT',command)).status,404);
    assert.equal((await http(writer,'/api/opportunities')).status,404);
    for(const key of ['organizationId','tenantId','actor','membershipId','correlationId','assurance']){
      assert.equal((await http(userA,`/api/opportunities?${key}=${a.org}`)).status,400);
      assert.equal((await http(userA,`/api/opportunities/${a.seed.opportunityId}`,'PUT',{...command,[key]:a.org})).status,400);
    }
    result=await http(userA,`/api/opportunities/${a.seed.opportunityId}`,'PUT',command);assert.equal(result.status,200,JSON.stringify(result));assert.equal(result.data.rowVersion,2);
    result=await http(userA,`/api/opportunities/${a.seed.opportunityId}`);assert.equal(result.data.snapshot.title,'Synthetic edited');assert.equal(result.data.snapshot.fundingAmountMax,'21.5');assert.equal(result.data.rowVersion,2);
    assert.equal((await http(userA,`/api/opportunities/${a.seed.opportunityId}`,'PUT',command)).status,200);
    assert.equal((await http(userA,`/api/opportunities/${a.seed.opportunityId}`,'PUT',{...command,changes:{title:'Different intention'}})).status,409);
    assert.equal((await http(userA,`/api/opportunities/${a.seed.opportunityId}`,'PUT',{...command,requestId:randomUUID()})).status,409);
    assert.equal((await a.pool.query("SELECT count(*)::int n FROM audit.event WHERE event_code='OPPORTUNITY_REVISION_CREATED'")).rows[0].n,1);
    assert.equal((await b.pool.query('SELECT row_version::int AS row_version FROM opportunity_catalog.opportunity')).rows[0].row_version,1);
    const failing={requestId:randomUUID(),expectedRowVersion:2,changes:{summary:'SYNTHETIC rollback'}};
    auditFailure=true;assert.equal((await http(userA,`/api/opportunities/${a.seed.opportunityId}`,'PUT',failing)).status,503);auditFailure=false;
    assert.equal((await a.pool.query('SELECT row_version::int AS row_version FROM opportunity_catalog.opportunity')).rows[0].row_version,2);
    assert.equal((await a.pool.query('SELECT count(*)::int n FROM opportunity_catalog.idempotency_record WHERE request_id=$1',[failing.requestId])).rows[0].n,0);
    loseCommit=true;const uncertain={...failing,requestId:randomUUID()};result=await http(userA,`/api/opportunities/${a.seed.opportunityId}`,'PUT',uncertain);
    assert.equal(result.status,200,JSON.stringify(result));assert.equal(result.data.rowVersion,3);
    assert.equal((await a.pool.query("SELECT count(*)::int n FROM audit.event WHERE event_code='OPPORTUNITY_REVISION_CREATED'")).rows[0].n,2);
    const browserUser=await actor(a.org),otherMembership=randomUUID();
    await central.pool.query(`INSERT INTO public.organization_membership(id,global_user_id,organization_id,base_role_code,status,activated_at)
      VALUES($1,$2,$3,'ORG_ADMIN','ACTIVE',clock_timestamp())`,[otherMembership,browserUser.id,b.org]);
    await central.data.change({organizationId:b.org,membershipId:otherMembership,expectedVersion:0,
      grants:['opportunity.read','opportunity.private.update'].map(permission=>({permission,scope:{type:'ORGANIZATION',id:b.org,organizationId:b.org}})),
      assuranceRequirements:central.requirement});
    const globalSession=(await central.coordinator.pool.query('SELECT sess FROM public.application_session_store WHERE sid=$1',[browserUser.sid])).rows[0].sess;
    globalSession.auth.organizationContext=null;
    await central.registry.rotateSession({sid:browserUser.sid,globalUserId:browserUser.id,revocationVersion:1,expiresAt:globalSession.auth.absoluteExpiresAt});
    await central.coordinator.write([central.coordinator.sessionKey(browserUser.sid)],()=>central.coordinator.pool.query('INSERT INTO "public"."application_session_store" (sess, expire, sid) SELECT $1, to_timestamp($2), $3 ON CONFLICT (sid) DO UPDATE SET sess=$1, expire=to_timestamp($2) RETURNING sid',[globalSession,globalSession.auth.absoluteExpiresAt/1000,browserUser.sid]));
    assert.equal((await http(browserUser,'/api/opportunities')).status,409);
    let browserProof;
    try { browserProof=await require('./browser-flow').browserFlow({base,cookie:browserUser.cookie,organizationA:a.org,organizationB:b.org,
      title:'Synthetic edited',newTitle:'Synthetic browser edit',expectedRevision:4}); }
    catch(error){throw new Error(`SYNTHETIC_BROWSER_AUTH: ${JSON.stringify(failures.slice(-3))}`,{cause:error});}
    assert.equal((await a.pool.query('SELECT title,row_version::int AS row_version FROM opportunity_catalog.opportunity')).rows[0].row_version,4);
    const secondRacer=await actor(a.org);
    const racers=await Promise.all([1,2].map(n=>http(n===1?userA:secondRacer,`/api/opportunities/${a.seed.opportunityId}`,'PUT',
      {requestId:randomUUID(),expectedRowVersion:4,changes:{summary:`Synthetic concurrent ${n}`}})));
    assert.deepEqual(racers.map(r=>r.status).sort(),[200,409]);
    assert.equal((await a.pool.query('SELECT row_version::int AS row_version FROM opportunity_catalog.opportunity')).rows[0].row_version,5);
    assert.equal((await a.pool.query("SELECT count(*)::int n FROM audit.event WHERE event_code='OPPORTUNITY_REVISION_CREATED'")).rows[0].n,4);
    const driftCases=[
      ...['c4g_f4_metadata_owner','c4g_f4_metadata_executor'].flatMap(role=>
        ['CREATE','TEMP','CONNECT'].flatMap(privilege=>[false,true].map(grantOption=>[
          `GRANT ${privilege} ON DATABASE ${a.name} TO ${role}${grantOption?' WITH GRANT OPTION':''}`,
          `REVOKE ${privilege} ON DATABASE ${a.name} FROM ${role}`]))),
      ...['CREATE','TEMP','CONNECT'].map(privilege=>[
        `GRANT ${privilege} ON DATABASE ${a.name} TO PUBLIC`,
        `REVOKE ${privilege} ON DATABASE ${a.name} FROM PUBLIC`]),
      ['GRANT EXECUTE ON FUNCTION c4g_system.runtime_metadata_v1(uuid,uuid) TO PUBLIC','REVOKE EXECUTE ON FUNCTION c4g_system.runtime_metadata_v1(uuid,uuid) FROM PUBLIC'],
      ['GRANT EXECUTE ON FUNCTION c4g_system.runtime_metadata_v1(uuid,uuid) TO c4g_tenant_runtime','REVOKE EXECUTE ON FUNCTION c4g_system.runtime_metadata_v1(uuid,uuid) FROM c4g_tenant_runtime'],
      ['GRANT EXECUTE ON FUNCTION c4g_system.runtime_metadata_v1(uuid,uuid) TO c4g_document_runtime','REVOKE EXECUTE ON FUNCTION c4g_system.runtime_metadata_v1(uuid,uuid) FROM c4g_document_runtime'],
      ['GRANT SELECT ON c4g_system.tenant_identity TO c4g_f4_metadata_executor','REVOKE SELECT ON c4g_system.tenant_identity FROM c4g_f4_metadata_executor'],
      ['GRANT INSERT ON c4g_system.schema_migration TO c4g_f4_metadata_executor','REVOKE INSERT ON c4g_system.schema_migration FROM c4g_f4_metadata_executor'],
      ['GRANT CREATE ON SCHEMA c4g_system TO c4g_f4_metadata_executor','REVOKE CREATE ON SCHEMA c4g_system FROM c4g_f4_metadata_executor'],
      ['ALTER ROLE c4g_f4_metadata_owner LOGIN','ALTER ROLE c4g_f4_metadata_owner NOLOGIN'],
      ['ALTER ROLE c4g_f4_metadata_executor BYPASSRLS','ALTER ROLE c4g_f4_metadata_executor NOBYPASSRLS'],
      ['ALTER ROLE c4g_tenant_api_capabilities CREATEROLE','ALTER ROLE c4g_tenant_api_capabilities NOCREATEROLE'],
      ['GRANT c4g_document_runtime TO c4g_tenant_api_capabilities WITH SET TRUE, INHERIT FALSE, ADMIN FALSE','REVOKE c4g_document_runtime FROM c4g_tenant_api_capabilities'],
      ['GRANT c4g_f4_metadata_executor TO c4g_tenant_runtime WITH SET TRUE, INHERIT FALSE, ADMIN FALSE','REVOKE c4g_f4_metadata_executor FROM c4g_tenant_runtime'],
      ['ALTER FUNCTION c4g_system.runtime_metadata_v1(uuid,uuid) SET search_path=pg_catalog,public','ALTER FUNCTION c4g_system.runtime_metadata_v1(uuid,uuid) SET search_path=pg_catalog'],
      ['ALTER FUNCTION c4g_system.runtime_metadata_v1(uuid,uuid) OWNER TO c4g_tenant_owner','GRANT CREATE ON SCHEMA c4g_system TO c4g_f4_metadata_owner; ALTER FUNCTION c4g_system.runtime_metadata_v1(uuid,uuid) OWNER TO c4g_f4_metadata_owner; REVOKE CREATE ON SCHEMA c4g_system FROM c4g_f4_metadata_owner'],
      ['GRANT SELECT(state) ON async_exec.outbox TO c4g_f4_metadata_executor','REVOKE SELECT(state) ON async_exec.outbox FROM c4g_f4_metadata_executor']
    ];
    async function refusedAdmission(){
      const request={requestId:randomUUID(),expectedRowVersion:5,changes:{summary:'Synthetic drift refusal'}};
      const before=(await a.pool.query('SELECT count(*)::int n FROM audit.event')).rows[0].n;
      assert.equal((await http(userA,`/api/opportunities/${a.seed.opportunityId}`,'PUT',request)).status,503);
      assert.equal((await a.pool.query('SELECT count(*)::int n FROM audit.event')).rows[0].n,before);
      assert.equal((await a.pool.query('SELECT count(*)::int n FROM opportunity_catalog.idempotency_record WHERE request_id=$1',[request.requestId])).rows[0].n,0);
      assert.equal((await a.pool.query('SELECT row_version::int n FROM opportunity_catalog.opportunity')).rows[0].n,5);
    }
    for(const [change,restore] of driftCases){await a.pool.query(change);try{
      if(change.includes(' ON DATABASE ')){
        const {tenantSchemaSnapshot,tenantSchemaFingerprint}=require('../../../backend/src/security/tenantSchemaFingerprint');
        assert.notEqual(tenantSchemaFingerprint(await tenantSchemaSnapshot(a.pool)),manifest.at(-1).schemaFingerprint);
      }
      await refusedAdmission();
    }finally{await a.pool.query(restore);}}
    for(const [change,restore] of [
      [`GRANT SELECT ON c4g_system.tenant_identity TO ${a.credentials.login}`,`REVOKE SELECT ON c4g_system.tenant_identity FROM ${a.credentials.login}`],
      [`GRANT INSERT ON opportunity_catalog.opportunity TO ${a.credentials.login}`,`REVOKE INSERT ON opportunity_catalog.opportunity FROM ${a.credentials.login}`]
    ]){await a.pool.query(change);try{await refusedAdmission();}finally{await a.pool.query(restore);}}
    for(const tamper of ['MARKER','LEDGER','FLAGS','FLAG_TYPE']){metadataTamper=tamper;try{await refusedAdmission();}finally{metadataTamper=null;}}
    await a.pool.query(`GRANT c4g_tenant_api_capabilities TO ${a.credentials.login} WITH SET TRUE, INHERIT FALSE, ADMIN TRUE`);
    try{await refusedAdmission();}finally{await a.pool.query(`GRANT c4g_tenant_api_capabilities TO ${a.credentials.login} WITH SET TRUE, INHERIT FALSE, ADMIN FALSE`);}
    const generation=a.snapshot.databaseGenerationId;a.snapshot.databaseGenerationId=randomUUID();try{await refusedAdmission();}finally{a.snapshot.databaseGenerationId=generation;}
    const originalPool=a.preparedPool;a.preparedPool=b.preparedPool;try{await refusedAdmission();}finally{a.preparedPool=originalPool;}
    assert.equal((await http(userA,`/api/opportunities/${a.seed.opportunityId}`)).status,200);
    await central.data.change({organizationId:a.org,membershipId:userA.membershipId,expectedVersion:2,grants:[],assuranceRequirements:central.requirement});
    assert.equal((await http(userA,`/api/opportunities/${a.seed.opportunityId}`,'PUT',uncertain)).status,404);
    await createMembershipRepository(central.pool,central.coordinator).changeStatus({membershipId:reader.membershipId,status:'SUSPENDED'});
    assert.equal((await http(reader,'/api/opportunities')).status,409);
    assert.equal((await http(null,'/api/opportunities')).status,401);
    const blindWriter=await actor(b.org,['opportunity.private.update']),noGrants=await actor(b.org,[]);
    const blind={requestId:randomUUID(),expectedRowVersion:1,changes:{title:'Synthetic blind edit'}};
    assert.equal((await http(blindWriter,`/api/opportunities/${b.seed.opportunityId}`)).status,404);
    const receipt=await http(blindWriter,`/api/opportunities/${b.seed.opportunityId}`,'PUT',blind);
    assert.equal(receipt.status,200);assert.deepEqual(Object.keys(receipt.data).sort(),['opportunityId','revisionId','revisionNumber','rowVersion']);
    assert.deepEqual((await http(blindWriter,`/api/opportunities/${b.seed.opportunityId}`,'PUT',blind)).data,receipt.data);
    const invalid={requestId:randomUUID(),expectedRowVersion:2,changes:{title:''}};
    for(const target of [b.seed.opportunityId,randomUUID()]){
      assert.equal((await http(noGrants,`/api/opportunities/${target}`,'PUT',invalid)).status,404);
    }
    const beforeInvalid=(await b.pool.query("SELECT count(*)::int n FROM audit.event WHERE event_code='OPPORTUNITY_REVISION_CREATED'")).rows[0].n;
    assert.equal((await http(blindWriter,`/api/opportunities/${b.seed.opportunityId}`,'PUT',invalid)).status,400);
    assert.equal((await b.pool.query("SELECT count(*)::int n FROM audit.event WHERE event_code='OPPORTUNITY_REVISION_CREATED'")).rows[0].n,beforeInvalid);
    assert.equal((await b.pool.query('SELECT count(*)::int n FROM opportunity_catalog.idempotency_record WHERE request_id=$1',[invalid.requestId])).rows[0].n,0);
    await central.data.change({organizationId:b.org,membershipId:userB.membershipId,expectedVersion:2,
      grants:[{permission:'opportunity.private.update',scope:{type:'ORGANIZATION',id:b.org,organizationId:b.org}}],assuranceRequirements:central.requirement});
    const noReadReplay=await http(userB,`/api/opportunities/${b.seed.opportunityId}`,'PUT',blind);
    assert.equal(noReadReplay.status,200);assert.deepEqual(noReadReplay.data,receipt.data);
    assert.equal((await http(userB,`/api/opportunities/${b.seed.opportunityId}`)).status,404);
    await central.data.change({organizationId:b.org,membershipId:userB.membershipId,expectedVersion:3,
      grants:['opportunity.read','opportunity.private.update'].map(permission=>({permission,scope:{type:'ORGANIZATION',id:b.org,organizationId:b.org}})),assuranceRequirements:central.requirement});
    const cursorBase=(await b.pool.query('SELECT snapshot FROM opportunity_catalog.revision WHERE revision_id=$1',[b.seed.revisionId])).rows[0].snapshot;
    const cursorSeed=await b.repository.create({schemaVersion:1,requestId:randomUUID(),snapshot:{...cursorBase,title:'Synthetic cursor fixture',provenanceId:randomUUID()},
      provenance:{schemaVersion:1,sourceType:'ORGANIZATION_MANUAL',sourceNamespace:'SYNTHETIC_FIXTURE',observedAt:new Date().toISOString()}},
      {actor:{type:'HUMAN',reference:randomUUID()}});
    const firstPage=await http(userB,'/api/opportunities?pageSize=1');assert.equal(firstPage.status,200);assert.ok(firstPage.data.nextCursor);
    const secondPage=await http(userB,`/api/opportunities?pageSize=1&cursor=${encodeURIComponent(firstPage.data.nextCursor)}`);
    assert.equal(secondPage.status,200);assert.equal(secondPage.data.nextCursor,null);
    assert.deepEqual(new Set([...firstPage.data.items,...secondPage.data.items].map(item=>item.opportunityId)),new Set([b.seed.opportunityId,cursorSeed.opportunityId]));
    assert.equal((await http(userB,`/api/opportunities?pageSize=1&funderName=Other&cursor=${encodeURIComponent(firstPage.data.nextCursor)}`)).status,400);
    // Stage 2: actual HTTP writes, not administrative repository seeding.
    const functionalGrants=['opportunity.read','opportunity.private.create','opportunity.private.update','opportunity.archive'];
    const creator=await actor(a.org,functionalGrants),independent=await actor(a.org,functionalGrants),tenantB=await actor(b.org,functionalGrants);
    const readOnly=await actor(a.org,['opportunity.read']),createOnly=await actor(a.org,['opportunity.private.create']),archiveOnly=await actor(a.org,['opportunity.archive']);
    const createBody={requestId:randomUUID(),fields:{title:'Synthetic stage2 created',funderName:'Synthetic funder',summary:'Synthetic stage2 content'}};
    assert.equal((await http(readOnly,'/api/opportunities','POST',createBody)).status,404);
    for(const key of ['organizationId','tenantId','actor','membershipId','correlationId','assurance']){
      assert.equal((await http(creator,'/api/opportunities','POST',{...createBody,[key]:a.org})).status,400);
      assert.equal((await http(creator,'/api/opportunities','POST',{...createBody,fields:{...createBody.fields,[key]:a.org}})).status,400);
    }
    const concurrentCreated=await Promise.all([http(creator,'/api/opportunities','POST',createBody),http(independent,'/api/opportunities','POST',createBody)]);
    assert.deepEqual(concurrentCreated.map(value=>value.status),[201,201],JSON.stringify(concurrentCreated));
    const created=concurrentCreated[0].data;assert.deepEqual(concurrentCreated[1].data,created);
    assert.deepEqual(Object.keys(created).sort(),['opportunityId','revisionId','revisionNumber','rowVersion']);
    const createdPath=`/api/opportunities/${created.opportunityId}`;
    assert.equal((await http(creator,'/api/opportunities','POST',{...createBody,fields:{...createBody.fields,summary:'Different intention'}})).status,409);
    assert.equal((await http(tenantB,createdPath)).status,404);
    assert.ok(!(await http(tenantB,'/api/opportunities')).data.items.some(row=>row.opportunityId===created.opportunityId));
    assert.equal((await http(creator,createdPath)).data.snapshot.title,createBody.fields.title);
    assert.ok((await http(creator,'/api/opportunities')).data.items.some(row=>row.opportunityId===created.opportunityId));
    const blinded={...createBody,requestId:randomUUID(),fields:{...createBody.fields,title:'Synthetic no READ create'}};
    const blindCreated=await http(createOnly,'/api/opportunities','POST',blinded);assert.equal(blindCreated.status,201);
    assert.equal((await http(createOnly,`/api/opportunities/${blindCreated.data.opportunityId}`)).status,404);
    assert.deepEqual((await http(createOnly,'/api/opportunities','POST',blinded)).data,blindCreated.data);
    await central.data.change({organizationId:a.org,membershipId:createOnly.membershipId,expectedVersion:2,grants:[],assuranceRequirements:central.requirement});
    assert.equal((await http(createOnly,'/api/opportunities','POST',blinded)).status,404);
    const createRollback={...createBody,requestId:randomUUID()};auditFailure=true;
    assert.equal((await http(creator,'/api/opportunities','POST',createRollback)).status,503);auditFailure=false;
    assert.equal((await a.pool.query('SELECT count(*)::int n FROM opportunity_catalog.idempotency_record WHERE request_id=$1',[createRollback.requestId])).rows[0].n,0);
    assert.equal((await a.pool.query('SELECT count(*)::int n FROM opportunity_catalog.provenance WHERE provenance_id=$1',[createRollback.requestId])).rows[0].n,0);
    loseCommit=true;const createUncertain={...createBody,requestId:randomUUID(),fields:{...createBody.fields,title:'Synthetic uncertain create'}};
    const recoveredCreate=await http(creator,'/api/opportunities','POST',createUncertain);assert.equal(recoveredCreate.status,201,JSON.stringify(recoveredCreate));
    assert.deepEqual((await http(creator,'/api/opportunities','POST',createUncertain)).data,recoveredCreate.data);
    const updated=await http(creator,createdPath,'PUT',{requestId:randomUUID(),expectedRowVersion:1,changes:{summary:'Synthetic stage2 edited'}});assert.equal(updated.status,200);
    assert.equal((await http(creator,createdPath)).data.snapshot.summary,'Synthetic stage2 edited');
    const archiveBody={requestId:randomUUID(),expectedRowVersion:2};
    assert.equal((await http(readOnly,`${createdPath}/archive`,'POST',archiveBody)).status,404);
    assert.equal((await http(createOnly,`${createdPath}/archive`,'POST',archiveBody)).status,404);
    assert.equal((await http(tenantB,`${createdPath}/archive`,'POST',archiveBody)).status,404);
    for(const key of ['organizationId','tenantId','actor','membershipId','correlationId','assurance'])assert.equal((await http(creator,`${createdPath}/archive`,'POST',{...archiveBody,[key]:a.org})).status,400);
    assert.equal((await http(creator,`${createdPath}/archive`,'POST',{...archiveBody,requestId:randomUUID(),expectedRowVersion:1})).status,409);
    auditFailure=true;assert.equal((await http(creator,`${createdPath}/archive`,'POST',archiveBody)).status,503);auditFailure=false;
    assert.equal((await http(creator,createdPath)).data.rowVersion,2);
    assert.equal((await a.pool.query('SELECT count(*)::int n FROM opportunity_catalog.idempotency_record WHERE request_id=$1',[archiveBody.requestId])).rows[0].n,0);
    loseCommit=true;const archived=await http(archiveOnly,`${createdPath}/archive`,'POST',archiveBody);assert.equal(archived.status,200,JSON.stringify(archived));
    assert.equal(archived.data.rowVersion,3);assert.deepEqual(Object.keys(archived.data).sort(),['opportunityId','revisionId','revisionNumber','rowVersion']);
    assert.deepEqual((await http(archiveOnly,`${createdPath}/archive`,'POST',archiveBody)).data,archived.data);
    assert.equal((await http(archiveOnly,createdPath)).status,404);
    await central.data.change({organizationId:a.org,membershipId:archiveOnly.membershipId,expectedVersion:2,grants:[],assuranceRequirements:central.requirement});
    assert.equal((await http(archiveOnly,`${createdPath}/archive`,'POST',archiveBody)).status,404);
    const historical=await http(creator,createdPath);assert.equal(historical.status,200);assert.equal(historical.data.lifecycleState,'ARCHIVED');
    assert.deepEqual(historical.data.permissions,{edit:false,archive:false});
    assert.ok(!(await http(creator,'/api/opportunities')).data.items.some(row=>row.opportunityId===created.opportunityId));
    assert.ok((await http(creator,'/api/opportunities?lifecycleState=ARCHIVED')).data.items.some(row=>row.opportunityId===created.opportunityId));
    assert.equal((await http(creator,`${createdPath}/archive`,'POST',{...archiveBody,requestId:randomUUID(),expectedRowVersion:3})).status,409);
    assert.equal((await http(creator,createdPath,'DELETE')).status,405);
    assert.equal((await a.pool.query('SELECT count(*)::int n FROM opportunity_catalog.opportunity WHERE opportunity_id=$1',[created.opportunityId])).rows[0].n,1);
    assert.equal((await a.pool.query("SELECT count(*)::int n FROM audit.event WHERE event_code='OPPORTUNITY_CREATED' AND event_data->'resource'->>'id'=$1",[created.opportunityId])).rows[0].n,1);
    assert.equal((await a.pool.query("SELECT count(*)::int n FROM audit.event WHERE event_code='OPPORTUNITY_ARCHIVED' AND event_data->'resource'->>'id'=$1",[created.opportunityId])).rows[0].n,1);
    const revokedCreator=await actor(a.org,functionalGrants);
    await createMembershipRepository(central.pool,central.coordinator).changeStatus({membershipId:revokedCreator.membershipId,status:'REMOVED'});
    assert.equal((await http(revokedCreator,'/api/opportunities','POST',{...createBody,requestId:randomUUID()})).status,409);
    assert.equal((await http(revokedCreator,`/api/opportunities/${recoveredCreate.data.opportunityId}/archive`,'POST',{requestId:randomUUID(),expectedRowVersion:1})).status,409);
    // Ineligible organization is a synthetic initial fixture, not a bypass of authority writes.
    const inactiveOrganization=randomUUID();
    await central.pool.query("INSERT INTO public.organization(id,legal_name,display_name,slug,type_code,status,reporting_currency,mfa_policy_code) VALUES($1,'Synthetic inactive','Synthetic inactive',$2,'RESEARCH','SUSPENDED','USD','RECENT_MFA')",[inactiveOrganization,`synthetic-inactive-${inactiveOrganization}`]);
    await assert.rejects(()=>actor(inactiveOrganization,functionalGrants),/Organization context is no longer eligible/);
    await central.pool.query("INSERT INTO public.organization_membership(id,global_user_id,organization_id,base_role_code,status,activated_at) VALUES($1,$2,$3,'ORG_ADMIN','ACTIVE',clock_timestamp())",[randomUUID(),creator.id,inactiveOrganization]);
    assert.equal((await http(creator,'/api/auth/organization','POST',{organizationId:inactiveOrganization})).status,403);
    assert.ok(!(await http(creator,'/api/auth/organizations')).data.organizations.some(row=>row.id===inactiveOrganization));
    // Fresh global session for the new browser flow, with independently granted B membership.
    const stageBrowser=await actor(a.org,functionalGrants),stageMembership=randomUUID();
    await central.pool.query("INSERT INTO public.organization_membership(id,global_user_id,organization_id,base_role_code,status,activated_at) VALUES($1,$2,$3,'ORG_ADMIN','ACTIVE',clock_timestamp())",[stageMembership,stageBrowser.id,b.org]);
    await central.data.change({organizationId:b.org,membershipId:stageMembership,expectedVersion:0,grants:functionalGrants.map(permission=>({permission,scope:{type:'ORGANIZATION',id:b.org,organizationId:b.org}})),assuranceRequirements:central.requirement});
    const stageBrowserProof=await require('./browser-flow').browserCreationFlow({base,cookie:stageBrowser.cookie,organizationA:a.org,organizationB:b.org,otherCookie:tenantB.cookie});
    process.stdout.write(JSON.stringify({result:'PASS',synthetic:true,realCentral:true,tenants:2,http:true,organizationSelection:true,
      listDetailEditReread:true,CAS:true,idempotency:true,asymmetricGrants:true,isolation:true,authorityInjectionRejected:true,
      F7Rollback:true,commitUncertainReconciled:true,revocation:true,cursor:true,
      limitedTenantInspection:'PASS',limitedTenantAdmission:'PASS',administrativePreparationFixture:false,metadataDriftCases:driftCases.length,
      canonical012To014To015To012To014To015:true,reservation013:true,partialLedgerFailureRollback:true,partialDownRollback:true,roleContextRestoration:true,
      metadataAdulterationCases:4,loginAdminOptionDriftDenied:true,directApiAclDriftDenied:true,concurrentCAS:true,browserProof,
      createArchive:true,createConcurrentReplay:true,archiveCAS:true,createArchiveF7Rollback:true,createArchiveCommitUncertain:true,archivedRead:true,noHardDelete:true,stageBrowserProof})+'\n');
  }finally{
    if(server)await new Promise(resolve=>server.close(resolve));
    if(manager)await manager.closeAll();for(const fixture of fixtures)await fixture.manager.closeAll();
    if(central)await central.close();
    for(const db of tenants){if(db.limitedPool)await db.limitedPool.end();await db.pool.end();await admin.query(`DROP DATABASE ${db.name}`);}
    await admin.end();
  }
}
run().catch(error=>{process.stderr.write(`${error.stack}\n`);process.exitCode=1;});
