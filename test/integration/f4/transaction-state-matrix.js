const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const {Pool,config,seedOrganization,withDatabase}=require('./matrix-support');
const {createTenantDirectoryRepository}=require('../../../backend/src/security/tenantDirectoryRepository');
const {createTenantProvisioningRepository}=require('../../../backend/src/security/tenantProvisioningRepository');
const {createTenantConnectionRepository}=require('../../../backend/src/security/tenantConnectionRepository');
const {createTenantSchemaRepository}=require('../../../backend/src/security/tenantSchemaRepository');
const {createTenantHealthRepository}=require('../../../backend/src/security/tenantHealthRepository');
const {intentDigest}=require('../../../backend/src/security/tenantRepositorySupport');

const suffix=`${process.pid}_${crypto.randomBytes(3).toString('hex')}`;
const uuid=n=>`${String(n).padStart(8,'0')}-1000-4000-8000-${String(n).padStart(12,'0')}`;
const normalized=value=>JSON.parse(JSON.stringify(value));

function lostCommitPool(pool){
  return {async connect(){
    const client=await pool.connect();let lost=false;
    return {async query(...args){
      if(String(args[0]).trim()==='COMMIT'&&!lost){lost=true;await client.query(...args);throw new Error('socket closed after commit');}
      return client.query(...args);
    },release:error=>client.release(error)};
  }};
}

async function snapshot(pool,domainSql,params,key,actionCode){
  const domain=await pool.query(domainSql,params);
  const event=await pool.query('SELECT * FROM tenant_directory_event WHERE idempotency_key=$1 AND action_code=$2',[key,actionCode]);
  return normalized({domain:domain.rows,event:event.rows});
}

async function rewriteEvent(pool,key,actionCode,setSql,parameters=[]){
  await pool.query('ALTER TABLE tenant_directory_event DISABLE TRIGGER tenant_directory_event_append_only');
  try{await pool.query(`UPDATE tenant_directory_event SET ${setSql} WHERE idempotency_key=$1 AND action_code=$2`,[key,actionCode,...parameters]);}
  finally{await pool.query('ALTER TABLE tenant_directory_event ENABLE TRIGGER tenant_directory_event_append_only');}
}

async function takeEvent(pool,key,actionCode){
  await pool.query('ALTER TABLE tenant_directory_event DISABLE TRIGGER tenant_directory_event_append_only');
  try{return (await pool.query('DELETE FROM tenant_directory_event WHERE idempotency_key=$1 AND action_code=$2 RETURNING *',[key,actionCode])).rows[0];}
  finally{await pool.query('ALTER TABLE tenant_directory_event ENABLE TRIGGER tenant_directory_event_append_only');}
}

async function restoreEvent(pool,event){
  await pool.query(`INSERT INTO tenant_directory_event
    (event_id,tenant_id,organization_id,aggregate_type,aggregate_id,action_code,from_state,to_state,reason_code,correlation_id,idempotency_key,intent_digest,occurred_at,payload)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::jsonb)`,[event.event_id,event.tenant_id,event.organization_id,event.aggregate_type,event.aggregate_id,event.action_code,event.from_state,event.to_state,event.reason_code,event.correlation_id,event.idempotency_key,event.intent_digest,event.occurred_at,JSON.stringify(event.payload)]);
}

async function removeDomainForOrphan(pool,scenario){
  const deleteSql=scenario.domain.replace(/^SELECT .*? FROM /,'DELETE FROM ');
  await pool.query("SET session_replication_role='replica'");
  try{await pool.query(deleteSql,scenario.params);}
  finally{await pool.query("SET session_replication_role='origin'");}
}

async function expectSanitizedFailure(operation){
  await assert.rejects(operation,error=>error.code==='TRANSITION_CONFLICT'&&!/socket|postgres|sql|host|credential/i.test(error.message));
}

function digestEnvelope(name,event,domain,divergent=false){
  const tenantId=event.tenant_id,organizationId=event.organization_id,connectionVersion=Number(event.payload&&event.payload.connectionVersion)||1;
  const reasonCode=divergent?'DIVERGENT_TEST':'REVIEW_TEST';
  switch(name){
    case 'createTenant': return {intent:{organizationId,tenantId:divergent?uuid(900001):tenantId,deploymentMode:'DATABASE_PER_ORGANIZATION'},payload:{}};
    case 'provisioning.start': return {intent:{organizationId,manifestVersion:divergent?'2':'1',currentStepCode:'QUEUED'},payload:{}};
    case 'provisioning.assign': return {intent:{organizationId,tenantId:divergent?uuid(900002):tenantId,expectedRevision:1},payload:{}};
    case 'generation': return {intent:{tenantId,databaseGenerationId:event.aggregate_id,databaseRef:divergent?'transaction-db-divergent':'transaction-db'},payload:{}};
    case 'candidate': {const intent={tenantId,deploymentMode:'DATABASE_PER_ORGANIZATION',databaseGenerationId:domain[0].database_generation_id,databaseRef:'candidate-db',credentialRef:divergent?'candidate-credential-divergent':'candidate-credential',regionCode:'EU',residencyPolicyVersion:'1'};return {intent,payload:{connectionVersion,intentDigest:intentDigest(intent)}};}
    case 'publish': {const expectedRevision=divergent?2:1;return {intent:{tenantId,connectionVersion:1,expectedRevision},payload:{connectionVersion:1,previousConnectionVersion:null,previousOperationalState:'PENDING',expectedRevision,resultingRevision:expectedRevision+1}};}
    case 'schema': return {intent:{tenantId,expectedRevision:1,compatibilityState:'COMPATIBLE',currentVersion:divergent?'2':'1',targetVersion:'1',minimumReadVersion:'1',minimumWriteVersion:'1',verifiedCapabilities:{ordered:true},migrationLockRef:null,lockExpiresAt:null,lastErrorCode:null},payload:{}};
    case 'health': return {intent:{tenantId,connectionVersion:1,healthState:'HEALTHY',probeType:'SYNTHETIC',observedAt:'2030-01-01T00:00:00.000Z',expiresAt:divergent?'2030-01-01T00:02:00.000Z':'2030-01-01T00:01:00.000Z',lastErrorCode:null,expectedRevision:null},payload:{connectionVersion:1,resultingRevision:1}};
    case 'provisioning transition': return {intent:{organizationId,fromStatuses:['QUEUED'],sourceState:event.from_state,toStatus:'RUNNING',expectedRevision:1,reasonCode},payload:{}};
    case 'connection transition': return {intent:{tenantId,fromStates:['AVAILABLE'],sourceState:event.from_state,toState:'BLOCKED',expectedRevision:2,reasonCode},payload:{}};
    case 'version transition': return {intent:{tenantId,connectionVersion:1,fromStates:['VALIDATED'],sourceState:event.from_state,toState:'DRAINING',reasonCode},payload:{connectionVersion:1}};
    case 'validateVersion': return {intent:{tenantId,connectionVersion:1,observedSystemIdentifier:'validate-method-system',bindingDigest:divergent?'validate-method-binding-divergent':'validate-method-binding'},payload:{connectionVersion:1}};
    case 'provisioning.beginVerification': return {intent:{organizationId,fromStatuses:['RUNNING'],sourceState:event.from_state,toStatus:'VERIFYING',expectedRevision:3,reasonCode},payload:{}};
    case 'provisioning.markReady': return {intent:{organizationId,fromStatuses:['VERIFYING'],sourceState:event.from_state,toStatus:'READY',expectedRevision:divergent?5:4,reasonCode:null},payload:{}};
    case 'provisioning.markFailed': return {intent:{organizationId,fromStatuses:['RUNNING','VERIFYING'],sourceState:event.from_state,toStatus:'FAILED',expectedRevision:2,reasonCode},payload:{}};
    case 'provisioning.retryFailed': return {intent:{organizationId,fromStatuses:['FAILED'],sourceState:event.from_state,toStatus:'QUEUED',expectedRevision:divergent?4:3,reasonCode:null},payload:{}};
    case 'provisioning.cancel': return {intent:{organizationId,fromStatuses:['QUEUED','RUNNING'],sourceState:event.from_state,toStatus:'CANCELLED',expectedRevision:1,reasonCode},payload:{}};
    case 'connection.restoreConnection': return {intent:{tenantId,connectionVersion:2,expectedRevision:3,reasonCode},payload:{connectionVersion:2,previousConnectionVersion:1,expectedRevision:3,resultingRevision:4}};
    case 'connection.beginConnectionDraining': return {intent:{tenantId,fromStates:['PENDING','AVAILABLE','BLOCKED'],sourceState:event.from_state,toState:'DRAINING',expectedRevision:2,reasonCode},payload:{}};
    case 'connection.archiveConnection': return {intent:{tenantId,fromStates:['DRAINING'],sourceState:event.from_state,toState:'ARCHIVED',expectedRevision:3,reasonCode},payload:{}};
    case 'version.revokeVersion': return {intent:{tenantId,connectionVersion:1,fromStates:['DRAINING'],sourceState:event.from_state,toState:'REVOKED',reasonCode},payload:{connectionVersion:1}};
    case 'version.markVersionFailed': return {intent:{tenantId,connectionVersion:1,fromStates:['CANDIDATE','VALIDATED'],sourceState:event.from_state,toState:'FAILED',reasonCode},payload:{connectionVersion:1}};
    default: throw new Error(`Missing digest envelope for ${name}`);
  }
}

function alternateAllowedSource(name, originalSource) {
  if(name==='version.markVersionFailed')return originalSource==='VALIDATED'?'CANDIDATE':'VALIDATED';
  return ({
    'provisioning.markFailed':'VERIFYING',
    'provisioning.cancel':'RUNNING',
    'connection.beginConnectionDraining':'BLOCKED'
  })[name] || null;
}

function returnProjection(name,row){
  if(name==='createTenant')return {tenant_id:row.tenantId,organization_id:row.organizationId,deployment_mode:row.deploymentMode,revision:String(row.revision)};
  return row;
}

function assertReturnMatchesDomain(scenario,result,domainRows,label){
  assert.equal(domainRows.length,1,`${scenario.name}: ${label} requires exactly one persisted domain row`);
  const persisted=scenario.name==='createTenant'
    ? {tenant_id:domainRows[0].tenant_id,organization_id:domainRows[0].organization_id,deployment_mode:domainRows[0].deployment_mode,revision:String(domainRows[0].revision)}
    : domainRows[0];
  assert.deepEqual(normalized(returnProjection(scenario.name,result)),normalized(persisted),`${scenario.name}: ${label} must equal the persisted domain and revision`);
}

async function main(){
  const admin=new Pool(config('postgres'));let cases=0;const divergentIntents=[],sourceStateTamperRefusals=[],directDomainAdvances=[],relatedDomainAdvances=[],orphanEvents=[],domainsWithoutEvents=[];
  try{await withDatabase(admin,`c4g_f41_transaction_state_${suffix}`,async pool=>{
    const directory=createTenantDirectoryRepository(pool),provisioning=createTenantProvisioningRepository(pool),connections=createTenantConnectionRepository(pool),schema=createTenantSchemaRepository(pool),health=createTenantHealthRepository(pool);
    let serial=1100;
    async function base(label){
      const organizationId=uuid(serial++),tenantId=uuid(serial++),correlationId=uuid(serial++);
      await seedOrganization(pool,organizationId,`${label}-${serial}-example-invalid`);
      await directory.createTenant({organizationId,tenantId,correlationId,idempotencyKey:`setup_${label}_tenant`});
      return {organizationId,tenantId};
    }
    async function generation(label){
      const value=await base(label),databaseGenerationId=uuid(serial++);
      await connections.createGeneration({...value,databaseGenerationId,databaseRef:`${label}-db`,correlationId:uuid(serial++),idempotencyKey:`setup_${label}_generation`});
      return {...value,databaseGenerationId};
    }
    async function validated(label){
      const value=await generation(label);
      await connections.createCandidateVersion({...value,databaseRef:`${label}-db`,credentialRef:`${label}-credential`,regionCode:'EU',residencyPolicyVersion:'1',correlationId:uuid(serial++),idempotencyKey:`setup_${label}_candidate`});
      await connections.validateVersion({tenantId:value.tenantId,connectionVersion:1,observedSystemIdentifier:`${label}-system`,bindingDigest:`${label}-binding`,correlationId:uuid(serial++),idempotencyKey:`setup_${label}_validate`});
      return {...value,connectionVersion:1};
    }
    async function readyForActivation(label){
      const value=await validated(label);
      await provisioning.start({organizationId:value.organizationId,manifestVersion:'1',correlationId:uuid(serial++),idempotencyKey:`setup_${label}_provision`});
      await provisioning.assignTenantOnce({organizationId:value.organizationId,tenantId:value.tenantId,expectedRevision:1,correlationId:uuid(serial++),idempotencyKey:`setup_${label}_assign`});
      await provisioning.beginProvisioning({organizationId:value.organizationId,expectedRevision:2,correlationId:uuid(serial++),idempotencyKey:`setup_${label}_running`});
      await provisioning.beginVerification({organizationId:value.organizationId,expectedRevision:3,correlationId:uuid(serial++),idempotencyKey:`setup_${label}_verifying`});
      await schema.recordObservation({tenantId:value.tenantId,expectedRevision:1,compatibilityState:'COMPATIBLE',currentVersion:'1',targetVersion:'1',minimumReadVersion:'1',minimumWriteVersion:'1',verifiedCapabilities:{ready:true},correlationId:uuid(serial++),idempotencyKey:`setup_${label}_schema`});
      await provisioning.markReady({organizationId:value.organizationId,expectedRevision:4,correlationId:uuid(serial++),idempotencyKey:`setup_${label}_ready`});
      return value;
    }
    async function available(label){
      const value=await readyForActivation(label);
      await connections.publishVersion({tenantId:value.tenantId,connectionVersion:1,expectedRevision:1,correlationId:uuid(serial++),idempotencyKey:`setup_${label}_publish`});
      return value;
    }
    async function addValidatedRecoveryVersion(value,label){
      await connections.createCandidateVersion({...value,databaseRef:`${label}-db`,credentialRef:`${label}-recovery-credential`,regionCode:'EU',residencyPolicyVersion:'1',correlationId:uuid(serial++),idempotencyKey:`setup_${label}_recovery_candidate`});
      await connections.validateVersion({tenantId:value.tenantId,connectionVersion:2,observedSystemIdentifier:`${label}-recovery-system`,bindingDigest:`${label}-recovery-binding`,correlationId:uuid(serial++),idempotencyKey:`setup_${label}_recovery_validate`});
    }

    const scenarios=[];
    {
      const organizationId=uuid(serial++),tenantId=uuid(serial++);await seedOrganization(pool,organizationId,`create-${serial}-example-invalid`);
      scenarios.push({name:'createTenant',action:'TENANT_CREATED',domain:'SELECT * FROM tenant WHERE organization_id=$1',params:[organizationId],invoke:(repo,key,c,d=false)=>repo.createTenant({organizationId,tenantId:d?uuid(900001):tenantId,correlationId:c,idempotencyKey:key}),advance:()=>provisioning.start({organizationId,manifestVersion:'1',correlationId:uuid(serial++),idempotencyKey:`advance_tenant_${serial}`}),advancedReplay:'success',factory:createTenantDirectoryRepository});
    }
    {
      const {organizationId}=await base('start');
      scenarios.push({name:'provisioning.start',action:'PROVISIONING_STARTED',domain:'SELECT * FROM organization_provisioning WHERE organization_id=$1',params:[organizationId],invoke:(repo,key,c,d=false)=>repo.start({organizationId,manifestVersion:d?'2':'1',correlationId:c,idempotencyKey:key}),advance:()=>provisioning.beginProvisioning({organizationId,expectedRevision:1,correlationId:uuid(serial++),idempotencyKey:`advance_start_${serial}`}),advancedReplay:'conflict',factory:createTenantProvisioningRepository});
    }
    {
      const {organizationId,tenantId}=await base('assign');await provisioning.start({organizationId,manifestVersion:'1',correlationId:uuid(serial++),idempotencyKey:'setup_assign_start'});
      scenarios.push({name:'provisioning.assign',action:'TENANT_ASSIGNED',domain:'SELECT * FROM organization_provisioning WHERE organization_id=$1',params:[organizationId],invoke:(repo,key,c,d=false)=>repo.assignTenantOnce({organizationId,tenantId:d?uuid(900002):tenantId,expectedRevision:1,correlationId:c,idempotencyKey:key}),advance:()=>provisioning.beginProvisioning({organizationId,expectedRevision:2,correlationId:uuid(serial++),idempotencyKey:`advance_assign_${serial}`}),advancedReplay:'conflict',factory:createTenantProvisioningRepository});
    }
    {
      const {tenantId}=await base('generation'),databaseGenerationId=uuid(serial++);
      scenarios.push({name:'generation',action:'DATABASE_GENERATION_CREATED',domain:'SELECT * FROM tenant_database_generation WHERE tenant_id=$1',params:[tenantId],invoke:(repo,key,c,d=false)=>repo.createGeneration({tenantId,databaseGenerationId,databaseRef:d?'transaction-db-divergent':'transaction-db',correlationId:c,idempotencyKey:key}),advance:()=>connections.createCandidateVersion({tenantId,databaseGenerationId,databaseRef:'transaction-db',credentialRef:`advance-generation-${serial}`,regionCode:'EU',residencyPolicyVersion:'1',correlationId:uuid(serial++),idempotencyKey:`advance_generation_${serial}`}),advancedReplay:'success',factory:createTenantConnectionRepository});
    }
    {
      const value=await generation('candidate');
      scenarios.push({name:'candidate',action:'CONNECTION_VERSION_CREATED',domain:'SELECT * FROM organization_connection_version WHERE tenant_id=$1',params:[value.tenantId],invoke:(repo,key,c,d=false)=>repo.createCandidateVersion({...value,databaseRef:'candidate-db',credentialRef:d?'candidate-credential-divergent':'candidate-credential',regionCode:'EU',residencyPolicyVersion:'1',correlationId:c,idempotencyKey:key}),advance:()=>connections.validateVersion({tenantId:value.tenantId,connectionVersion:1,observedSystemIdentifier:'advance-candidate-system',bindingDigest:'advance-candidate-binding',correlationId:uuid(serial++),idempotencyKey:`advance_candidate_${serial}`}),advancedReplay:'conflict',factory:createTenantConnectionRepository});
    }
    {
      const value=await readyForActivation('publish');
      scenarios.push({name:'publish',action:'CONNECTION_VERSION_PUBLISHED',domain:'SELECT * FROM organization_connection WHERE tenant_id=$1',params:[value.tenantId],invoke:(repo,key,c,d=false)=>repo.publishVersion({tenantId:value.tenantId,connectionVersion:1,expectedRevision:d?2:1,correlationId:c,idempotencyKey:key}),advance:()=>connections.blockConnection({tenantId:value.tenantId,expectedRevision:2,reasonCode:'ADVANCE_TEST',correlationId:uuid(serial++),idempotencyKey:`advance_publish_${serial}`}),advancedReplay:'conflict',factory:createTenantConnectionRepository});
    }
    {
      const {tenantId}=await base('schema');
      scenarios.push({name:'schema',action:'SCHEMA_OBSERVED',domain:'SELECT * FROM tenant_schema_state WHERE tenant_id=$1',params:[tenantId],invoke:(repo,key,c,d=false)=>repo.recordObservation({tenantId,expectedRevision:1,compatibilityState:'COMPATIBLE',currentVersion:d?'2':'1',targetVersion:'1',minimumReadVersion:'1',minimumWriteVersion:'1',verifiedCapabilities:{ordered:true},correlationId:c,idempotencyKey:key}),advance:()=>schema.recordObservation({tenantId,expectedRevision:2,compatibilityState:'COMPATIBLE',currentVersion:'2',targetVersion:'2',minimumReadVersion:'2',minimumWriteVersion:'2',verifiedCapabilities:{advanced:true},correlationId:uuid(serial++),idempotencyKey:`advance_schema_${serial}`}),advancedReplay:'conflict',factory:createTenantSchemaRepository});
    }
    {
      const value=await validated('health');
      scenarios.push({name:'health',action:'HEALTH_OBSERVED',domain:'SELECT * FROM tenant_health_observation WHERE tenant_id=$1',params:[value.tenantId],invoke:(repo,key,c,d=false)=>repo.replaceSnapshot({tenantId:value.tenantId,connectionVersion:1,healthState:'HEALTHY',probeType:'SYNTHETIC',observedAt:'2030-01-01T00:00:00Z',expiresAt:d?'2030-01-01T00:02:00Z':'2030-01-01T00:01:00Z',correlationId:c,idempotencyKey:key}),advance:()=>health.replaceSnapshot({tenantId:value.tenantId,connectionVersion:1,healthState:'HEALTHY',probeType:'SYNTHETIC',observedAt:'2030-01-02T00:00:00Z',expiresAt:'2030-01-02T00:01:00Z',correlationId:uuid(serial++),idempotencyKey:`advance_health_${serial}`}),advancedReplay:'conflict',factory:createTenantHealthRepository});
    }
    {
      const {organizationId}=await base('provision-transition');await provisioning.start({organizationId,manifestVersion:'1',correlationId:uuid(serial++),idempotencyKey:'setup_provision_transition_start'});
      scenarios.push({name:'provisioning transition',action:'PROVISIONING_RUNNING',domain:'SELECT * FROM organization_provisioning WHERE organization_id=$1',params:[organizationId],invoke:(repo,key,c,d=false)=>repo.beginProvisioning({organizationId,expectedRevision:1,reasonCode:d?'DIVERGENT_TEST':'REVIEW_TEST',correlationId:c,idempotencyKey:key}),advance:()=>provisioning.markFailed({organizationId,expectedRevision:2,reasonCode:'ADVANCE_TEST',correlationId:uuid(serial++),idempotencyKey:`advance_running_${serial}`}),advancedReplay:'conflict',factory:createTenantProvisioningRepository});
    }
    {
      const value=await available('connection-transition');await addValidatedRecoveryVersion(value,'connection-transition');
      scenarios.push({name:'connection transition',action:'CONNECTION_BLOCKED',domain:'SELECT * FROM organization_connection WHERE tenant_id=$1',params:[value.tenantId],invoke:(repo,key,c,d=false)=>repo.blockConnection({tenantId:value.tenantId,expectedRevision:2,reasonCode:d?'DIVERGENT_TEST':'REVIEW_TEST',correlationId:c,idempotencyKey:key}),advance:()=>connections.restoreConnection({tenantId:value.tenantId,connectionVersion:2,expectedRevision:3,reasonCode:'ADVANCE_TEST',correlationId:uuid(serial++),idempotencyKey:`advance_block_${serial}`}),advancedReplay:'conflict',factory:createTenantConnectionRepository});
    }
    {
      const value=await validated('version-transition');
      scenarios.push({name:'version transition',action:'CONNECTION_VERSION_DRAINING',domain:'SELECT * FROM organization_connection_version WHERE tenant_id=$1 AND connection_version=1',params:[value.tenantId],invoke:(repo,key,c,d=false)=>repo.beginVersionDraining({tenantId:value.tenantId,connectionVersion:1,reasonCode:d?'DIVERGENT_TEST':'REVIEW_TEST',correlationId:c,idempotencyKey:key}),advance:()=>connections.revokeVersion({tenantId:value.tenantId,connectionVersion:1,reasonCode:'ADVANCE_TEST',correlationId:uuid(serial++),idempotencyKey:`advance_drain_${serial}`}),advancedReplay:'conflict',factory:createTenantConnectionRepository});
    }
    {
      const value=await generation('validate-method');
      await connections.createCandidateVersion({...value,databaseRef:'validate-method-db',credentialRef:'validate-method-credential',regionCode:'EU',residencyPolicyVersion:'1',correlationId:uuid(serial++),idempotencyKey:'setup_validate_method_candidate'});
      scenarios.push({name:'validateVersion',action:'CONNECTION_VERSION_VALIDATED',domain:'SELECT * FROM organization_connection_version WHERE tenant_id=$1 AND connection_version=1',params:[value.tenantId],invoke:(repo,key,c,d=false)=>repo.validateVersion({tenantId:value.tenantId,connectionVersion:1,observedSystemIdentifier:'validate-method-system',bindingDigest:d?'validate-method-binding-divergent':'validate-method-binding',correlationId:c,idempotencyKey:key}),advance:()=>connections.markVersionFailed({tenantId:value.tenantId,connectionVersion:1,reasonCode:'ADVANCE_TEST',correlationId:uuid(serial++),idempotencyKey:`advance_validate_${serial}`}),advancedReplay:'conflict',factory:createTenantConnectionRepository});
    }
    {
      const {organizationId,tenantId}=await base('begin-verification-method');await provisioning.start({organizationId,manifestVersion:'1',correlationId:uuid(serial++),idempotencyKey:'setup_begin_verification_start'});await provisioning.assignTenantOnce({organizationId,tenantId,expectedRevision:1,correlationId:uuid(serial++),idempotencyKey:'setup_begin_verification_assign'});await provisioning.beginProvisioning({organizationId,expectedRevision:2,correlationId:uuid(serial++),idempotencyKey:'setup_begin_verification_running'});
      scenarios.push({name:'provisioning.beginVerification',action:'PROVISIONING_VERIFYING',domain:'SELECT * FROM organization_provisioning WHERE organization_id=$1',params:[organizationId],invoke:(repo,key,c,d=false)=>repo.beginVerification({organizationId,expectedRevision:3,reasonCode:d?'DIVERGENT_TEST':'REVIEW_TEST',correlationId:c,idempotencyKey:key}),advance:()=>provisioning.markFailed({organizationId,expectedRevision:4,reasonCode:'ADVANCE_TEST',correlationId:uuid(serial++),idempotencyKey:`advance_verifying_${serial}`}),advancedReplay:'conflict',factory:createTenantProvisioningRepository});
    }
    {
      const value=await validated('ready-method');await provisioning.start({organizationId:value.organizationId,manifestVersion:'1',correlationId:uuid(serial++),idempotencyKey:'setup_ready_start'});await provisioning.assignTenantOnce({organizationId:value.organizationId,tenantId:value.tenantId,expectedRevision:1,correlationId:uuid(serial++),idempotencyKey:'setup_ready_assign'});await provisioning.beginProvisioning({organizationId:value.organizationId,expectedRevision:2,correlationId:uuid(serial++),idempotencyKey:'setup_ready_running'});await provisioning.beginVerification({organizationId:value.organizationId,expectedRevision:3,correlationId:uuid(serial++),idempotencyKey:'setup_ready_verifying'});await schema.recordObservation({tenantId:value.tenantId,expectedRevision:1,compatibilityState:'COMPATIBLE',currentVersion:'1',targetVersion:'1',minimumReadVersion:'1',minimumWriteVersion:'1',verifiedCapabilities:{ready:true},correlationId:uuid(serial++),idempotencyKey:'setup_ready_schema'});
      scenarios.push({name:'provisioning.markReady',action:'PROVISIONING_READY',domain:'SELECT * FROM organization_provisioning WHERE organization_id=$1',params:[value.organizationId],invoke:(repo,key,c,d=false)=>repo.markReady({organizationId:value.organizationId,expectedRevision:d?5:4,correlationId:c,idempotencyKey:key}),advance:()=>schema.recordObservation({tenantId:value.tenantId,expectedRevision:2,compatibilityState:'COMPATIBLE',currentVersion:'2',targetVersion:'2',minimumReadVersion:'2',minimumWriteVersion:'2',verifiedCapabilities:{advanced:true},correlationId:uuid(serial++),idempotencyKey:`advance_ready_${serial}`}),advancedReplay:'success',factory:createTenantProvisioningRepository});
    }
    {
      const {organizationId}=await base('mark-failed-method');await provisioning.start({organizationId,manifestVersion:'1',correlationId:uuid(serial++),idempotencyKey:'setup_mark_failed_start'});await provisioning.beginProvisioning({organizationId,expectedRevision:1,correlationId:uuid(serial++),idempotencyKey:'setup_mark_failed_running'});
      scenarios.push({name:'provisioning.markFailed',action:'PROVISIONING_FAILED',domain:'SELECT * FROM organization_provisioning WHERE organization_id=$1',params:[organizationId],invoke:(repo,key,c,d=false)=>repo.markFailed({organizationId,expectedRevision:2,reasonCode:d?'DIVERGENT_TEST':'REVIEW_TEST',correlationId:c,idempotencyKey:key}),advance:()=>provisioning.retryFailed({organizationId,expectedRevision:3,correlationId:uuid(serial++),idempotencyKey:`advance_failed_${serial}`}),advancedReplay:'conflict',factory:createTenantProvisioningRepository});
    }
    {
      const {organizationId}=await base('retry-failed-method');await provisioning.start({organizationId,manifestVersion:'1',correlationId:uuid(serial++),idempotencyKey:'setup_retry_failed_start'});await provisioning.beginProvisioning({organizationId,expectedRevision:1,correlationId:uuid(serial++),idempotencyKey:'setup_retry_failed_running'});await provisioning.markFailed({organizationId,expectedRevision:2,reasonCode:'SETUP_FAILED',correlationId:uuid(serial++),idempotencyKey:'setup_retry_failed_failed'});
      scenarios.push({name:'provisioning.retryFailed',action:'PROVISIONING_QUEUED',domain:'SELECT * FROM organization_provisioning WHERE organization_id=$1',params:[organizationId],invoke:(repo,key,c,d=false)=>repo.retryFailed({organizationId,expectedRevision:d?4:3,correlationId:c,idempotencyKey:key}),advance:()=>provisioning.beginProvisioning({organizationId,expectedRevision:4,correlationId:uuid(serial++),idempotencyKey:`advance_retry_${serial}`}),advancedReplay:'conflict',factory:createTenantProvisioningRepository});
    }
    {
      const {organizationId,tenantId}=await base('cancel-method');await provisioning.start({organizationId,manifestVersion:'1',correlationId:uuid(serial++),idempotencyKey:'setup_cancel_start'});
      scenarios.push({name:'provisioning.cancel',action:'PROVISIONING_CANCELLED',domain:'SELECT * FROM organization_provisioning WHERE organization_id=$1',params:[organizationId],invoke:(repo,key,c,d=false)=>repo.cancel({organizationId,expectedRevision:1,reasonCode:d?'DIVERGENT_TEST':'REVIEW_TEST',correlationId:c,idempotencyKey:key}),advance:()=>schema.recordObservation({tenantId,expectedRevision:1,compatibilityState:'COMPATIBLE',currentVersion:'1',targetVersion:'1',minimumReadVersion:'1',minimumWriteVersion:'1',verifiedCapabilities:{advanced:true},correlationId:uuid(serial++),idempotencyKey:`advance_cancel_${serial}`}),advancedReplay:'success',factory:createTenantProvisioningRepository});
    }
    {
      const value=await available('restore-method');await addValidatedRecoveryVersion(value,'restore-method');await connections.blockConnection({tenantId:value.tenantId,expectedRevision:2,reasonCode:'SETUP_BLOCK',correlationId:uuid(serial++),idempotencyKey:'setup_restore_block'});
      scenarios.push({name:'connection.restoreConnection',action:'CONNECTION_AVAILABLE',domain:'SELECT * FROM organization_connection WHERE tenant_id=$1',params:[value.tenantId],invoke:(repo,key,c,d=false)=>repo.restoreConnection({tenantId:value.tenantId,connectionVersion:2,expectedRevision:3,reasonCode:d?'DIVERGENT_TEST':'REVIEW_TEST',correlationId:c,idempotencyKey:key}),advance:()=>connections.blockConnection({tenantId:value.tenantId,expectedRevision:4,reasonCode:'ADVANCE_TEST',correlationId:uuid(serial++),idempotencyKey:`advance_restore_${serial}`}),advancedReplay:'conflict',factory:createTenantConnectionRepository});
    }
    {
      const value=await available('drain-connection-method');await pool.query("UPDATE organization SET status='TERMINATING' WHERE id=$1",[value.organizationId]);
      scenarios.push({name:'connection.beginConnectionDraining',action:'CONNECTION_DRAINING',domain:'SELECT * FROM organization_connection WHERE tenant_id=$1',params:[value.tenantId],invoke:(repo,key,c,d=false)=>repo.beginConnectionDraining({tenantId:value.tenantId,expectedRevision:2,reasonCode:d?'DIVERGENT_TEST':'REVIEW_TEST',correlationId:c,idempotencyKey:key}),advance:()=>connections.archiveConnection({tenantId:value.tenantId,expectedRevision:3,reasonCode:'ADVANCE_TEST',correlationId:uuid(serial++),idempotencyKey:`advance_connection_drain_${serial}`}),advancedReplay:'conflict',factory:createTenantConnectionRepository});
    }
    {
      const value=await available('archive-connection-method');await pool.query("UPDATE organization SET status='TERMINATING' WHERE id=$1",[value.organizationId]);await connections.beginConnectionDraining({tenantId:value.tenantId,expectedRevision:2,correlationId:uuid(serial++),idempotencyKey:'setup_archive_draining'});
      scenarios.push({name:'connection.archiveConnection',action:'CONNECTION_ARCHIVED',domain:'SELECT * FROM organization_connection WHERE tenant_id=$1',params:[value.tenantId],invoke:(repo,key,c,d=false)=>repo.archiveConnection({tenantId:value.tenantId,expectedRevision:3,reasonCode:d?'DIVERGENT_TEST':'REVIEW_TEST',correlationId:c,idempotencyKey:key}),advance:()=>schema.recordObservation({tenantId:value.tenantId,expectedRevision:2,compatibilityState:'COMPATIBLE',currentVersion:'1',targetVersion:'1',minimumReadVersion:'1',minimumWriteVersion:'1',verifiedCapabilities:{advanced:true},correlationId:uuid(serial++),idempotencyKey:`advance_archive_${serial}`}),advancedReplay:'success',factory:createTenantConnectionRepository});
    }
    {
      const value=await validated('revoke-version-method');await connections.beginVersionDraining({tenantId:value.tenantId,connectionVersion:1,correlationId:uuid(serial++),idempotencyKey:'setup_revoke_draining'});
      scenarios.push({name:'version.revokeVersion',action:'CONNECTION_VERSION_REVOKED',domain:'SELECT * FROM organization_connection_version WHERE tenant_id=$1 AND connection_version=1',params:[value.tenantId],invoke:(repo,key,c,d=false)=>repo.revokeVersion({tenantId:value.tenantId,connectionVersion:1,reasonCode:d?'DIVERGENT_TEST':'REVIEW_TEST',correlationId:c,idempotencyKey:key}),advance:()=>schema.recordObservation({tenantId:value.tenantId,expectedRevision:1,compatibilityState:'COMPATIBLE',currentVersion:'1',targetVersion:'1',minimumReadVersion:'1',minimumWriteVersion:'1',verifiedCapabilities:{advanced:true},correlationId:uuid(serial++),idempotencyKey:`advance_revoke_${serial}`}),advancedReplay:'success',factory:createTenantConnectionRepository});
    }
    {
      const value=await validated('fail-version-method');
      scenarios.push({name:'version.markVersionFailed',action:'CONNECTION_VERSION_FAILED',domain:'SELECT * FROM organization_connection_version WHERE tenant_id=$1 AND connection_version=1',params:[value.tenantId],invoke:(repo,key,c,d=false)=>repo.markVersionFailed({tenantId:value.tenantId,connectionVersion:1,reasonCode:d?'DIVERGENT_TEST':'REVIEW_TEST',correlationId:c,idempotencyKey:key}),advance:()=>schema.recordObservation({tenantId:value.tenantId,expectedRevision:1,compatibilityState:'COMPATIBLE',currentVersion:'1',targetVersion:'1',minimumReadVersion:'1',minimumWriteVersion:'1',verifiedCapabilities:{advanced:true},correlationId:uuid(serial++),idempotencyKey:`advance_version_failed_${serial}`}),advancedReplay:'success',factory:createTenantConnectionRepository});
    }

    assert.equal(scenarios.length,22,'every mutable repository method must have a persisted-state scenario');

    await pool.query(`CREATE FUNCTION f4_fail_deferred_commit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.idempotency_key LIKE 'commit_fail_%' THEN IF NEW.intent_digest IS NULL THEN RAISE EXCEPTION 'missing intent'; END IF; RAISE EXCEPTION 'deliberate deferred commit failure'; END IF; RETURN NEW; END $$`);
    await pool.query(`CREATE CONSTRAINT TRIGGER f4_fail_deferred_commit AFTER INSERT ON tenant_directory_event DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION f4_fail_deferred_commit()`);

    for(const scenario of scenarios){
      const failKey=`commit_fail_${cases}`,failCorrelation=uuid(serial++),before=await snapshot(pool,scenario.domain,scenario.params,failKey,scenario.action);
      await expectSanitizedFailure(()=>scenario.invoke(scenario.factory(pool),failKey,failCorrelation));
      assert.deepEqual(await snapshot(pool,scenario.domain,scenario.params,failKey,scenario.action),before,`${scenario.name}: deferred COMMIT failure must roll back domain and event`);

      const lostKey=`lost_commit_${cases}`,lostCorrelation=uuid(serial++),beforeLost=await snapshot(pool,scenario.domain,scenario.params,lostKey,scenario.action);
      await expectSanitizedFailure(()=>scenario.invoke(scenario.factory(lostCommitPool(pool)),lostKey,lostCorrelation));
      const committed=await snapshot(pool,scenario.domain,scenario.params,lostKey,scenario.action);
      assert.notDeepEqual(committed.domain,beforeLost.domain,`${scenario.name}: real COMMIT must persist domain state`);
      assert.equal(committed.event.length,1,`${scenario.name}: real COMMIT must persist one event`);
      const sequentialReturn=await scenario.invoke(scenario.factory(pool),lostKey,lostCorrelation);
      assertReturnMatchesDomain(scenario,sequentialReturn,committed.domain,'sequential retry return');
      assert.deepEqual(await snapshot(pool,scenario.domain,scenario.params,lostKey,scenario.action),committed,`${scenario.name}: sequential retry must not mutate persisted state`);
      const concurrentReturns=await Promise.all([scenario.invoke(scenario.factory(pool),lostKey,lostCorrelation),scenario.invoke(scenario.factory(pool),lostKey,lostCorrelation)]);
      concurrentReturns.forEach((result,index)=>assertReturnMatchesDomain(scenario,result,committed.domain,`concurrent retry ${index+1} return`));
      assert.deepEqual(concurrentReturns.map(normalized),[normalized(sequentialReturn),normalized(sequentialReturn)],`${scenario.name}: concurrent exact retries must return the same domain result`);
      assert.deepEqual(await snapshot(pool,scenario.domain,scenario.params,lostKey,scenario.action),committed,`${scenario.name}: concurrent retries must preserve domain and event`);
      const originalEnvelope=digestEnvelope(scenario.name,committed.event[0],committed.domain,false);
      const divergentEnvelope=digestEnvelope(scenario.name,committed.event[0],committed.domain,true);
      const originalDigest=intentDigest(originalEnvelope),divergentDigest=intentDigest(divergentEnvelope);
      assert.equal(originalDigest,committed.event[0].intent_digest,`${scenario.name}: reconstructed original envelope must equal the persisted digest`);
      assert.notEqual(divergentDigest,originalDigest,`${scenario.name}: divergent functional envelope must produce a different digest`);
      await expectSanitizedFailure(()=>scenario.invoke(scenario.factory(pool),lostKey,lostCorrelation,true));
      const afterDivergent=await snapshot(pool,scenario.domain,scenario.params,lostKey,scenario.action);
      assert.deepEqual(afterDivergent,committed,`${scenario.name}: same key with divergent functional intent must preserve domain, revision, digest and the single original event`);
      divergentIntents.push(scenario.name);
      const originalEvent=committed.event[0];
      await rewriteEvent(pool,lostKey,scenario.action,`payload=payload||'{"tampered":true}'::jsonb`);
      await expectSanitizedFailure(()=>scenario.invoke(scenario.factory(pool),lostKey,lostCorrelation));
      await rewriteEvent(pool,lostKey,scenario.action,'payload=$3::jsonb',[JSON.stringify(originalEvent.payload)]);
      assert.deepEqual(await snapshot(pool,scenario.domain,scenario.params,lostKey,scenario.action),committed,`${scenario.name}: payload tamper and restoration must not mutate domain/revision`);
      await rewriteEvent(pool,lostKey,scenario.action,`intent_digest=repeat('0',64)`);
      await expectSanitizedFailure(()=>scenario.invoke(scenario.factory(pool),lostKey,lostCorrelation));
      await rewriteEvent(pool,lostKey,scenario.action,'intent_digest=$3',[originalEvent.intent_digest]);
      assert.deepEqual(await snapshot(pool,scenario.domain,scenario.params,lostKey,scenario.action),committed,`${scenario.name}: digest tamper and restoration must not mutate domain/revision`);
      const alternateSource=alternateAllowedSource(scenario.name,originalEvent.from_state);
      if(alternateSource!==null){
        await rewriteEvent(pool,lostKey,scenario.action,'from_state=$3',[alternateSource]);
        await expectSanitizedFailure(()=>scenario.invoke(scenario.factory(pool),lostKey,lostCorrelation));
        await rewriteEvent(pool,lostKey,scenario.action,'from_state=$3',[originalEvent.from_state]);
        assert.deepEqual(await snapshot(pool,scenario.domain,scenario.params,lostKey,scenario.action),committed,`${scenario.name}: allowed-source tamper and restoration must not mutate domain/revision`);
        sourceStateTamperRefusals.push(scenario.name);
      }
      const savedEvent=await takeEvent(pool,lostKey,scenario.action);
      assert.ok(savedEvent,`${scenario.name}: domain-without-event setup must remove the original event`);
      const domainWithoutEvent=normalized((await pool.query(scenario.domain,scenario.params)).rows);
      await expectSanitizedFailure(()=>scenario.invoke(scenario.factory(pool),lostKey,lostCorrelation));
      assert.deepEqual(normalized((await pool.query(scenario.domain,scenario.params)).rows),domainWithoutEvent,`${scenario.name}: domain without event must never be mutated again`);
      const recoveredEvents=(await pool.query('SELECT count(*)::int count FROM tenant_directory_event WHERE idempotency_key=$1 AND action_code=$2',[lostKey,scenario.action])).rows[0].count;
      assert.equal(recoveredEvents,0,`${scenario.name}: domain-without-event refusal must create no event`);
      domainsWithoutEvents.push(scenario.name);
      await restoreEvent(pool,savedEvent);
      const coherentEvent=await snapshot(pool,scenario.domain,scenario.params,lostKey,scenario.action);
      assert.deepEqual(coherentEvent,committed,`${scenario.name}: restored event must be the exact original before the orphan check`);
      const eventCountBeforeAdvance=Number((await pool.query('SELECT count(*) count FROM tenant_directory_event')).rows[0].count);
      await assert.doesNotReject(()=>scenario.advance(),`${scenario.name}: semantic domain advance must be a valid distinct operation`);
      const eventCountAfterAdvance=Number((await pool.query('SELECT count(*) count FROM tenant_directory_event')).rows[0].count);
      assert.equal(eventCountAfterAdvance,eventCountBeforeAdvance+1,`${scenario.name}: semantic domain advance must persist exactly one distinct event`);
      const advanced=await snapshot(pool,scenario.domain,scenario.params,lostKey,scenario.action);
      assert.deepEqual(advanced.event,committed.event,`${scenario.name}: domain advance must preserve the original event`);
      if(scenario.advancedReplay==='success'){
        assert.deepEqual(advanced.domain,committed.domain,`${scenario.name}: immutable or terminal operation must keep its target row stable while a related aggregate advances`);
        const replayed=await scenario.invoke(scenario.factory(pool),lostKey,lostCorrelation);
        assertReturnMatchesDomain(scenario,replayed,advanced.domain,'related-advance replay return');
        assert.deepEqual(normalized(replayed),normalized(sequentialReturn),`${scenario.name}: replay after related domain advance must return the exact original result`);
        relatedDomainAdvances.push(scenario.name);
      }else{
        assert.notDeepEqual(advanced.domain,committed.domain,`${scenario.name}: direct semantic advance must change the observed target domain`);
        await expectSanitizedFailure(()=>scenario.invoke(scenario.factory(pool),lostKey,lostCorrelation));
        directDomainAdvances.push(scenario.name);
      }
      assert.deepEqual(await snapshot(pool,scenario.domain,scenario.params,lostKey,scenario.action),advanced,`${scenario.name}: old replay must preserve advanced domain, revision and the single original event`);
      await removeDomainForOrphan(pool,scenario);
      const absentDomain=await snapshot(pool,scenario.domain,scenario.params,lostKey,scenario.action);
      assert.deepEqual(absentDomain.domain,[],`${scenario.name}: orphan setup must remove the corresponding domain`);
      assert.deepEqual(absentDomain.event,committed.event,`${scenario.name}: orphan event must remain internally coherent and unchanged`);
      await expectSanitizedFailure(()=>scenario.invoke(scenario.factory(pool),lostKey,lostCorrelation));
      assert.deepEqual(await snapshot(pool,scenario.domain,scenario.params,lostKey,scenario.action),absentDomain,`${scenario.name}: orphan refusal must roll back and preserve the single original event without recreating domain`);
      orphanEvents.push(scenario.name);
      cases++;
    }
  });}finally{await admin.end();}
  for(const matrix of [divergentIntents,orphanEvents,domainsWithoutEvents])assert.equal(matrix.length,22,'every transversal corrective matrix must derive its count from the 22 executed mutable methods');
  assert.equal(directDomainAdvances.length,15,'direct target-domain advances must match the executable non-terminal scenarios');
  assert.equal(relatedDomainAdvances.length,7,'related-domain advances must match immutable or terminal target scenarios');
  assert.equal(sourceStateTamperRefusals.length,4,'every transition with multiple allowed source states must reject a from_state-only substitution');
  assert.equal(directDomainAdvances.length+relatedDomainAdvances.length,22,'every mutable method must have one explicitly classified semantic advance');
  console.log(`F4.1 real transaction-state matrix passed: ${cases} mutable methods; ${divergentIntents.length} divergent functional digests; ${sourceStateTamperRefusals.length} allowed-source tamper refusals; ${directDomainAdvances.length} direct target-domain advances; ${relatedDomainAdvances.length} related advances for immutable/terminal targets; ${orphanEvents.length} coherent orphan-event refusals; ${domainsWithoutEvents.length} fail-closed domain-without-event refusals.`);
}
main().catch(error=>{console.error(error);process.exitCode=1;});
