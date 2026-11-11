'use strict';
// Called only by the paused, authorized window. No configuration files, secrets,
// services, arbitrary SQL bundles or database targets are loaded by this module.
const {isDeepStrictEqual}=require('node:util'),{createHash}=require('node:crypto');
const pkg=require('../backend/src/security/opportunityV2MigrationPackage');
const ACTIVATION=Object.freeze({packageId:pkg.PACKAGE_ID,runtime:'authenticated-v2',executor:'bounded-v2'});
const MEMBERS_FILE='.tmp/local-platform/members/worker.json';
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const clone=value=>JSON.parse(JSON.stringify(value));
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const quote=value=>'"'+value.replaceAll('"','""')+'"';
function fail(code){throw Object.assign(new Error(code),{code});}
function same(left,right,code){if(!isDeepStrictEqual(left,right))fail(code);}
function outsideSchema(snapshot){if(!snapshot||typeof snapshot!=='object'||Array.isArray(snapshot)||!Number.isSafeInteger(snapshot.connectionRevision)||snapshot.connectionRevision<1||!Number.isSafeInteger(snapshot.fence)||snapshot.fence<0)fail('INSTALL_BINDING_INVALID');const {schema,connectionRevision,fence,...rest}=snapshot;return rest;}
function verifyPublished(snapshot,published){same(outsideSchema(published),outsideSchema(snapshot),'INSTALL_PUBLISHED_BINDING_CHANGED');if(published.connectionRevision<snapshot.connectionRevision||published.fence<snapshot.fence)fail('INSTALL_PUBLISHED_BINDING_REGRESSION');}
function validateState(state,stateFiles){
 if(!state||state.phase!=='READY'||!UUID.test(state.installationId||'')||!['organizationId','tenantId','generationId'].every(key=>UUID.test(state[key]||''))
  ||!state.target||state.target.centralDatabase===state.target.tenantDatabase||!['centralDatabase','tenantDatabase'].every(key=>/^[a-z][a-z0-9_]{0,62}$/.test(state.target[key]||''))
  ||state.snapshot?.organizationId!==state.organizationId||state.snapshot?.tenantId!==state.tenantId||state.snapshot?.databaseGenerationId!==state.generationId
  ||state.snapshot.databaseRef!==state.target.tenantDatabase||state.credentials?.tenantId!==state.tenantId||state.credentials?.database!==state.target.tenantDatabase)fail('INSTALL_STATE_INVALID');
 if(state.opportunityActivation!==undefined&&!isDeepStrictEqual(state.opportunityActivation,ACTIVATION))fail('INSTALL_SELECTION_CONFLICT');
 if(!Array.isArray(stateFiles)||stateFiles.length>1||stateFiles.some(file=>!file||file.relative!==MEMBERS_FILE||!file.value||!Array.isArray(file.value.bindings)))fail('INSTALL_STATE_FILES_INVALID');
 if(state.memberAccess===true&&stateFiles.length!==1)fail('INSTALL_MEMBER_BINDINGS_REQUIRED');
 for(const file of stateFiles){const targeted=file.value.bindings.filter(binding=>binding.organizationId===state.organizationId);if(targeted.length!==1)fail('INSTALL_MEMBER_BINDING_AMBIGUOUS');for(const binding of targeted){same(outsideSchema(binding.snapshot),outsideSchema(state.snapshot),'INSTALL_MEMBER_BINDING_CHANGED');same(binding.credentials,state.credentials,'INSTALL_MEMBER_CREDENTIAL_CHANGED');}}
 return true;
}
function configurationAfter(state,stateFiles,published){
 validateState(state,stateFiles);verifyPublished(state.snapshot,published);for(const file of stateFiles)for(const binding of file.value.bindings)if(binding.organizationId===state.organizationId)verifyPublished(binding.snapshot,published);
 const schema=published.schema;
 if(schema?.currentVersion!==pkg.tenantAddition.version||schema.schemaFingerprint!==pkg.tenantAddition.schemaFingerprint
  ||schema.verifiedCapabilities?.[pkg.TENANT_CAPABILITY]!==true||schema.compatibilityState!=='COMPATIBLE'||!Number.isSafeInteger(schema.revision)||schema.revision<1)fail('INSTALL_PUBLISHED_SCHEMA_INVALID');
 const nextState=clone(state);nextState.opportunityActivation={...ACTIVATION};nextState.snapshot.schema=clone(schema);nextState.snapshot.connectionRevision=published.connectionRevision;nextState.snapshot.fence=published.fence;
 const nextFiles=stateFiles.map(file=>{const value=clone(file.value);for(const binding of value.bindings)if(binding.organizationId===state.organizationId)binding.snapshot.schema=clone(schema);return {relative:file.relative,value};});
 // This final whitelist is independent of how the patch above was constructed.
 const reverted=clone(nextState);if(state.opportunityActivation===undefined)delete reverted.opportunityActivation;else reverted.opportunityActivation=clone(state.opportunityActivation);reverted.snapshot.schema=clone(state.snapshot.schema);reverted.snapshot.connectionRevision=state.snapshot.connectionRevision;reverted.snapshot.fence=state.snapshot.fence;same(reverted,state,'INSTALL_CONFIGURATION_SCOPE_CHANGED');
 for(let index=0;index<nextFiles.length;index++){const restored=clone(nextFiles[index].value),prior=stateFiles[index].value;for(let n=0;n<restored.bindings.length;n++)if(restored.bindings[n].organizationId===state.organizationId)restored.bindings[n].snapshot.schema=clone(prior.bindings[n].snapshot.schema);same(restored,prior,'INSTALL_CONFIGURATION_SCOPE_CHANGED');}
 return {state:nextState,stateFiles:nextFiles};
}
async function currentIdentity(central){
 const rows=(await central.query(`SELECT o.opportunity_id,o.current_revision_id,o.row_version,o.lifecycle_state,r.content_digest,r.snapshot->>'schemaVersion' AS schema_version,f.external_identifier,f.corrections,
  (SELECT coalesce(jsonb_agg(jsonb_build_object('resolution_id',x.resolution_id,'decision_digest',x.decision_digest) ORDER BY x.resolution_id),'[]'::jsonb) FROM opportunity_catalog.funding_resolution x WHERE x.opportunity_id=o.opportunity_id) AS resolutions
  FROM opportunity_catalog.funding_identity f JOIN opportunity_catalog.opportunity o USING(opportunity_id) JOIN opportunity_catalog.revision r ON r.revision_id=o.current_revision_id AND r.opportunity_id=o.opportunity_id WHERE f.external_identifier='CASCADE:11145'`)).rows;
 if(rows.length!==1||rows[0].lifecycle_state!=='ACTIVE'||!UUID.test(rows[0].opportunity_id)||!UUID.test(rows[0].current_revision_id)||Number(rows[0].row_version)<1)fail('INSTALL_11145_IDENTITY_REQUIRED');return rows[0];
}
async function capture(pool,{central=false,tenantId=null}={}){
 const tables=(await pool.query("SELECT n.nspname,c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE c.relkind IN ('r','p') AND n.nspname NOT LIKE 'pg_%' AND n.nspname<>'information_schema' ORDER BY 1,2")).rows,result=[];
 for(const table of tables){
  const relation=quote(table.nspname)+'.'+quote(table.relname),columns=(await pool.query('SELECT column_name FROM information_schema.columns WHERE table_schema=$1 AND table_name=$2 ORDER BY ordinal_position',[table.nspname,table.relname])).rows.map(row=>quote(row.column_name));
  let filter='',values=[];
  if(central&&table.nspname==='public'&&table.relname==='tenant_schema_state'){filter=' WHERE tenant_id<>$1';values=[tenantId];}
  if(central&&table.nspname==='public'&&table.relname==='tenant_directory_event'){const ids=(await pool.query('SELECT event_id FROM public.tenant_directory_event ORDER BY event_id')).rows.map(row=>row.event_id);filter=' WHERE event_id=ANY($1::uuid[])';values=[ids];}
  if(central&&table.nspname==='public'&&table.relname==='c4g_schema_migration')filter=" WHERE version<='035_funding_source_resolution'";
  if(!central&&table.nspname==='c4g_system'&&table.relname==='schema_migration')filter=' WHERE ordinal<=33';
  const sql=`SELECT count(*)::integer AS count,encode(sha256(convert_to(coalesce(string_agg(encode(sha256(convert_to(to_jsonb(t)::text,'UTF8')),'hex'),'' ORDER BY to_jsonb(t)::text),''),'UTF8')),'hex') AS digest FROM (SELECT ${columns.join(',')} FROM ${relation}${filter}) t`;
  const measured=(await pool.query(sql,values)).rows[0];result.push({relation,sql,values,...measured});
 }
 return result;
}
async function assertPreserved(pool,inventory){for(const item of inventory){const actual=(await pool.query(item.sql,item.values)).rows[0];if(actual.count!==item.count||actual.digest!==item.digest)fail('INSTALL_DATA_PRESERVATION_FAILED');}}
function inventorySummary(inventory){return {tables:inventory.length,rows:inventory.reduce((sum,item)=>sum+item.count,0),sha256:hash(inventory.map(({relation,count,digest})=>({relation,count,digest})))};}
async function install({central,tenant,state,stateFiles=[],checkpoint=async()=>{}}={}){
 if(!central?.connect||!central?.query||!tenant?.connect||!tenant?.query||typeof checkpoint!=='function')fail('INSTALL_ARGUMENTS_INVALID');validateState(state,stateFiles);
 const report={version:'opportunity-v2-habitual-install-v1',packageId:pkg.PACKAGE_ID,packageDigest:pkg.packageDigest,status:'RUNNING',migrationsMayHaveCommitted:false,configurationWritten:false,stages:[]};
 const step=async(stage,details={})=>{report.stage=stage;report.stages.push({stage,at:new Date().toISOString(),...details});await checkpoint({stage,...details,migrationsMayHaveCommitted:report.migrationsMayHaveCommitted});};
 try{
  const centralPreflight=require('../backend/src/security/centralMigrationPreflight').preflightCentral,tenantPreflight=require('../backend/src/security/tenantMigrationPreflight').preflightTenant;
  const identity={tenantId:state.tenantId,databaseGenerationId:state.generationId};
  for(const [pool,database]of [[central,state.target.centralDatabase],[tenant,state.target.tenantDatabase]])if((await pool.query('SELECT current_database() AS name')).rows[0]?.name!==database)fail('INSTALL_DATABASE_TARGET_CHANGED');
  const beforeCentral=await centralPreflight(central),beforeTenant=await tenantPreflight(tenant,identity,undefined,{timeoutMs:30000});
  if(![pkg.CENTRAL_BASELINE,pkg.centralEntries.at(-1).version].includes(beforeCentral.currentVersion)||![pkg.TENANT_BASELINE,pkg.tenantAddition.version].includes(beforeTenant.currentVersion))fail('INSTALL_BASELINE_UNSUPPORTED');
  const directory=require('../backend/src/security/tenantDirectoryRepository').createTenantDirectoryRepository(central),publishedBefore=await directory.resolveSnapshotByOrganization(state.organizationId,'API');verifyPublished(state.snapshot,publishedBefore);for(const file of stateFiles)for(const binding of file.value.bindings)if(binding.organizationId===state.organizationId)verifyPublished(binding.snapshot,publishedBefore);
  const tenants=(await central.query('SELECT tenant_id,organization_id FROM public.tenant ORDER BY tenant_id')).rows;if(tenants.length!==1||tenants[0].tenant_id!==state.tenantId||tenants[0].organization_id!==state.organizationId)fail('INSTALL_TENANT_SCOPE_CHANGED');
  const generations=(await central.query('SELECT tenant_id,database_generation_id,database_ref FROM public.tenant_database_generation WHERE retired_at IS NULL')).rows;if(generations.length!==1||generations[0].tenant_id!==state.tenantId||generations[0].database_generation_id!==state.generationId||generations[0].database_ref!==state.target.tenantDatabase)fail('INSTALL_GENERATION_CHANGED');
  const {pendingWork,isQuiescentWork}=require('../backend/scripts/localPlatform/backupOpportunityV2');for(const [scope,pool]of [['central',central],['tenant',tenant]])if(!isQuiescentWork(await pendingWork(pool,scope),scope))fail('INSTALL_PENDING_WORK');
  const oldIdentity=await currentIdentity(central),inventories={central:await capture(central,{central:true,tenantId:state.tenantId}),tenant:await capture(tenant)};
  report.before={centralVersion:beforeCentral.currentVersion,centralFingerprint:beforeCentral.fingerprint,tenantVersion:beforeTenant.currentVersion,tenantFingerprint:beforeTenant.schemaFingerprint,central:inventorySummary(inventories.central),tenant:inventorySummary(inventories.tenant),opportunityId:oldIdentity.opportunity_id,revisionId:oldIdentity.current_revision_id,rowVersion:Number(oldIdentity.row_version)};
  await step('PRECHECK_PASSED',report.before);
  report.migrationsMayHaveCommitted=true;await step('CENTRAL_APPLY_STARTED');
  report.centralApplied=await require('../backend/scripts/runCentralMigrations').applyRegisteredCentralPackage(central,pkg.PACKAGE_ID);await step('CENTRAL_APPLIED',{applied:report.centralApplied});
  const schemaRow=(await central.query('SELECT * FROM public.tenant_schema_state WHERE tenant_id=$1',[state.tenantId])).rows[0];if(!schemaRow)fail('INSTALL_SCHEMA_STATE_MISSING');
  const idempotencyKey='opportunity-v2-install:'+state.installationId+':'+pkg.packageDigest.slice(0,24),correlationId=state.installationId;
  const prior=(await central.query("SELECT event_id FROM public.tenant_directory_event WHERE idempotency_key=$1 AND action_code='SCHEMA_OBSERVED'",[idempotencyKey])).rows;
  if(prior.length>1||prior.length===1&&schemaRow.current_version!==pkg.tenantAddition.version)fail('INSTALL_SCHEMA_REPLAY_CONFLICT');
  const expectedRevision=Number(schemaRow.revision)-(prior.length?1:0);if(!Number.isSafeInteger(expectedRevision)||expectedRevision<1)fail('INSTALL_SCHEMA_REVISION_INVALID');
  await step('TENANT_APPLY_STARTED',{expectedRevision,idempotencyKey,correlationId});
  const publisher=require('../backend/src/security/tenantSchemaObservationPublisher').createTenantSchemaObservationPublisher(require('../backend/src/security/tenantSchemaRepository').createTenantSchemaRepository(central));
  const runner=require('../backend/src/security/tenantMigrationRunner').createRegisteredTenantMigrationRunner({packageId:pkg.PACKAGE_ID,pool:tenant,observationPublisher:publisher,timeoutMs:30000,scheduler:{setTimeout,clearTimeout}});
  const result=await runner.migrate({...identity,expectedRevision,correlationId,idempotencyKey});report.tenantApplied=result.appliedVersions;await step('TENANT_APPLIED',{applied:report.tenantApplied});
  const finalCentral=await centralPreflight(central),finalTenant=await tenantPreflight(tenant,identity,undefined,{timeoutMs:30000});
  if(finalCentral.currentVersion!==pkg.centralEntries.at(-1).version||finalTenant.currentVersion!==pkg.tenantAddition.version)fail('INSTALL_FINAL_SCHEMA_MISMATCH');
  await assertPreserved(central,inventories.central);await assertPreserved(tenant,inventories.tenant);same(await currentIdentity(central),oldIdentity,'INSTALL_11145_CHANGED');
  const published=await directory.resolveSnapshotByOrganization(state.organizationId,'API'),configuration=configurationAfter(state,stateFiles,published);
  const finalSchema=(await central.query('SELECT * FROM public.tenant_schema_state WHERE tenant_id=$1',[state.tenantId])).rows[0];if(finalSchema.current_version!==pkg.tenantAddition.version||finalSchema.target_version!==pkg.tenantAddition.version||Number(finalSchema.revision)!==expectedRevision+1)fail('INSTALL_SCHEMA_PUBLICATION_MISMATCH');
  report.after={centralVersion:finalCentral.currentVersion,centralFingerprint:finalCentral.fingerprint,tenantVersion:finalTenant.currentVersion,tenantFingerprint:finalTenant.schemaFingerprint,schemaRevision:Number(finalSchema.revision),publicationIdempotencyKey:idempotencyKey};
  report.preservation={oldColumnsAndRows:true,centralLedgerPrefix035:true,tenantLedgerPrefix033:true,known11145Unchanged:true,tenantIdentityAndGeneration:true,credentialsAndOtherBindings:true,privateApplicationAndInterestSnapshots:true};report.configurationPatch={runtime:['opportunityActivation','snapshot.schema','snapshot.connectionRevision','snapshot.fence'],bindingStamps:{before:{connectionRevision:state.snapshot.connectionRevision,fence:state.snapshot.fence},after:{connectionRevision:published.connectionRevision,fence:published.fence},source:'NORMAL_CENTRAL_DIRECTORY',monotonic:true},files:stateFiles.map(file=>({relative:file.relative,paths:['bindings[organizationId='+state.organizationId+'].snapshot.schema']}))};
  await step('INSTALL_VERIFIED',report.after);report.status='PASS';return {...configuration,report};
 }catch(error){report.status='FAIL';const safe=Object.assign(new Error('OPPORTUNITY_INSTALL_FAILED'),{code:error.code&&/^[A-Z0-9_]+$/.test(error.code)?error.code:'OPPORTUNITY_INSTALL_FAILED',installationStage:report.stage,migrationsMayHaveCommitted:report.migrationsMayHaveCommitted,report});throw safe;}
}
module.exports={ACTIVATION,MEMBERS_FILE,validateState,configurationAfter,capture,assertPreserved,inventorySummary,install};
