'use strict';
// Dedicated preparation backup. Source databases are read-only; only the newly
// owned local restore cluster is written. No migration or activation port exists.
const fs=require('node:fs'),path=require('node:path'),net=require('node:net'),assert=require('node:assert/strict');
const {spawnSync}=require('node:child_process');
const {createHash,randomUUID,randomBytes}=require('node:crypto');
const {Pool}=require('pg');
const cfg=require('./config');
const {target}=require('./prepareOpportunityInterests');
const {assertCopy,aclSupplement,ownedCluster}=require('./backupOpportunityInterests');
const {preflightCentral}=require('../../src/security/centralMigrationPreflight');
const {preflightTenant}=require('../../src/security/tenantMigrationPreflight');
const {tenantSchemaSnapshot,tenantSchemaFingerprint}=require('../../src/security/tenantSchemaFingerprint');
const {centralSchemaSnapshot}=require('../../src/security/centralSchemaManifest');
const BASELINES=Object.freeze({central:'035_funding_source_resolution',tenant:'033_organizational_opportunity_interests'});
const WRITER_PROFILE='EU_WRITER_PREPARATION';
const RECONCILIATION_PROFILE='EU_RECONCILIATION';
const LEGACY_PREARCHIVE_PROFILE='EU_LEGACY_PREARCHIVE';
const LEGACY_ACCEPTANCE_PROFILE='EU_LEGACY_ACCEPTANCE';
const writerPackage=require('../../src/security/opportunityEuWriterMigrationPackage');
const installedPackage=require('../../src/security/opportunityV2MigrationPackage');
const legacyPackage=require('../../src/security/opportunityEuLegacyPrearchiveMigrationPackage');
const acceptancePackage=require('../../src/security/opportunityEuLegacyAcceptancePackage');
const reconciliationPackage=require('../../src/security/opportunityEuReconciliationMigrationPackage');
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/,SHA=/^[a-f0-9]{64}$/;
const BIN='C:/Program Files/PostgreSQL/18/bin',proofs=new WeakMap();
const hash=value=>createHash('sha256').update(value).digest('hex'),fileHash=file=>hash(fs.readFileSync(file));
const quote=value=>'"'+value.replaceAll('"','""')+'"';
const PRIVATE_FILES=Object.freeze(['backend/.env','.tmp/local-platform/runtime.json','.tmp/local-platform/admissions/worker.json',
 '.tmp/local-platform/members/worker.json','.tmp/local-platform/members/http.json','.tmp/local-platform/members/c4g-activation.properties','.tmp/f2-integration/.env']);
function fail(code){throw Object.assign(Error(code),{code});}
function args(argv){if(!Array.isArray(argv)||argv.length!==1||argv[0]!=='--backup-and-restore')fail('OPPORTUNITY_BACKUP_MODE_REQUIRED');}
function validateReconciliationScope(value){
 if(!value||typeof value!=='object'||Object.keys(value).sort().join(',')!=='cycleId,previewDigest,runId,sourceFence'
  ||!UUID.test(value.cycleId||'')||!UUID.test(value.runId||'')||value.cycleId===value.runId||!Number.isSafeInteger(value.sourceFence)||value.sourceFence<1||!SHA.test(value.previewDigest||''))fail('OPPORTUNITY_BACKUP_RECONCILIATION_SCOPE');
 return Object.freeze({cycleId:value.cycleId,runId:value.runId,sourceFence:value.sourceFence,previewDigest:value.previewDigest});
}
function validatePauseInput(value){
 if(!value||typeof value!=='object')fail('OPPORTUNITY_BACKUP_PAUSE_REQUIRED');
 const selected=Object.hasOwn(value,'profile'),reconciliation=value.profile===RECONCILIATION_PROFILE;
 if(Object.keys(value).sort().join(',')!==(reconciliation?'packageDigest,profile,reconciliation,stopReceipt,windowId':selected?'packageDigest,profile,stopReceipt,windowId':'packageDigest,stopReceipt,windowId')
   ||!UUID.test(value.windowId||'')||!SHA.test(value.packageDigest||'')
   ||selected&&!reconciliation&&(value.profile===LEGACY_PREARCHIVE_PROFILE
     ?value.packageDigest!==legacyPackage.packageDigest
     :value.profile===LEGACY_ACCEPTANCE_PROFILE
       ?value.packageDigest!==acceptancePackage.packageDigest
       :value.profile!==WRITER_PROFILE||value.packageDigest!==writerPackage.packageDigest)
   ||reconciliation&&value.packageDigest!==require('../../src/security/opportunityEuReconciliationMigrationPackage').packageDigest)fail('OPPORTUNITY_BACKUP_PAUSE_REQUIRED');
 const reconciliationScope=reconciliation?validateReconciliationScope(value.reconciliation):null;
 const r=value.stopReceipt;
 if(!r||r.verified!==true||r.stopped!==true||!Number.isSafeInteger(r.id)||r.id<1||typeof r.created!=='string'||!Number.isFinite(Date.parse(r.created))
   ||!Array.isArray(r.descendants)||!r.descendants.length||r.descendants.length>32||!r.descendants.includes(r.id)
   ||r.descendants.some(pid=>!Number.isSafeInteger(pid)||pid<1)||new Set(r.descendants).size!==r.descendants.length)fail('OPPORTUNITY_BACKUP_PAUSE_REQUIRED');
 return Object.freeze({windowId:value.windowId,packageDigest:value.packageDigest,...(selected?{profile:value.profile}:{}),...(reconciliation?{reconciliation:reconciliationScope}:{}),stopReceipt:Object.freeze({id:r.id,created:r.created,descendants:Object.freeze([...r.descendants]),verified:true,stopped:true})});
}
function run(exe,argv,env={},input){
 const r=spawnSync(exe,argv,{env:{...process.env,...env},input,encoding:'utf8',windowsHide:true,timeout:120000,maxBuffer:32*1024*1024,stdio:path.basename(exe).toLowerCase()==='pg_ctl.exe'?'ignore':'pipe'});
 if(r.status!==0)fail('OPPORTUNITY_BACKUP_TOOL_FAILED');return r.stdout;
}
function assertProcessesStopped(receipt){
 // These integers were validated above; no command line, environment or token
 // is returned. Unknown listeners/processes are refused, never terminated.
 run('powershell',['-NoProfile','-Command',`$ErrorActionPreference='Stop'; $ids=@(${receipt.descendants.join(',')}); $nodes=@(Get-CimInstance Win32_Process -Filter "Name='node.exe'"); if(@($nodes | Where-Object {$_.ProcessId -in $ids -or $_.CommandLine -match '(?:^|\\s)scripts/start-local\\.cjs\\s*$'}).Count){exit 2}; foreach($port in @(3000,5000)){if(@(Get-NetTCPConnection -LocalPort $port -ErrorAction SilentlyContinue | Where-Object {$_.RemotePort -eq 0}).Count){exit 3}}`]);
}
async function provePausedWindow(input){const value=validatePauseInput(input);assertProcessesStopped(value.stopReceipt);const token=Object.freeze({...value,provedAt:new Date().toISOString()});proofs.set(token,{value,createdAt:Date.now(),used:false});return token;}
function consumePauseProof(token){const p=token&&proofs.get(token);if(!p||p.used||Date.now()-p.createdAt>60000)fail('OPPORTUNITY_BACKUP_PAUSE_REQUIRED');const value=validatePauseInput(p.value);p.used=true;return value;}
function pg(exe,argv,connection,input){return run(path.join(BIN,exe+'.exe'),argv,connection?{PGPASSWORD:connection.password,PGOPTIONS:'-c timezone=UTC'}:{},input);}
const connectionArgs=c=>['--no-password','-h',c.host,'-p',String(c.port),'-U',c.user];
function protect(folder){
 fs.mkdirSync(folder);
 const sid=run('whoami',['/user','/fo','csv','/nh']).match(/S-1-5-[0-9-]+/)?.[0];if(!sid)fail('OPPORTUNITY_BACKUP_ACL_REQUIRED');
 run('icacls',[folder,'/inheritance:r','/grant:r',`*${sid}:(OI)(CI)F`,'*S-1-5-18:(OI)(CI)F']);
 const escaped=folder.replaceAll("'","''");
 run('powershell',['-NoProfile','-Command',`$ErrorActionPreference='Stop'; $a=Get-Acl -LiteralPath '${escaped}'; if(-not $a.AreAccessRulesProtected){exit 2}; $seen=@(); foreach($r in $a.Access){$s=$r.IdentityReference.Translate([System.Security.Principal.SecurityIdentifier]).Value; if($s -notin @('${sid}','S-1-5-18') -or $r.AccessControlType -ne 'Allow' -or ($r.FileSystemRights -band [System.Security.AccessControl.FileSystemRights]::FullControl) -ne [System.Security.AccessControl.FileSystemRights]::FullControl){exit 3}; $seen+=$s}; if('${sid}' -notin $seen -or 'S-1-5-18' -notin $seen){exit 4}`]);
}
function writeNewJson(file,value){fs.writeFileSync(file,JSON.stringify(value,null,2)+'\n',{flag:'wx',mode:0o600});}
function tableInventory(rows){const sorted=rows.map(r=>r.value).sort();return {count:sorted.length,sha256:hash(JSON.stringify(sorted))};}
async function snapshot(client){
 const tables=(await client.query("SELECT n.nspname,c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE c.relkind IN ('r','p') AND n.nspname NOT LIKE 'pg_%' AND n.nspname<>'information_schema' ORDER BY 1,2")).rows;
 const data={};for(const t of tables){const name=quote(t.nspname)+'.'+quote(t.relname);data[name]=tableInventory((await client.query(`SELECT to_jsonb(t)::text AS value FROM ${name} t`)).rows);}
 const sequences={};for(const t of (await client.query("SELECT schemaname,sequencename FROM pg_sequences WHERE schemaname NOT LIKE 'pg_%' ORDER BY 1,2")).rows){const name=quote(t.schemaname)+'.'+quote(t.sequencename);sequences[name]=(await client.query(`SELECT last_value::text,is_called FROM ${name}`)).rows[0];}
 const largeObjects=(await client.query('SELECT count(*)::int AS count FROM pg_largeobject_metadata')).rows[0].count;if(largeObjects!==0)fail('OPPORTUNITY_BACKUP_LARGE_OBJECT_REQUIRES_REVIEW');
 const database=(await client.query("SELECT datname,pg_get_userbyid(datdba) AS owner,pg_encoding_to_char(encoding) AS encoding,datcollate,datctype,datlocprovider,COALESCE(to_jsonb(d)->>'datlocale',to_jsonb(d)->>'daticulocale') AS locale,datcollversion,datconnlimit,datallowconn,datistemplate,datacl::text AS acl,(SELECT spcname FROM pg_tablespace WHERE oid=d.dattablespace) AS tablespace FROM pg_database d WHERE datname=current_database()")).rows[0];
 return {data,sequences,largeObjects,database};
}
async function globals(client){return {roles:(await client.query('SELECT rolname,rolsuper,rolinherit,rolcreaterole,rolcreatedb,rolcanlogin,rolreplication,rolconnlimit,rolvaliduntil::text,rolbypassrls,rolconfig FROM pg_roles ORDER BY rolname')).rows,
 memberships:(await client.query('SELECT r.rolname AS role,m.rolname AS member,g.rolname AS grantor,a.admin_option,a.inherit_option,a.set_option FROM pg_auth_members a JOIN pg_roles r ON r.oid=a.roleid JOIN pg_roles m ON m.oid=a.member JOIN pg_roles g ON g.oid=a.grantor ORDER BY r.rolname,m.rolname,g.rolname')).rows};}
function assertScopeRows({tenants,generations,connections},config,state){
 if(tenants.length!==1||tenants[0].tenant_id!==state.tenantId||tenants[0].organization_id!==state.organizationId)fail('OPPORTUNITY_BACKUP_TENANT_SCOPE');
 if(generations.length!==1||generations[0].tenant_id!==state.tenantId||generations[0].database_generation_id!==state.generationId||generations[0].database_ref!==config.tenantDatabase)fail('OPPORTUNITY_BACKUP_TENANT_SCOPE');
 if(!connections.length||connections.some(r=>r.tenant_id!==state.tenantId||r.database_generation_id!==state.generationId||r.database_ref!==config.tenantDatabase))fail('OPPORTUNITY_BACKUP_TENANT_SCOPE');
 return {tenants:1,activeGenerations:1,activeConnectionVersions:connections.length};
}
async function assertScope(client,config,state){return assertScopeRows({tenants:(await client.query('SELECT tenant_id::text,organization_id::text FROM public.tenant ORDER BY tenant_id')).rows,
 generations:(await client.query('SELECT tenant_id::text,database_generation_id::text,database_ref FROM public.tenant_database_generation WHERE retired_at IS NULL ORDER BY database_generation_id')).rows,
 connections:(await client.query("SELECT tenant_id::text,database_generation_id::text,database_ref FROM public.organization_connection_version WHERE version_state NOT IN ('REVOKED','FAILED') ORDER BY tenant_id,connection_version")).rows},config,state);}
function baselineProfile(profile){
 if(profile===undefined)return {versions:BASELINES,tenantManifest:require('../../src/security/tenantMigrationManifest').manifest};
 if(profile===RECONCILIATION_PROFILE)return {versions:{central:writerPackage.entry.version,tenant:installedPackage.tenantAddition.version},fingerprints:{central:writerPackage.entry.schemaFingerprint,tenant:installedPackage.tenantAddition.schemaFingerprint},tenantManifest:require('../../src/security/tenantMigrationManifest').registeredManifest};
 if(profile===LEGACY_PREARCHIVE_PROFILE)return {versions:{central:legacyPackage.CENTRAL_BASELINE,tenant:installedPackage.tenantAddition.version},fingerprints:{central:reconciliationPackage.entry.schemaFingerprint,tenant:installedPackage.tenantAddition.schemaFingerprint},tenantManifest:require('../../src/security/tenantMigrationManifest').registeredManifest};
 if(profile===LEGACY_ACCEPTANCE_PROFILE)return {versions:{central:acceptancePackage.CENTRAL_BASELINE,tenant:installedPackage.tenantAddition.version},fingerprints:{central:legacyPackage.entry.schemaFingerprint,tenant:installedPackage.tenantAddition.schemaFingerprint},tenantManifest:require('../../src/security/tenantMigrationManifest').registeredManifest};
 if(profile!==WRITER_PROFILE)fail('OPPORTUNITY_BACKUP_PROFILE_INVALID');
 const central=installedPackage.centralEntries.at(-1),tenant=installedPackage.tenantAddition;
 // Closed registered predecessor: preparation cannot certify043 or accept a
 // caller-selected version/fingerprint/manifest. The pause token binds043's digest.
 return {versions:{central:writerPackage.CENTRAL_BASELINE,tenant:tenant.version},fingerprints:{central:central.schemaFingerprint,tenant:tenant.schemaFingerprint},tenantManifest:require('../../src/security/tenantMigrationManifest').registeredManifest};
}
function assertBaseline(proof,name,profile){const selected=baselineProfile(profile),fingerprint=proof?.fingerprint||proof?.schemaFingerprint;if(!Object.hasOwn(selected.versions,name)||proof?.currentVersion!==selected.versions[name]||name==='central'&&proof.postgresMajor!==18||selected.fingerprints&&fingerprint!==selected.fingerprints[name])fail('OPPORTUNITY_BACKUP_BASELINE_MISMATCH');return {version:proof.currentVersion,fingerprint};}
async function baselines(pools,state,profile){const selected=baselineProfile(profile),central=assertBaseline(await preflightCentral(pools.central),'central',profile);const tenant=assertBaseline(await preflightTenant(pools.tenant,{tenantId:state.tenantId,databaseGenerationId:state.generationId},selected.tenantManifest,{timeoutMs:30000}),'tenant',profile);return {central,tenant};}
const WORK_KEYS=Object.freeze({central:Object.freeze(['funding','execution','inbox','outbox','published','admissionCompletion','admissionIdentity','onboarding','members']),tenant:Object.freeze(['inbox','outbox','published'])});
const SETTLED_FUNDING=`o.organization_id IS NULL AND o.lineage_version=1
 AND o.envelope->>'authority'='CENTRAL' AND o.envelope->>'organizationId' IS NULL
 AND o.envelope->>'jobType'='funding_tenders.refresh' AND o.envelope->>'jobVersion'='1'
 AND EXISTS(SELECT 1 FROM opportunity_catalog.funding_run r WHERE r.run_id::text=o.envelope->'payload'->>'runId'
   AND r.status IN ('SUCCESS','ERROR') AND r.finished_at IS NOT NULL AND r.lease_until IS NULL)`;
const SETTLED_TENANT=`EXISTS(SELECT 1 FROM async_exec.inbox i
 WHERE i.organization_id=o.organization_id AND i.job_type=o.envelope->>'jobType'
 AND i.job_version::text=o.envelope->>'jobVersion' AND i.idempotency_key=o.envelope->>'idempotencyKey'
 AND i.digest_sha256=o.digest_sha256 AND i.state IN ('COMPLETED','FAILED','CANCELLED')
 AND i.consumer=CASE o.envelope->>'jobType' WHEN 'opportunity.import.portugal2030' THEN 'f12-import-worker'
   WHEN 'document.scan' THEN 'document-worker-v1' WHEN 'document.reconcile' THEN 'document-worker-v1'
   WHEN 'document.expire_upload' THEN 'document-worker-v1' END)`;
function isQuiescentWork(value,scope){const keys=WORK_KEYS[scope];return Boolean(keys&&value&&Object.keys(value).length===keys.length&&keys.every(key=>Number.isSafeInteger(value[key])&&value[key]===0));}
function assertReconciliationWork(counts,matched){
 const keys=['execution','funding','inbox','outbox','published'];
 if(!matched||Object.keys(matched).sort().join(',')!==keys.join(',')||matched.funding!==1||matched.inbox!==1||matched.outbox!==0||matched.published!==1||matched.execution!==1
  ||!counts||Object.keys(counts).length!==WORK_KEYS.central.length||WORK_KEYS.central.some(k=>!Number.isSafeInteger(counts[k])||counts[k]!== (Object.hasOwn(matched,k)?matched[k]:0)))fail('OPPORTUNITY_BACKUP_PENDING_WORK');
 return true;
}
async function pendingWork(client,scope){
 if(!Object.hasOwn(WORK_KEYS,scope))fail('OPPORTUNITY_BACKUP_WORK_SCOPE');
 // Completion is itself a durable queue. Identity/onboarding/member effects
 // run outside their claiming transaction: an expired lease is still unsafe.
 return (await client.query(`SELECT
  (SELECT count(*)::int FROM async_exec.inbox WHERE state IN ('PROCESSING','UNCERTAIN')) AS inbox,
  (SELECT count(*)::int FROM async_exec.outbox WHERE state IN ('PENDING','CLAIMED','UNCERTAIN')) AS outbox,
  (SELECT count(*)::int FROM async_exec.outbox o WHERE o.state='PUBLISHED' AND (${scope==='central'?SETTLED_FUNDING:SETTLED_TENANT}) IS NOT TRUE) AS published${scope==='central'?`,
  (SELECT count(*)::int FROM async_exec.execution e WHERE e.state IN ('CLAIMED','RUNNING','RECONCILIATION_REQUIRED')
    OR (e.state IN ('QUEUED','RETRY_WAIT') AND NOT (e.claim_owner IS NULL AND e.lease_until IS NULL AND e.lineage_version=1
      AND EXISTS(SELECT 1 FROM async_exec.outbox o WHERE o.state='PUBLISHED'
        AND o.envelope->>'executionId'=e.execution_id::text AND o.organization_id IS NOT DISTINCT FROM e.organization_id
        AND o.envelope->>'jobType'=e.job_type AND o.envelope_digest=e.envelope_digest AND o.content_digest=e.content_digest
        AND ${SETTLED_FUNDING})))) AS execution,
  (SELECT count(*)::int FROM opportunity_catalog.funding_run WHERE status IN ('QUEUED','RUNNING')) AS funding,
  (SELECT count(*)::int FROM public.entity_admission_completion WHERE phase IN ('TENANT','PROJECTION','ACTIVATION')) AS "admissionCompletion",
  (SELECT count(*)::int FROM public.entity_admission WHERE status='RUNNING' OR lease_until IS NOT NULL) AS "admissionIdentity",
  (SELECT count(*)::int FROM public.platform_onboarding_operation WHERE status='RUNNING' OR lease_until IS NOT NULL) AS onboarding,
  (SELECT count(*)::int FROM public.platform_member_operation WHERE status='RUNNING' OR lease_until IS NOT NULL) AS members`:''}`)).rows[0];
}
async function reconciliationPendingWork(client,raw){
 const scope=validateReconciliationScope(raw);
 // The reviewed domain reader verifies the complete immutable envelope,
 // deadline, lineage and source epoch. Matching counters alone are insufficient.
 const observed=await require('../../src/opportunities/v2/euRunReconciliationState').assertReconciliationPreviewState(client,scope);
 const preview=observed.preview;
 const counts=await pendingWork(client,'central');
 const matched=(await client.query(`SELECT
 (SELECT count(*)::int FROM opportunity_catalog.funding_run WHERE run_id=$1 AND source_code='EU_FUNDING_TENDERS' AND status IN ('QUEUED','RUNNING')) AS funding,
 (SELECT count(*)::int FROM async_exec.inbox WHERE organization_id IS NULL AND consumer='funding-central-v1' AND job_type='funding_tenders.refresh' AND job_version=1 AND idempotency_key=$1::text AND execution_id=$2 AND digest_sha256=$4 AND state IN ('PROCESSING','UNCERTAIN')) AS inbox,
 (SELECT count(*)::int FROM async_exec.outbox WHERE outbox_id=$3 AND state IN ('PENDING','CLAIMED','UNCERTAIN')) AS outbox,
 (SELECT count(*)::int FROM async_exec.outbox WHERE outbox_id=$3 AND organization_id IS NULL AND state='PUBLISHED' AND envelope->>'executionId'=$2::text AND envelope#>>'{payload,runId}'=$1::text AND digest_sha256=$4) AS published,
 (SELECT count(*)::int FROM async_exec.execution e JOIN async_exec.outbox o ON o.outbox_id=$3 WHERE e.execution_id=$2 AND e.organization_id IS NULL AND e.job_type='funding_tenders.refresh'
 AND e.lineage_version=1 AND e.lineage_version=o.lineage_version AND e.envelope_digest=o.envelope_digest AND e.content_digest=o.content_digest
 AND e.deadline_at=(o.envelope->>'deadlineAt')::timestamptz
 AND (e.outbox_id=o.outbox_id OR e.outbox_id IS NULL AND e.delivery_kind='INITIAL' AND e.attempt=1 AND e.root_execution_id=e.execution_id AND e.previous_execution_id IS NULL AND e.replay_request_id IS NULL)
 AND e.state IN ('CLAIMED','RUNNING','RECONCILIATION_REQUIRED','QUEUED','RETRY_WAIT')) AS execution`,[scope.runId,preview.inbox.execution_id,preview.outbox.outbox_id,preview.inbox.digest_sha256])).rows[0];
 assertReconciliationWork(counts,matched);
 return {counts,matched,scope,previewDigest:observed.previewDigest};
}
async function quiescent(pools,config,proof,applicationName){
 assertProcessesStopped(proof.stopReceipt);
 const sessions=(await pools.central.query('SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname=ANY($1::text[]) AND application_name<>$2',[[config.centralDatabase,config.tenantDatabase],applicationName])).rows[0];if(sessions.n!==0)fail('OPPORTUNITY_BACKUP_EXTERNAL_SESSIONS');
 const counts={};for(const [name,pool] of Object.entries(pools)){
  if(name==='central'&&proof.profile===RECONCILIATION_PROFILE){counts[name]=(await reconciliationPendingWork(pool,proof.reconciliation)).counts;continue;}
  const row=await pendingWork(pool,name);
  if(!isQuiescentWork(row,name))fail('OPPORTUNITY_BACKUP_PENDING_WORK');counts[name]=row;
 }return counts;
}
async function freePort(){return new Promise((resolve,reject)=>{const server=net.createServer();server.once('error',reject);server.listen(0,'127.0.0.1',()=>{const port=server.address().port;server.close(()=>resolve(port));});});}
function assertIsolatedIdentity(row,cluster,port){if(!row||path.resolve(row.directory)!==path.resolve(cluster)||Number(row.port)!==port||!['127.0.0.1','127.0.0.1/32'].includes(row.address)||Math.floor(Number(row.version)/10000)!==18)fail('OPPORTUNITY_BACKUP_RESTORE_TARGET');}
function publicSummary(report){return {version:'opportunity-v2-backup-restore-v1',status:report.status,windowId:report.windowId,packageDigest:report.packageDigest,...(report.profile?{profile:report.profile}:{}),...(report.reconciliation?{reconciliation:report.reconciliation}:{}),createdAt:report.createdAt,completedAt:report.completedAt,
 backup:report.backup,aclRestricted:report.aclRestricted,baselines:report.baselines,scope:report.scope,databases:report.databases,configuration:report.configuration,globalRolesSha256:report.globalRolesSha256,globalsMatch:report.globalsMatch,noSourceDrift:report.noSourceDrift,cleanup:report.cleanup,failure:report.failure};}
async function main(argv=process.argv.slice(2),{pauseProof}={}){
 args(argv);const proof=consumePauseProof(pauseProof),config=cfg.readConfig(),stateFile=path.join(cfg.folder,'runtime.json'),state=JSON.parse(fs.readFileSync(stateFile));target(config,state);assert.equal(state.snapshot.databaseRef,config.tenantDatabase);
 const id=randomUUID(),folder=path.join(cfg.folder,'opportunity-v2-backup-'+id),cluster=path.join(folder,'restore-cluster'),marker=randomUUID();
 protect(folder);fs.writeFileSync(path.join(folder,'restore-owner.txt'),marker,{flag:'wx'});
 const output=path.join(cfg.root,'output','opportunity-v2-window',proof.windowId);fs.mkdirSync(output,{recursive:true});const publicFile=path.join(output,'backup-restore-'+id+'.json');
 const report={status:'IN_PROGRESS',windowId:proof.windowId,packageDigest:proof.packageDigest,...(proof.profile?{profile:proof.profile}:{}),...(proof.reconciliation?{reconciliation:proof.reconciliation}:{}),createdAt:new Date().toISOString(),backup:path.relative(cfg.root,folder),aclRestricted:true,databases:{},configuration:{},cleanup:false};
 const applicationName='opportunity-v2-backup-'+proof.windowId,sources={},restored={},copies=[];let admin;
 const temporary={host:'127.0.0.1',port:await freePort(),user:'postgres',password:randomBytes(32).toString('hex')};assert.notEqual(temporary.port,config.port);
 try{
  for(const [name,database]of [['central',config.centralDatabase],['tenant',config.tenantDatabase]])sources[name]=new Pool({...cfg.connection(config,database),max:1,application_name:applicationName,options:'-c timezone=UTC -c default_transaction_read_only=on -c statement_timeout=30000 -c lock_timeout=3000'});
  await quiescent(sources,config,proof,applicationName);report.baselines=await baselines(sources,state,proof.profile);report.scope=await assertScope(sources.central,config,state);
  const originalGlobals=await globals(sources.central);writeNewJson(path.join(folder,'globals-inventory.json'),originalGlobals);
  for(const relative of PRIVATE_FILES){const source=path.join(cfg.root,relative);if(!fs.existsSync(source))continue;if(fs.lstatSync(source).isSymbolicLink())fail('OPPORTUNITY_BACKUP_CONFIG_LINK');const destination=path.join(folder,'configuration',relative);fs.mkdirSync(path.dirname(destination),{recursive:true});fs.copyFileSync(source,destination,fs.constants.COPYFILE_EXCL);const digest=fileHash(source);assert.equal(fileHash(destination),digest);copies.push({relative,source,destination,digest});}
  if(!copies.some(f=>f.relative==='backend/.env')||!copies.some(f=>f.relative==='.tmp/local-platform/runtime.json'))fail('OPPORTUNITY_BACKUP_CONFIG_MISSING');
  for(const [name,pool]of Object.entries(sources)){
   await quiescent(sources,config,proof,applicationName);const client=await pool.connect();
   try{
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');const snapshotId=(await client.query('SELECT pg_export_snapshot() AS id')).rows[0].id;assert.match(snapshotId,/^[0-9A-F-]+$/i);
    const before=await snapshot(client),schema=name==='tenant'?await tenantSchemaSnapshot(client):await centralSchemaSnapshot(client),database=config[name+'Database'],file=path.join(folder,name+'.dump');
    pg('pg_dump',[...connectionArgs(config),'--format=custom','--create','--snapshot='+snapshotId,'--lock-wait-timeout=15000','-f',file,database],config);pg('pg_restore',['--list',file]);
    writeNewJson(path.join(folder,name+'-inventory.json'),{before,schema});report.databases[name]={database,bytes:fs.statSync(file).size,sha256:fileHash(file),tables:Object.keys(before.data).length,rows:Object.values(before.data).reduce((n,t)=>n+t.count,0),contentSha256:hash(JSON.stringify(before)),schemaSha256:hash(JSON.stringify(schema))};await client.query('ROLLBACK');
   }catch(error){await client.query('ROLLBACK').catch(()=>{});throw error;}finally{client.release();}
  }
  const roles=pg('pg_dumpall',[...connectionArgs(config),'--roles-only','--no-role-passwords'],config);if(/\bPASSWORD\s+'/i.test(roles))fail('OPPORTUNITY_BACKUP_ROLE_PASSWORD');fs.writeFileSync(path.join(folder,'roles.sql'),roles,{flag:'wx'});report.globalRolesSha256=hash(roles);
  const passwordFile=path.join(folder,'restore-password');fs.writeFileSync(passwordFile,temporary.password,{flag:'wx'});pg('initdb',['-D',cluster,'-U','postgres','--pwfile='+passwordFile,'--auth=scram-sha-256','--encoding=UTF8','--locale-provider=icu','--icu-locale=und']);
  fs.appendFileSync(path.join(cluster,'postgresql.conf'),`\nlisten_addresses='127.0.0.1'\nport=${temporary.port}\ntimezone='UTC'\n`);ownedCluster(folder,cluster,marker);pg('pg_ctl',['-D',cluster,'-l',path.join(folder,'restore-server.log'),'-w','-t','30','start']);
  admin=new Pool({...temporary,database:'postgres',max:1,connectionTimeoutMillis:5000});assertIsolatedIdentity((await admin.query("SELECT current_setting('data_directory') AS directory,current_setting('port') AS port,inet_server_addr()::text AS address,current_setting('server_version_num') AS version")).rows[0],cluster,temporary.port);
  const restoreRoles=roles.replace(/^CREATE ROLE postgres;\r?\n/m,'');assert.notEqual(restoreRoles,roles);pg('psql',[...connectionArgs(temporary),'-d','postgres','-v','ON_ERROR_STOP=1'],temporary,restoreRoles);assertCopy(originalGlobals,await globals(admin));report.globalsMatch=true;
  for(const name of ['central','tenant']){
   await quiescent(sources,config,proof,applicationName);const item=report.databases[name],file=path.join(folder,name+'.dump');assert.equal(fileHash(file),item.sha256);
   pg('pg_restore',[...connectionArgs(temporary),'--exit-on-error','--create','-d','postgres',file],temporary);const pool=restored[name]=new Pool({...temporary,database:item.database,max:1,options:'-c timezone=UTC',connectionTimeoutMillis:5000});const expected=JSON.parse(fs.readFileSync(path.join(folder,name+'-inventory.json')));assertCopy(expected.before,await snapshot(pool));item.dataMatches=true;
   if(name==='tenant'){const observed=await tenantSchemaSnapshot(pool),supplement=aclSupplement(expected.schema.organizationProfileSecurity.authoringAcl,observed.organizationProfileSecurity.authoringAcl);fs.writeFileSync(path.join(folder,'tenant-restore-acl.sql'),supplement,{flag:'wx'});if(supplement)await pool.query(supplement);item.aclSupplement={statements:supplement.split('\n').filter(Boolean).length,sha256:hash(supplement)};assert.equal(tenantSchemaFingerprint(await tenantSchemaSnapshot(pool)),tenantSchemaFingerprint(expected.schema));}
   else assertCopy(expected.schema,await centralSchemaSnapshot(pool));
  }
  assert.deepEqual(await baselines(restored,state,proof.profile),report.baselines);await quiescent(sources,config,proof,applicationName);assert.deepEqual(await baselines(sources,state,proof.profile),report.baselines);assert.deepEqual(await assertScope(sources.central,config,state),report.scope);
  for(const [name,pool]of Object.entries(sources)){const expected=JSON.parse(fs.readFileSync(path.join(folder,name+'-inventory.json')));assertCopy(expected.before,await snapshot(pool));assertCopy(expected.schema,name==='tenant'?await tenantSchemaSnapshot(pool):await centralSchemaSnapshot(pool));report.databases[name].sourceStillMatches=true;report.databases[name].preflight=true;}
  assertCopy(originalGlobals,await globals(sources.central));for(const copy of copies){assert.equal(fileHash(copy.source),copy.digest);assert.equal(fileHash(copy.destination),copy.digest);report.configuration[copy.relative]={copied:true,sha256:copy.digest};}
  report.noSourceDrift=true;report.status='PASS';
 }catch(error){report.status='FAIL';report.failure=/^[A-Z0-9_]+$/.test(error.message||'')?error.message:'OPPORTUNITY_BACKUP_VALIDATION_FAILED';throw error;}
 finally{
  await Promise.allSettled([...Object.values(sources),...Object.values(restored),admin].filter(Boolean).map(pool=>pool.end()));
  try{if(fs.existsSync(path.join(cluster,'postmaster.pid'))){ownedCluster(folder,cluster,marker);pg('pg_ctl',['-D',cluster,'-m','fast','-w','-t','30','stop']);}assert(!fs.existsSync(path.join(cluster,'postmaster.pid')));report.cleanup=true;}catch{report.cleanup=false;report.status='FAIL';report.failure='OPPORTUNITY_BACKUP_RESTORE_STOP_FAILED';}
  report.completedAt=new Date().toISOString();const summary=publicSummary(report);writeNewJson(path.join(folder,'verification.json'),summary);writeNewJson(publicFile,summary);console.log(JSON.stringify({status:summary.status,cleanup:summary.cleanup,backup:summary.backup,evidence:path.relative(cfg.root,publicFile)}));
 }
 if(report.status!=='PASS'||report.noSourceDrift!==true)fail(report.failure||'OPPORTUNITY_BACKUP_VALIDATION_FAILED');return publicSummary(report);
}
if(require.main===module)main().catch(()=>{console.error('OPPORTUNITY_BACKUP_FAILED_SEE_SANITIZED_REPORT');process.exitCode=1;});
module.exports={BASELINES,WRITER_PROFILE,RECONCILIATION_PROFILE,LEGACY_PREARCHIVE_PROFILE,LEGACY_ACCEPTANCE_PROFILE,PRIVATE_FILES,args,validatePauseInput,validateReconciliationScope,assertReconciliationWork,reconciliationPendingWork,provePausedWindow,consumePauseProof,assertBaseline,assertScopeRows,assertIsolatedIdentity,tableInventory,snapshot,publicSummary,pendingWork,isQuiescentWork,main};
