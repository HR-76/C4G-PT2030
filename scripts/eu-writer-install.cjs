'use strict';
// Explicit paused installation port. No CLI, files, configuration writes,
// supervisor, approval fabrication, source mutation or collection enqueue.
const {isDeepStrictEqual}=require('node:util');
const {cloneData}=require('../backend/src/opportunities/v2/data');
const {validateEuWriterWindowPlan}=require('../backend/src/opportunities/v2/euWriterWindowPlan');
const {rawSnapshotDigest}=require('../backend/src/opportunities/v2/reconciliation');
const {contentDigestV2}=require('../backend/src/opportunities/v2/digests');
const {implementationDigest}=require('../backend/src/opportunities/v2/activationArchive');
const {euWriterConfiguration}=require('../backend/src/fundingTenders/euWriter');
const {bindingDigest}=require('../backend/src/security/localTenantCredentialAdapter');
const pkg=require('../backend/src/security/opportunityEuWriterMigrationPackage');
const previous=require('../backend/src/security/opportunityV2MigrationPackage');
const {registeredManifest:tenantManifest}=require('../backend/src/security/tenantMigrationManifest');
const {assertPreserved,inventorySummary}=require('./opportunity-v2-install.cjs');
const {pendingWork,isQuiescentWork,assertScopeRows}=require('../backend/scripts/localPlatform/backupOpportunityV2');
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/,IDENTIFIER=/^[a-z][a-z0-9_]{0,62}$/,SHA=/^[a-f0-9]{64}$/;
const quote=value=>'"'+value.replaceAll('"','""')+'"';
const HELPERS=Object.freeze([
 'opportunity_catalog.assert_eu_writer_execution_v2(uuid,bigint,integer,uuid,bigint,text,text,text,text)',
 'opportunity_catalog.begin_eu_writer_v2(uuid,bigint,integer,uuid,bigint,text,text,text,text,text,text,uuid,uuid,bigint,text)',
 'opportunity_catalog.assert_eu_writer_permit_v2(uuid)',
 'opportunity_catalog.claim_eu_writer_run_v2(uuid,integer,uuid,bigint,text,text,text,text)',
 'opportunity_catalog.release_eu_writer_retry_v2(uuid,bigint,integer,uuid,bigint,text,text,text,text)'
]);
function fail(code){throw Object.assign(Error(code),{code});}
function same(a,b,code){if(!isDeepStrictEqual(a,b))fail(code);}
function validateState(state){
 if(!state||state.phase!=='READY'||!['installationId','organizationId','tenantId','generationId'].every(k=>UUID.test(state[k]||''))||Object.hasOwn(state,'opportunityEuWriter'))fail('EU_WRITER_INSTALL_STATE');
 const t=state.target,c=state.credentials,s=state.snapshot;
 if(!t||!['localhost','127.0.0.1','::1'].includes(t.host)||!Number.isSafeInteger(t.port)||t.port<1||t.port>65535||!IDENTIFIER.test(t.centralDatabase||'')||!IDENTIFIER.test(t.tenantDatabase||'')||t.centralDatabase===t.tenantDatabase
  ||!c||c.tenantId!==state.tenantId||c.host!==t.host||c.port!==t.port||c.database!==t.tenantDatabase||!IDENTIFIER.test(c.login||'')||typeof c.password!=='string'||!c.password||typeof c.ssl!=='boolean'||c.workload!==undefined&&c.workload!=='API'
  ||!s||s.organizationId!==state.organizationId||s.tenantId!==state.tenantId||s.databaseGenerationId!==state.generationId||s.databaseRef!==t.tenantDatabase||s.credentialRef!==c.credentialRef||s.workload!=='API'||s.connectionVersion!==c.connectionVersion||s.versionState!=='VALIDATED'||s.provisioningStatus!=='READY'||s.connectionState!=='AVAILABLE'||s.deploymentMode!=='DATABASE_PER_ORGANIZATION'
  ||!Number.isSafeInteger(s.connectionRevision)||s.connectionRevision<1||!Number.isSafeInteger(s.fence)||s.fence<0||! /^[0-9]+$/.test(s.observedSystemIdentifier||'')||s.bindingDigest!==bindingDigest({...c,workload:'API'})
  ||s.schema?.currentVersion!==previous.tenantAddition.version||s.schema.schemaFingerprint!==previous.tenantAddition.schemaFingerprint||s.schema.compatibilityState!=='COMPATIBLE'||s.schema.verifiedCapabilities?.[previous.TENANT_CAPABILITY]!==true||!Number.isSafeInteger(s.schema.revision)||s.schema.revision<1)fail('EU_WRITER_INSTALL_BINDING');
 same(state.opportunityActivation,{packageId:previous.PACKAGE_ID,runtime:'authenticated-v2',executor:'bounded-v2'},'EU_WRITER_INSTALL_ACTIVATION');
 if(state.funding?.source!=='live-local'||state.funding?.coverage!=='durable-v1')fail('EU_WRITER_INSTALL_FUNDING');
 return true;
}
function configurationAfter(state){
 validateState(state);const next=cloneData(state,{maxBytes:2*1024*1024,maxDepth:40});
 next.opportunityEuWriter={packageId:pkg.PACKAGE_ID,...euWriterConfiguration()};
 const check=cloneData(next,{maxBytes:2*1024*1024,maxDepth:40});delete check.opportunityEuWriter;same(check,state,'EU_WRITER_INSTALL_CONFIGURATION_SCOPE');return next;
}
function sourceBefore(value,fence){
 const zero=['queuedRuns','pendingRuns','otherPendingRuns','activeRunLeases','activeInboxLeases','activeOutboxLeases','expiredPendingRuns','unrecoverablePendingRuns'];
 if(!value||value.family!=='EU_FUNDING_TENDERS'||value.state!=='QUIESCED'||!Number.isSafeInteger(value.fence)||value.fence!==fence||zero.some(k=>value[k]!==0)||!Number.isSafeInteger(value.acceptedV2)||value.acceptedV2<1
  ||Object.hasOwn(value,'writerMode')&&(value.writerMode!=='LEGACY_V1'||value.writerPolicy!==null||value.writerMappingDigest!==null||value.incompatiblePendingRuns!==0))fail('EU_WRITER_INSTALL_SOURCE_CHANGED');
 return {family:value.family,state:value.state,fence:value.fence,...Object.fromEntries(zero.map(k=>[k,0])),acceptedV2:value.acceptedV2};
}
function assertHead({plan,identities,row,receipts,protectedState}){
 if(!Array.isArray(identities)||identities.length!==1||identities[0].opportunity_id!==plan.expected.opportunityId||!row||row.opportunity_id!==plan.expected.opportunityId||row.current_revision_id!==plan.expected.revisionId||! /^[1-9][0-9]*$/.test(String(row.row_version))||!Number.isSafeInteger(Number(row.row_version))||Number(row.row_version)!==plan.expected.rowVersion||row.current_schema_version!==2||row.lifecycle_state!=='ACTIVE'||row.content_digest!==plan.accepted.contentDigest
  ||rawSnapshotDigest(row.snapshot)!==plan.accepted.snapshotDigest||contentDigestV2(row.snapshot)!==plan.accepted.contentDigest||protectedState!==false)fail('EU_WRITER_INSTALL_HEAD_CHANGED');
 const mapping=implementationDigest('EU_FUNDING_TENDERS',row.snapshot.provenance.mappingVersion);
 if(!Array.isArray(receipts)||!receipts.length||receipts.some(r=>r.mapping_digest!==mapping))fail('EU_WRITER_INSTALL_RECEIPT_CHANGED');
 return true;
}
async function inspectHead(client,plan){
 const identities=(await client.query("SELECT opportunity_id FROM opportunity_catalog.funding_identity WHERE external_identifier='CASCADE:11145' UNION SELECT opportunity_id FROM opportunity_catalog.source_identity_v2 WHERE source_namespace='EU_FUNDING_TENDERS' AND external_identifier='CASCADE:11145'")).rows;
 const row=(await client.query('SELECT o.opportunity_id,o.current_revision_id,o.row_version,o.current_schema_version,o.lifecycle_state,o.content_digest,r.snapshot FROM opportunity_catalog.opportunity o JOIN opportunity_catalog.revision r ON r.opportunity_id=o.opportunity_id AND r.revision_id=o.current_revision_id WHERE o.opportunity_id=$1',[plan.expected.opportunityId])).rows[0];
 const receipts=(await client.query('SELECT mapping_digest FROM opportunity_catalog.accepted_receipt_v2 WHERE opportunity_id=$1 AND revision_id=$2 ORDER BY recorded_at DESC,request_id DESC',[plan.expected.opportunityId,plan.expected.revisionId])).rows;
 const protectedState=(await client.query("SELECT EXISTS(SELECT 1 FROM opportunity_catalog.funding_identity WHERE opportunity_id=$1 AND (corrections<>'{}'::jsonb OR conflicts<>'[]'::jsonb)) OR EXISTS(SELECT 1 FROM opportunity_catalog.funding_resolution WHERE opportunity_id=$1) AS protected",[plan.expected.opportunityId])).rows[0]?.protected;
 assertHead({plan,identities,row,receipts,protectedState});return {...plan.expected,contentDigest:plan.accepted.contentDigest,snapshotDigest:plan.accepted.snapshotDigest,mappingDigest:receipts[0].mapping_digest};
}
async function capture(client,{central=false}={}){
 const tables=(await client.query("SELECT n.nspname,c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE c.relkind IN ('r','p') AND n.nspname NOT LIKE 'pg_%' AND n.nspname<>'information_schema' ORDER BY 1,2")).rows,inventory=[];
 for(const table of tables){
  if(!IDENTIFIER.test(table.nspname)||!IDENTIFIER.test(table.relname))fail('EU_WRITER_INSTALL_RELATION');
  const relation=quote(table.nspname)+'.'+quote(table.relname),names=(await client.query('SELECT column_name FROM information_schema.columns WHERE table_schema=$1 AND table_name=$2 ORDER BY ordinal_position',[table.nspname,table.relname])).rows.map(r=>r.column_name);
  if(!names.length||names.some(n=>!IDENTIFIER.test(n)))fail('EU_WRITER_INSTALL_RELATION');
  const filter=central&&table.nspname==='public'&&table.relname==='c4g_schema_migration'?" WHERE version<='042_opportunity_eu_source_control_v2'":'';
  const sql=`SELECT count(*)::integer AS count,encode(sha256(convert_to(coalesce(string_agg(encode(sha256(convert_to(to_jsonb(t)::text,'UTF8')),'hex'),'' ORDER BY to_jsonb(t)::text),''),'UTF8')),'hex') AS digest FROM (SELECT ${names.map(quote).join(',')} FROM ${relation}${filter}) t`;
  const value=(await client.query(sql)).rows[0];if(!value||!Number.isSafeInteger(value.count)||value.count<0||!SHA.test(value.digest||''))fail('EU_WRITER_INSTALL_INVENTORY');
  inventory.push({relation,sql,values:[],count:value.count,digest:value.digest});
 }
 return inventory;
}
async function readonly(pool,work){const client=await pool.connect();try{await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');return await work(client);}finally{await client.query('ROLLBACK').catch(()=>{});client.release();}}
async function scope(central,state){
 return assertScopeRows({tenants:(await central.query('SELECT tenant_id,organization_id FROM public.tenant ORDER BY tenant_id')).rows,
  generations:(await central.query('SELECT tenant_id,database_generation_id,database_ref FROM public.tenant_database_generation WHERE retired_at IS NULL ORDER BY database_generation_id')).rows,
  connections:(await central.query("SELECT tenant_id,database_generation_id,database_ref FROM public.organization_connection_version WHERE version_state NOT IN ('REVOKED','FAILED') ORDER BY tenant_id,connection_version")).rows},state.target,state);
}
async function privateBinding(central,state){
 // Reuse the actual API verifier, including its login/role/grant checks and F4
 // physical metadata path. Credentials stay in memory and never enter report.
 const {Pool}=require('../backend/node_modules/pg'),credentials={...state.credentials};delete credentials.workload;
 const runtime=require('../backend/src/config/opportunityRuntime').createConfiguredOpportunityRuntime({centralPool:central,env:{OPPORTUNITY_API_CREDENTIALS_JSON:JSON.stringify([credentials]),OPPORTUNITY_ALLOWED_RESIDENCY_JSON:JSON.stringify([{regionCode:state.snapshot.regionCode,policyVersion:state.snapshot.residencyPolicyVersion}])}});
 const pool=new Pool({host:credentials.host,port:credentials.port,database:credentials.database,user:credentials.login,password:credentials.password,ssl:credentials.ssl?{rejectUnauthorized:true}:false,max:1,connectionTimeoutMillis:5000,options:'-c timezone=UTC -c statement_timeout=30000 -c lock_timeout=3000'});
 try{const client=await pool.connect();try{await runtime.bindingVerifier.verify({client,snapshot:state.snapshot,requiredCapabilities:[previous.TENANT_CAPABILITY],correlationId:state.installationId,phase:'PREPARATION'});}finally{client.release();}return {physicalApiLogin:true,normalBindingVerifier:true,tenantVersion:previous.tenantAddition.version,identityAndGeneration:true};}
 finally{await Promise.all([pool.end(),runtime.poolManager.closeAll()]);}
}
async function verifyWorkerLogin(pool,database){
 const client=await pool.connect();try{
  await client.query('BEGIN READ ONLY');
  const row=(await client.query('SELECT session_user AS login,current_user AS role,current_database() AS database,r.rolcanlogin AS can_login,r.rolsuper AS superuser FROM pg_roles r WHERE r.rolname=session_user')).rows[0];
  if(!row||!IDENTIFIER.test(row.login||'')||row.login!==row.role||row.database!==database||row.can_login!==true||typeof row.superuser!=='boolean')fail('EU_WRITER_INSTALL_WORKER_LOGIN');
  const forbidden=(await client.query(`SELECT r.rolname AS role,(pg_has_role(r.oid,'c4g_eu_writer_runtime','SET') OR EXISTS(SELECT 1 FROM unnest($1::text[]) h(signature) WHERE has_function_privilege(r.oid,to_regprocedure(h.signature),'EXECUTE'))) AS forbidden FROM pg_roles r WHERE r.rolname IN ('c4g_opportunity_central_runtime','c4g_catalog_reader') ORDER BY r.rolname`,[HELPERS])).rows;
  if(forbidden.length!==2||forbidden.some(r=>r.forbidden!==false)||!['c4g_opportunity_central_runtime','c4g_catalog_reader'].every(role=>forbidden.some(r=>r.role===role)))fail('EU_WRITER_INSTALL_ROLE_BOUNDARY');
  await client.query('SET LOCAL ROLE c4g_eu_writer_runtime');
  const helpers=(await client.query("SELECT h.signature AS signature,to_regprocedure(h.signature) IS NOT NULL AS present,has_function_privilege(current_user,to_regprocedure(h.signature),'EXECUTE') AS allowed,current_user AS role FROM unnest($1::text[]) h(signature) ORDER BY h.signature",[HELPERS])).rows;
  if(helpers.length!==HELPERS.length||helpers.some(r=>r.present!==true||r.allowed!==true||r.role!=='c4g_eu_writer_runtime')||HELPERS.some(h=>helpers.filter(r=>r.signature===h).length!==1))fail('EU_WRITER_INSTALL_HELPER_ACCESS');
  return {physicalLogin:true,login:row.login,superuser:row.superuser,leastPrivilegeCertified:false,setRoleVerified:true,helpers:HELPERS.length,humanAndReaderDenied:true,compositionBinding:'CALLER_PROVIDED_CENTRAL_POOL_IS_NATIVE_WORKER_CONNECTION'};
 }finally{await client.query('ROLLBACK').catch(()=>{});client.release();}
}
async function install({central,tenant,state:rawState,plan:rawPlan,checkpoint=async()=>{}}={}){
 if(!central?.connect||!central?.query||!tenant?.connect||!tenant?.query||typeof checkpoint!=='function')fail('EU_WRITER_INSTALL_ARGUMENTS');
 const state=cloneData(rawState,{maxBytes:2*1024*1024,maxDepth:40}),plan=validateEuWriterWindowPlan(rawPlan);validateState(state);
 const report={version:'eu-writer-habitual-install-v1',packageId:pkg.PACKAGE_ID,packageDigest:pkg.packageDigest,status:'RUNNING',migrationsMayHaveCommitted:false,configurationWritten:false,sourceResumed:false,stages:[]};
 const step=async(stage,details={})=>{report.stage=stage;report.stages.push({stage,at:new Date().toISOString(),...details});await checkpoint({stage,...details,migrationsMayHaveCommitted:report.migrationsMayHaveCommitted});};
 try{
  const centralPreflight=require('../backend/src/security/centralMigrationPreflight').preflightCentral,tenantPreflight=require('../backend/src/security/tenantMigrationPreflight').preflightTenant,identity={tenantId:state.tenantId,databaseGenerationId:state.generationId};
  for(const [pool,database]of [[central,state.target.centralDatabase],[tenant,state.target.tenantDatabase]])if((await pool.query('SELECT current_database() AS database')).rows[0]?.database!==database)fail('EU_WRITER_INSTALL_DATABASE_TARGET');
  const beforeCentral=await centralPreflight(central),beforeTenant=await tenantPreflight(tenant,identity,tenantManifest,{timeoutMs:30000});
  if(![pkg.CENTRAL_BASELINE,pkg.entry.version].includes(beforeCentral.currentVersion)||beforeCentral.postgresMajor!==18||beforeTenant.currentVersion!==previous.tenantAddition.version||beforeTenant.schemaFingerprint!==previous.tenantAddition.schemaFingerprint||beforeTenant.systemIdentifier!==state.snapshot.observedSystemIdentifier)fail('EU_WRITER_INSTALL_BASELINE');
  const directory=require('../backend/src/security/tenantDirectoryRepository').createTenantDirectoryRepository(central),published=await directory.resolveSnapshotByOrganization(state.organizationId,'API');same(published,state.snapshot,'EU_WRITER_INSTALL_DIRECTORY_CHANGED');
  report.scope=await scope(central,state);report.privateBinding=await privateBinding(central,state);
  for(const [name,pool]of [['central',central],['tenant',tenant]])if(!isQuiescentWork(await pendingWork(pool,name),name))fail('EU_WRITER_INSTALL_PENDING_WORK');
  const baseline=await readonly(central,async client=>({source:sourceBefore((await client.query('SELECT opportunity_catalog.eu_source_state_v2() AS state')).rows[0]?.state,plan.source.fence),head:await inspectHead(client,plan),inventory:await capture(client,{central:true})}));
  const tenantInventory=await readonly(tenant,client=>capture(client));
  report.before={centralVersion:beforeCentral.currentVersion,centralFingerprint:beforeCentral.fingerprint,tenantVersion:beforeTenant.currentVersion,tenantFingerprint:beforeTenant.schemaFingerprint,central:inventorySummary(baseline.inventory),tenant:inventorySummary(tenantInventory),head:baseline.head,source:baseline.source,recoveryReplay:beforeCentral.currentVersion===pkg.entry.version};
  await step('PRECHECK_PASSED',report.before);
  // The orchestrator owns the distributed pause, backup boundary and persisted
  // administrative authority lock. Recheck our immutable plan before SQL starts.
  validateEuWriterWindowPlan(plan);report.migrationsMayHaveCommitted=true;await step('CENTRAL_APPLY_STARTED');
  report.centralApplied=await require('../backend/scripts/runCentralMigrations').applyRegisteredEuWriterPackage(central,pkg.PACKAGE_ID);await step('CENTRAL_APPLIED',{applied:report.centralApplied});
  const finalCentral=await centralPreflight(central),finalTenant=await tenantPreflight(tenant,identity,tenantManifest,{timeoutMs:30000});
  if(finalCentral.currentVersion!==pkg.entry.version||finalCentral.fingerprint!==pkg.entry.schemaFingerprint||finalTenant.currentVersion!==beforeTenant.currentVersion||finalTenant.schemaFingerprint!==beforeTenant.schemaFingerprint||finalTenant.systemIdentifier!==beforeTenant.systemIdentifier)fail('EU_WRITER_INSTALL_FINAL_BASELINE');
  await assertPreserved(central,baseline.inventory);await assertPreserved(tenant,tenantInventory);
  same(await directory.resolveSnapshotByOrganization(state.organizationId,'API'),published,'EU_WRITER_INSTALL_DIRECTORY_CHANGED');same(await scope(central,state),report.scope,'EU_WRITER_INSTALL_SCOPE_CHANGED');
  const finalSource=sourceBefore((await central.query('SELECT opportunity_catalog.eu_source_state_v2() AS state')).rows[0]?.state,plan.source.fence);same(finalSource,baseline.source,'EU_WRITER_INSTALL_SOURCE_CHANGED');same(await inspectHead(central,plan),baseline.head,'EU_WRITER_INSTALL_HEAD_CHANGED');
  report.worker=await verifyWorkerLogin(central,state.target.centralDatabase);report.privateBindingAfter=await privateBinding(central,state);
  const nextState=configurationAfter(state);
  report.after={centralVersion:finalCentral.currentVersion,centralFingerprint:finalCentral.fingerprint,tenantVersion:finalTenant.currentVersion,tenantFingerprint:finalTenant.schemaFingerprint,source:finalSource};
  report.preservation={preexistingColumnsAndRows:true,centralLedgerPrefix042:true,tenantLedger034Complete:true,tenantDirectoryUnchanged:true,privateApplicationsAndInterests:true,known11145Unchanged:true,configurationDeltaOnly:'opportunityEuWriter'};
  report.configurationPatch={runtime:['opportunityEuWriter'],value:nextState.opportunityEuWriter};
  await step('INSTALL_VERIFIED',report.after);report.status='PASS';return {state:nextState,report};
 }catch(error){report.status='FAIL';throw Object.assign(Error('EU_WRITER_INSTALL_FAILED'),{code:/^(EU_WRITER_INSTALL_|INSTALL_)[A-Z0-9_]+$/.test(error.code||'')?error.code:'EU_WRITER_INSTALL_FAILED',installationStage:report.stage,migrationsMayHaveCommitted:report.migrationsMayHaveCommitted,report});}
}
module.exports={HELPERS,validateState,configurationAfter,sourceBefore,assertHead,capture,assertPreserved,inventorySummary,verifyWorkerLogin,install};
