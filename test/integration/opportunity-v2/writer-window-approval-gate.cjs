'use strict';
// Runs inside the owned EU writer gate while the physical schema is still042.
// Evidence/configuration below are declared fixtures in a separate owned root;
// this proves approval enforcement, not a habitual pause, backup or OIDC login.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {randomUUID,createHash}=require('node:crypto');
const root=path.resolve(__dirname,'../../..');
const hash=value=>createHash('sha256').update(value).digest('hex');
const pkg=require('../../../backend/src/security/opportunityEuWriterMigrationPackage');
const installed=require('../../../backend/src/security/opportunityV2MigrationPackage');
const {createUuidV7}=require('../../../backend/src/audit/uuidV7');
const {rawSnapshotDigest}=require('../../../backend/src/opportunities/v2/reconciliation');
const {contentDigestV2}=require('../../../backend/src/opportunities/v2/digests');
const {snapshot,preserved}=require('./registered-package-proof.cjs');

function write(rootPath,relative,bytes){const file=path.join(rootPath,relative);assert(file.startsWith(rootPath+path.sep));fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,bytes);return {path:relative,sha256:hash(bytes)};}
function json(rootPath,relative,value){return write(rootPath,relative,JSON.stringify(value,null,2)+'\n');}
function workspace(outputDirectory){const folder=path.join(outputDirectory,'window-approval-fixture-workspace');assert(!fs.existsSync(folder));fs.mkdirSync(folder);return folder;}
function planFixture({workspaceRoot,candidate,accepted,source,mutate=()=>{},evidenceMutate=()=>{}}){
 const {ACTIONS,CONTROLLED_CYCLE,PRIVATE_FILES,planDigest}=require('../../../backend/src/opportunities/v2/euWriterWindowPlan');
 const windowId=randomUUID(),prefix='output/opportunity-eu-writer-window-'+windowId,now=Date.now();
 const inputs={},configuration={};
 for(const file of ['backend/src/opportunities/v2/euWriterWindowPlan.js','backend/src/opportunities/v2/writerWindowApproval.js','backend/src/opportunities/v2/activationHttp.js','backend/src/security/opportunityEuWriterMigrationPackage.js','backend/scripts/localPlatform/backupOpportunityV2.js'])inputs[file]=write(workspaceRoot,file,fs.readFileSync(path.join(root,file))).sha256;
 for(const file of PRIVATE_FILES){const bytes='Isolated synthetic configuration. No real credential or habitual configuration. '+file+'\n';configuration[file]={copied:true,sha256:write(workspaceRoot,file,bytes).sha256};}
 const plan={kind:'eu-writer-window-plan-v1',windowId,createdAt:new Date(now-1000).toISOString(),expiresAt:new Date(now+1800000).toISOString(),
  package:{packageId:pkg.PACKAGE_ID,packageDigest:pkg.packageDigest,sqlSha256:pkg.entry.upChecksum},
  baseline:{centralVersion:pkg.CENTRAL_BASELINE,tenantVersion:installed.tenantAddition.version,centralFingerprint:installed.centralEntries.at(-1).schemaFingerprint,tenantFingerprint:installed.tenantAddition.schemaFingerprint},
  writer:require('../../../backend/src/fundingTenders/euWriter').euWriterConfiguration(),source:{state:'QUIESCED',fence:source.fence},
  expected:{opportunityId:accepted.opportunityId,revisionId:accepted.revisionId,rowVersion:Number(accepted.rowVersion)},accepted:{contentDigest:contentDigestV2(candidate),snapshotDigest:rawSnapshotDigest(candidate)},evidence:{},inputs,actions:[...ACTIONS],controlledCycle:{...CONTROLLED_CYCLE}};
 mutate(plan);
 const preview={readOnly:true,fixtureOnly:true,source:{candidateSnapshot:candidate,mappingDigest:require('../../../backend/src/opportunities/v2/activationArchive').implementationDigest('EU_FUNDING_TENDERS',candidate.provenance.mappingVersion),metadata:{observedAt:new Date(now-2000).toISOString()}},central:{value:{expected:plan.expected,acceptedSnapshot:candidate,sourceControl:plan.source,version:plan.baseline.centralVersion,fingerprint:plan.baseline.centralFingerprint}},tenant:{value:{version:plan.baseline.tenantVersion,fingerprint:plan.baseline.tenantFingerprint}}};
 const backup={status:'PASS',fixtureOnly:true,profile:'EU_WRITER_PREPARATION',windowId,packageDigest:pkg.packageDigest,cleanup:true,noSourceDrift:true,aclRestricted:true,completedAt:new Date(Date.parse(plan.createdAt)-1000).toISOString(),configuration,
  baselines:Object.fromEntries(['central','tenant'].map(name=>[name,{version:plan.baseline[name+'Version'],fingerprint:plan.baseline[name+'Fingerprint']}])),databases:{central:{dataMatches:true,sourceStillMatches:true,preflight:true},tenant:{dataMatches:true,sourceStillMatches:true,preflight:true}}};
 const gate={gateType:'OPPORTUNITY_V2_EU_WRITER',status:'PASS',fixtureOnly:true,isolated:true,cleanup:true,habitualEnvironmentAccess:false,packageDigest:pkg.packageDigest,package:{id:pkg.PACKAGE_ID,digest:pkg.packageDigest,entry:pkg.entry},checks:['EU_WRITER_REAL_QUEUE_ARCHIVE_UNCHANGED_PRESERVES_HEAD','EU_WRITER_SAFE_CHANGE_ONE_REVISION_AND_NORMALIZED_SQL','EU_WRITER_LOSS_AND_NEW_IDENTITIES_REQUIRE_DURABLE_REVIEW','EU_WRITER_TRANSIENT_RETRY_PRESERVES_LINEAGE_AND_ORIGINAL_DEADLINE','EXECUTOR_PHYSICAL_READERS_V1_V2_SQL_AND_TENANT_RLS_PRESERVATION'].map(name=>({name,status:'PASS',fixtureOnly:true})),inputHashes:inputs};
 const validation={status:'PASS',fixtureOnly:true,packageDigest:pkg.packageDigest,inputs,gate:json(workspaceRoot,prefix+'/gate-fixture.json',gate)};
 evidenceMutate({preview,backup,validation});
 for(const [name,value]of Object.entries({preview,backup,validation}))plan.evidence[name]=json(workspaceRoot,prefix+'/'+name+'-fixture.json',value);
 const file=path.join(workspaceRoot,prefix,'plan.json');json(workspaceRoot,prefix+'/plan.json',plan);
 return {plan,file,digest:planDigest(plan),route:'/eu-writer/windows/'+windowId};
}
async function catalogSnapshot(central){const all=await snapshot(central,{central:true});return Object.fromEntries(Object.entries(all).filter(([table])=>table.startsWith('"opportunity_catalog".')));}
async function windowApprovalProof({central,tenant,fixture,http,candidate,accepted,report,check,workspaceRoot}){
 const initial={catalog:await catalogSnapshot(central),tenant:await snapshot(tenant),ledger:(await central.query('SELECT * FROM public.c4g_schema_migration ORDER BY version')).rows,source:(await central.query('SELECT opportunity_catalog.eu_source_state_v2() AS state')).rows[0].state};
 assert.equal(initial.ledger.at(-1).version,pkg.CENTRAL_BASELINE);assert.equal(initial.source.state,'QUIESCED');
 const args={workspaceRoot,candidate,accepted,source:initial.source},valid=planFixture(args);
 const audit=async()=>Number((await central.query("SELECT count(*) AS n FROM audit.event WHERE event_code='SENSITIVE_ACTION_ALLOWED' AND event_data#>>'{resource,type}'='EU_WRITER_WINDOW'")).rows[0].n);
 const post=(value,actor=fixture.actor,requestId=createUuidV7(),digest=value.digest,options)=>http.request(actor,'POST',value.route+'/approve',{requestId,planDigest:digest},options);
 let receipt;
 await check('EU_WRITER_WINDOW042_GET_APPROVAL_REPLAY_REAL_AUTHORITY_AND_AUDIT',async()=>{
  const before=await audit(),read=await http.request(fixture.actor,'GET',valid.route);assert.equal(read.status,200,JSON.stringify(read));assert.equal(read.data.planDigest,valid.digest);assert.equal(read.data.scope,'PREPARATION_ONLY');assert.equal(await audit(),before);
  const requestId=createUuidV7(),first=await post(valid,fixture.actor,requestId);assert.equal(first.status,200,JSON.stringify(first));assert.equal(first.data.scope,'PREPARATION_ONLY');assert.equal(first.data.replayed,false);assert.equal(await audit(),before+1);
  const replay=await post(valid,fixture.actor,requestId);assert.equal(replay.status,200,JSON.stringify(replay));assert.equal(replay.data.replayed,true);assert.equal(replay.data.eventHash,first.data.eventHash);assert.equal(await audit(),before+1);receipt=first.data;
  assert.equal((await post(valid,fixture.actor,createUuidV7(),'f'.repeat(64))).status,409);assert.equal(await audit(),before+1);
 });
 await check('EU_WRITER_WINDOW042_REFUSES_DRIFT_EXPIRY_STALE_SOURCE_AND_HEAD',async()=>{
  const before=await audit(),cases=[];
  for(const [name,mutate,evidenceMutate]of [
   ['source-fence',p=>{p.source.fence++;}],['head-CAS',p=>{p.expected.rowVersion++;}],
   ['expired',p=>{p.createdAt=new Date(Date.now()-3600000).toISOString();p.expiresAt=new Date(Date.now()-1000).toISOString();}],
   ['candidate-drift',()=>{},e=>{e.preview.source.candidateSnapshot=structuredClone(candidate);e.preview.source.candidateSnapshot.description.title.value+=' isolated changed title';}],
   ['mapping-drift',()=>{},e=>{e.preview.source.mappingDigest='f'.repeat(64);}]
  ]){const value=planFixture({...args,mutate,evidenceMutate}),response=await post(value);assert.equal(response.status,409,name+':'+JSON.stringify(response));cases.push({name,code:response.data.error.code});}
  const fileDrift=planFixture(args);fs.appendFileSync(path.join(workspaceRoot,fileDrift.plan.evidence.preview.path),' ');const drift=await post(fileDrift);assert.equal(drift.status,409);cases.push({name:'evidence-bytes',code:drift.data.error.code});
  const changed=planFixture(args);changed.plan.expected.rowVersion++;fs.writeFileSync(changed.file,JSON.stringify(changed.plan));const response=await post(changed);assert.equal(response.status,409);cases.push({name:'plan-bytes',code:response.data.error.code});
  assert.equal(await audit(),before);report.windowApprovalNegatives=cases;
 });
 await check('EU_WRITER_WINDOW042_REFUSES_MISSING_AUTH_CSRF_STALE_AND_REVOKED_SESSION',async()=>{
  const before=await audit();assert.equal((await post(valid,null)).status,401);assert.equal((await post(valid,fixture.actor,createUuidV7(),valid.digest,{csrf:false})).status,403);
  const stale={...fixture.actor,sessionId:'window-stale-'+randomUUID()};await http.bind(stale,{stale:true});assert.equal((await post(valid,stale)).status,403);
  const revoked={...fixture.actor,sessionId:'window-revoked-'+randomUUID()};await http.bind(revoked);await http.registry.revokeSession(revoked.sessionId);assert.equal((await post(valid,revoked)).status,401);assert.equal((await post(valid,revoked,receipt.requestId)).status,401);
  assert.equal(await audit(),before);
 });
 await check('EU_WRITER_WINDOW042_APPROVAL_PRESERVES_SCHEMA_SOURCE_CATALOG_AND_PRIVATE_LINKS',async()=>{
  assert.deepEqual((await central.query('SELECT * FROM public.c4g_schema_migration ORDER BY version')).rows,initial.ledger);
  assert.deepEqual((await central.query('SELECT opportunity_catalog.eu_source_state_v2() AS state')).rows[0].state,initial.source);
  assert.deepEqual(await catalogSnapshot(central),initial.catalog);await preserved(tenant,initial.tenant);
  assert.equal((await require('../../../backend/src/security/centralMigrationPreflight').preflightCentral(central)).currentVersion,pkg.CENTRAL_BASELINE);
  const events=(await central.query("SELECT event_data,event_hash FROM audit.event WHERE stream_id='PLATFORM:OPERATIONS' ORDER BY sequence")).rows.map(row=>({...row.event_data,eventHash:row.event_hash}));assert.equal(require('../../../backend/src/audit/verifier').verifyEvents(events).valid,true);
  report.windowApproval={baseline:pkg.CENTRAL_BASELINE,tenantVersion:installed.tenantAddition.version,receipt,realHttpMiddleware:true,realAuthorityCoordinator:true,syntheticPersistedSession:true,realOidcLogin:false,syntheticEvidenceAndConfiguration:true,habitualBackupCertified:false,sourceFenceUnchanged:initial.source.fence,noMigration:true,noCandidateAcceptance:true,noSourceResume:true,auditEvents:await audit(),operationsAuditValid:true,ownedWorkspace:path.relative(root,workspaceRoot).replaceAll('\\','/')};
 });
}
module.exports={workspace,planFixture,windowApprovalProof};
