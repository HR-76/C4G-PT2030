'use strict';
// Privileged worker adapter. Never construct this inside an HTTP runtime.
const {Pool}=require('pg'),{randomUUID,randomBytes,createHmac}=require('node:crypto');
const {uuid,hash,fail}=require('./contracts');
const {createTenantMigrationRunner}=require('../security/tenantMigrationRunner');
const {manifest}=require('../security/tenantMigrationManifest');
const {preflightTenant}=require('../security/tenantMigrationPreflight');
const {ensureAuditPartitionsWithPool}=require('../audit/partitionMaintenance');
const {bindingDigest}=require('../security/localTenantCredentialAdapter');
const {createLocalTenantIdentityProvisioner}=require('../security/localTenantIdentityProvisioner');
const id=value=>{if(!/^[a-z][a-z0-9_]{0,62}$/.test(value))fail('PROVISIONING_IDENTIFIER_INVALID');return '"'+value+'"';};
const binding=x=>Object.fromEntries(['operationId','organizationId','globalUserId','membershipId'].map(k=>[k,uuid(x[k])]));
function createPostgresProvisioner({adminPool,centralPool,connection,journal,ownershipKey,regionCode='EU',residencyPolicyVersion='onboarding-isolated-v1'}){
 const directory=require('../security/tenantDirectoryRepository').createTenantDirectoryRepository(centralPool),provisioning=require('../security/tenantProvisioningRepository').createTenantProvisioningRepository(centralPool),connections=require('../security/tenantConnectionRepository').createTenantConnectionRepository(centralPool),schema=require('../security/tenantSchemaRepository').createTenantSchemaRepository(centralPool),workloads=require('../security/tenantWorkloadDirectoryRepository').createTenantWorkloadDirectoryRepository(centralPool);
 const row=async(sql,values)=>(await centralPool.query(sql,values)).rows[0];
 async function reservation(x){const b=binding(x);return journal.reserve(x.operationId,{...b,input:x.input},()=>{const suffix=x.organizationId.replaceAll('-','');return {...b,tenantId:x.organizationId,generationId:randomUUID(),database:'c4g_onb_'+suffix,owner:'c4g_onb_owner_'+suffix,apiLogin:'c4g_onb_api_'+suffix,workerLogin:'c4g_onb_worker_'+suffix,apiPassword:randomBytes(32).toString('hex'),workerPassword:randomBytes(32).toString('hex')};});}
 async function locked(x,work){const r=await reservation(x),c=await adminPool.connect();try{await c.query("SET statement_timeout='45s'");await c.query('SELECT pg_advisory_lock(hashtextextended($1,0))',[x.operationId]);return await work(r,c);}finally{await c.query('SELECT pg_advisory_unlock_all()').catch(()=>{});c.release();}}
 function material(r,workload){return {tenantId:r.tenantId,credentialRef:'onboarding-'+workload.toLowerCase()+'-'+r.tenantId,connectionVersion:1,host:connection.host,port:connection.port,database:r.database,login:workload==='API'?r.apiLogin:r.workerLogin,password:workload==='API'?r.apiPassword:r.workerPassword,ssl:Boolean(connection.ssl)};}
 async function publish(r,evidence){
  const organizationId=r.organizationId,tenantId=r.tenantId,tag=step=>({correlationId:r.operationId,idempotencyKey:r.operationId+':'+step});
  if(!await row('SELECT 1 FROM public.tenant WHERE tenant_id=$1',[tenantId]))await directory.createTenant({organizationId,tenantId,...tag('tenant')});
  let p=await row('SELECT * FROM public.organization_provisioning WHERE organization_id=$1',[organizationId]);
  if(!p){await provisioning.start({organizationId,manifestVersion:manifest.at(-1).version,...tag('start')});p=await row('SELECT * FROM public.organization_provisioning WHERE organization_id=$1',[organizationId]);}
  if(!p.tenant_id){await provisioning.assignTenantOnce({organizationId,tenantId,expectedRevision:Number(p.revision),...tag('assign')});p=await row('SELECT * FROM public.organization_provisioning WHERE organization_id=$1',[organizationId]);}
  if(p.status==='QUEUED'){await provisioning.beginProvisioning({organizationId,expectedRevision:Number(p.revision),...tag('running')});p=await row('SELECT * FROM public.organization_provisioning WHERE organization_id=$1',[organizationId]);}
  const api=material(r,'API'),digest=bindingDigest({...api,workload:'API'});
  if(!await row('SELECT 1 FROM public.tenant_database_generation WHERE database_generation_id=$1',[r.generationId]))await connections.createGeneration({tenantId,databaseGenerationId:r.generationId,databaseRef:r.database,...tag('generation')});
  let v=await row('SELECT * FROM public.organization_connection_version WHERE tenant_id=$1 AND connection_version=1',[tenantId]);
  if(!v){await connections.createCandidateVersion({tenantId,databaseGenerationId:r.generationId,databaseRef:r.database,credentialRef:api.credentialRef,regionCode,residencyPolicyVersion,...tag('candidate')});v=await row('SELECT * FROM public.organization_connection_version WHERE tenant_id=$1 AND connection_version=1',[tenantId]);}
  if(v.version_state==='CANDIDATE')await connections.validateVersion({tenantId,connectionVersion:1,observedSystemIdentifier:evidence.systemIdentifier,bindingDigest:digest,...tag('validated')});
  if(p.status==='RUNNING'){await provisioning.beginVerification({organizationId,expectedRevision:Number(p.revision),...tag('verify')});p=await row('SELECT * FROM public.organization_provisioning WHERE organization_id=$1',[organizationId]);}
  const s=await row('SELECT * FROM public.tenant_schema_state WHERE tenant_id=$1',[tenantId]);
  if(s.compatibility_state==='UNKNOWN')await schema.recordObservation({tenantId,expectedRevision:Number(s.revision),compatibilityState:'COMPATIBLE',currentVersion:evidence.currentVersion,targetVersion:evidence.currentVersion,minimumReadVersion:evidence.currentVersion,minimumWriteVersion:evidence.currentVersion,verifiedCapabilities:{...Object.fromEntries(evidence.capabilities.map(c=>[c,true])),schemaFingerprint:evidence.schemaFingerprint},...tag('schema')});
  if(p.status==='VERIFYING')await provisioning.markReady({organizationId,expectedRevision:Number(p.revision),...tag('ready')});
  const c=await row('SELECT * FROM public.organization_connection WHERE tenant_id=$1',[tenantId]);if(c.operational_state==='PENDING')await connections.publishVersion({tenantId,connectionVersion:1,expectedRevision:Number(c.revision),...tag('publish')});
  for(const workload of ['API','WORKER']){
   const m=material(r,workload),w=await workloads.resolvePublished({tenantId,workload});if(w?.lifecycleStatus==='AVAILABLE')continue;
   const candidate={tenantId,workload,connectionVersion:1,credentialRef:m.credentialRef,bindingDigest:bindingDigest({...m,workload})};await workloads.createCandidate(candidate);await workloads.validateCandidate({...candidate,compatibilityStatus:'COMPATIBLE',provisioningStatus:'READY'});await workloads.publishCandidate({...candidate,expectedFence:0,expectedCurrentVersion:null});
  }
  const snapshot=await directory.resolveSnapshotByOrganization(organizationId,'API');if(snapshot?.databaseGenerationId!==r.generationId||snapshot.databaseRef!==r.database||snapshot.schema.schemaFingerprint!==evidence.schemaFingerprint)fail('PROVISIONING_DIRECTORY_MISMATCH');
 }
 return {
  async ensure(x){return locked(x,async(r,admin)=>{
   const marker='C4G_ONBOARDING:'+createHmac('sha256',ownershipKey).update(r.operationId).digest('hex');
   await admin.query('BEGIN');try{for(const role of [r.owner,r.apiLogin,r.workerLogin]){
    const prior=(await admin.query("SELECT shobj_description(oid,'pg_authid') marker FROM pg_roles WHERE rolname=$1",[role])).rows[0];
    if(prior&&prior.marker!==marker)fail('PROVISIONING_OWNERSHIP_CONFLICT');
    if(!prior){await admin.query(`CREATE ROLE ${id(role)} NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS NOREPLICATION`);await admin.query(`COMMENT ON ROLE ${id(role)} IS '${marker}'`);}
   }await admin.query('COMMIT');}catch(e){await admin.query('ROLLBACK');throw e;}
   let database=(await admin.query('SELECT pg_get_userbyid(datdba) owner FROM pg_database WHERE datname=$1',[r.database])).rows[0];
   if(!database){await admin.query(`CREATE DATABASE ${id(r.database)} OWNER ${id(r.owner)} ENCODING 'UTF8' LOCALE_PROVIDER icu ICU_LOCALE 'und' TEMPLATE template0`);database={owner:r.owner};}
   if(database.owner!==r.owner)fail('PROVISIONING_OWNERSHIP_CONFLICT');
   const pool=new Pool({...connection,database:r.database,max:2});
   try{
    await pool.query('REVOKE ALL ON SCHEMA public FROM PUBLIC');await pool.query(`REVOKE CONNECT,TEMP ON DATABASE ${id(r.database)} FROM PUBLIC`);await pool.query(`GRANT CONNECT,CREATE ON DATABASE ${id(r.database)} TO c4g_tenant_owner`);await pool.query(`GRANT CONNECT ON DATABASE ${id(r.database)} TO c4g_tenant_migrator,c4g_tenant_runtime`);
    await pool.query(`ALTER DATABASE ${id(r.database)} SET timezone TO 'UTC'`);
    await pool.query(`ALTER ROLE c4g_tenant_runtime IN DATABASE ${id(r.database)} SET search_path TO pg_catalog,c4g_app`);
    const runner=createTenantMigrationRunner({pool,observationPublisher:{async publish(){}},timeoutMs:30000,scheduler:{setTimeout,clearTimeout}});
    await runner.migrate({tenantId:r.tenantId,databaseGenerationId:r.generationId,expectedRevision:1,correlationId:r.operationId,idempotencyKey:r.operationId});
    // A new tenant only has the baseline audit partitions; create five years ahead so nobody rotates by hand.
    await ensureAuditPartitionsWithPool(pool);
    const provisioner=await createLocalTenantIdentityProvisioner(adminPool);await provisioner.reconcile({apiLogin:r.apiLogin,workerLogin:r.workerLogin,apiPassword:r.apiPassword,workerPassword:r.workerPassword,apiRoles:['c4g_opportunity_tenant_runtime'],workerRoles:['c4g_opportunity_tenant_runtime']});
    await pool.query(`GRANT CONNECT ON DATABASE ${id(r.database)} TO ${id(r.apiLogin)},${id(r.workerLogin)}`);
    const evidence=await preflightTenant(pool,{tenantId:r.tenantId,databaseGenerationId:r.generationId},manifest,{timeoutMs:15000});
    for(const workload of ['API','WORKER']){const m=material(r,workload),limited=new Pool({...connection,database:r.database,user:m.login,password:m.password,max:1});try{const result=(await limited.query('SELECT current_database() name,rolsuper,rolcreatedb,rolcreaterole,rolbypassrls FROM pg_roles WHERE rolname=session_user')).rows[0];if(result.name!==r.database||result.rolsuper||result.rolcreatedb||result.rolcreaterole||result.rolbypassrls)fail('PROVISIONING_LOGIN_INVALID');}finally{await limited.end();}}
    await publish(r,evidence);return binding(x);
   }finally{await pool.end();}
  });},
  async project(x){return locked(x,async r=>{
   const pool=new Pool({...connection,database:r.database,max:1});try{
    await preflightTenant(pool,{tenantId:r.tenantId,databaseGenerationId:r.generationId},manifest,{timeoutMs:15000});
    const c=await pool.connect();try{await c.query('BEGIN');await c.query("SELECT set_config('app.organization_id',$1,true)",[r.organizationId]);await c.query('SET LOCAL ROLE c4g_opportunity_tenant_runtime');
     const prior=(await c.query('SELECT * FROM organizational_scope.directory_receipt WHERE organization_id=$1 AND idempotency_key=$2',[r.organizationId,r.operationId])).rows[0],digest=hash(JSON.stringify({organizationId:r.organizationId,membershipId:r.membershipId,name:x.input.adminName,email:x.input.adminEmail}));
     if(prior){if(prior.intention_digest!==digest)fail('PROVISIONING_INTENT_CONFLICT');}
     else{
      await c.query('INSERT INTO organizational_scope.organization_card(organization_id,revision,updated_by) VALUES($1,1,$2)',[r.organizationId,r.globalUserId]);
      await c.query('INSERT INTO organizational_scope.person(organization_id,person_id,name,email,created_by,updated_by) VALUES($1,$2,$3,$4,$5,$5)',[r.organizationId,r.membershipId,x.input.adminName,x.input.adminEmail,r.globalUserId]);
      await c.query('INSERT INTO organizational_scope.person_profile(organization_id,person_id,membership_id,updated_by) VALUES($1,$2,$2,$3)',[r.organizationId,r.membershipId,r.globalUserId]);
      await c.query("INSERT INTO organizational_scope.directory_receipt(organization_id,idempotency_key,subject_id,operation,resource_id,intention_digest,result_projection) VALUES($1,$2,$3,'PERSON_CREATE',$4,$5,$6)",[r.organizationId,r.operationId,r.globalUserId,r.membershipId,digest,JSON.stringify({personId:r.membershipId,membershipId:r.membershipId})]);
     }
     await c.query('COMMIT');return {...binding(x),projected:true};
    }catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}
   }finally{await pool.end();}
  });},
  async apiCredentials(x){return material(await reservation(x),'API');},
  async workerCredentials(x){return material(await reservation(x),'WORKER');}
 };
}
module.exports={createPostgresProvisioner};
