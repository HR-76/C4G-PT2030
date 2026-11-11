'use strict';
// Explicit disposable Docker gate. Importing this file never creates resources.
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const {execFileSync}=require('node:child_process');
const {randomUUID,randomBytes,createHash}=require('node:crypto');
const candidate=require('../../../backend/src/security/opportunityInterestMigrationCandidate');
const root=path.resolve(__dirname,'../../..');
function parseArguments(args){
 if(!Array.isArray(args)||args.length<1||args[0]!=='--isolated'||args.length>2||(args.length===2&&!['--verify','--historical-030'].includes(args[1])))throw Error('INTEREST_EXPLICIT_ISOLATED_INVOCATION_REQUIRED');
 if(args[1]==='--historical-030')return {verify:true,historical:true};
 return {verify:args[1]==='--verify'};
}
function inputHashes(){
 const files=['backend/database/tenant/migrations/031_application_document_transport.up.sql','backend/database/tenant/migrations/032_document_worker_runtime.up.sql','backend/database/tenant/migrations/033_organizational_opportunity_interests.up.sql','backend/src/security/tenantMigrationManifest.js',
  'backend/src/security/tenantMigrationRunner.js','backend/src/security/tenantSchemaFingerprint.js',
  'backend/src/security/tenantMigrationPreflight.js','backend/src/security/opportunityInterestMigrationCandidate.js','backend/src/opportunityInterests/repository.js',
  'backend/src/applications/repository.js','backend/src/applications/interestLink.js','test/integration/opportunity-interests/proof.js',
  'test/integration/opportunity-interests/gate.js','test/integration/opportunity-interests/historical.js','backend/src/security/tenantHistoricalOwnership.js','backend/test/fixtures/tenant030HistoricalLedger.json'];
 return Object.fromEntries(files.map(file=>[file,createHash('sha256').update(fs.readFileSync(path.join(root,file))).digest('hex')]));
}
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function main(args=process.argv.slice(2)){
 const {verify,historical=false}=parseArguments(args);
 // Verification must use the trusted manifest already reviewed/registered in
 // source. Caller-provided fingerprints/connection strings are never accepted.
 const registered=verify?candidate.registeredCandidate():null;
 const {Pool}=require('../../../backend/node_modules/pg');
 const {manifest,migrationSql}=require('../../../backend/src/security/tenantMigrationManifest');
 const {createTenantMigrationRunner}=require('../../../backend/src/security/tenantMigrationRunner');
 const preflight=require('../../../backend/src/security/tenantMigrationPreflight');
 const {tenantSchemaSnapshot,tenantSchemaFingerprint}=require('../../../backend/src/security/tenantSchemaFingerprint');
 const proof=require('./proof');
 const gateId=randomUUID().replaceAll('-',''),containerName=`c4g-interest-${gateId}`,database=`interest_gate_${gateId}`;
 const evidence=path.join(root,'output',`opportunity-interests-pg-${gateId}`),secret=randomBytes(32).toString('hex');
 const expected={tenantId:randomUUID(),databaseGenerationId:randomUUID()};
 const report={gateId,mode:historical?'VERIFY_HISTORICAL_030_TO_033':verify?'VERIFY_REGISTERED_MANIFEST':'PROBE_UNREGISTERED_CANDIDATE',status:'RUNNING',checks:[],cleanup:false,
  runtimeAttestation:false,limitations:['No Central identity service, OIDC, HTTP or browser is exercised.',
   'Repository authorization/central-catalog/responsible callbacks are explicit synthetic fixtures; F5 production integration is not validated.',
   ...(verify?[]:['Probe uses a real SET LOCAL ROLE inside the installer transaction; no independent runtime-login visibility or concurrency is asserted.',
    'Measured fingerprint and candidate descriptor are review artifacts only; the active manifest and capability evidence remain unchanged.'])]};
 const hashes=inputHashes();report.inputHashes=hashes;
 const save=()=>fs.writeFileSync(path.join(evidence,'verification.json'),JSON.stringify(report,null,2));
 fs.mkdirSync(evidence,{recursive:true});
 let container=null,launchAttempted=false,adminPool,tenantPool,runtimePool,reconnectPool,probeClient;
 const started=Date.now(),deadline=started+600000;
 const dockerEnv={...process.env,POSTGRES_PASSWORD:secret};
 const docker=argv=>execFileSync('docker',argv,{encoding:'utf8',windowsHide:true,timeout:30000,stdio:['ignore','pipe','pipe'],env:dockerEnv}).trim();
 const owned=()=>{
  assert.match(container,/^[a-f0-9]{64}$/);
  assert.equal(docker(['inspect','--format','{{index .Config.Labels "c4g.interest-gate"}}',container]),gateId);
  assert.equal(docker(['inspect','--format','{{.Name}}',container]),`/${containerName}`);
 };
 async function check(name,work){
  if(Date.now()>=deadline)throw Error('INTEREST_GATE_DEADLINE');report.phase=name;save();await work();
  report.checks.push({name,status:'PASS'});save();process.stdout.write(`PASS ${name}\n`);
 }
 function transactions(pool){return async(org,work)=>{
  const client=await pool.connect();try{
   await client.query('BEGIN');await client.query('SET LOCAL ROLE c4g_opportunity_tenant_runtime');
   await client.query("SELECT set_config('app.organization_id',$1,true),set_config('app.membership_id',$2,true)",[org,f.actor.membershipId]);
   const result=await work(client);await client.query('RESET ROLE');await client.query('COMMIT');return result;
  }catch(error){await client.query('ROLLBACK').catch(()=>{});throw error;}finally{client.release();}
 };}
 const f=proof.fixture();
 try{
  await check('LOCAL_DOCKER_AND_PREEXISTING_IMAGE',async()=>{
   const endpoint=docker(['context','inspect','--format','{{.Endpoints.docker.Host}}']);
   assert.match(endpoint,/^(npipe:\/\/|unix:\/\/)/);
   if(process.env.DOCKER_HOST)assert.match(process.env.DOCKER_HOST,/^(npipe:\/\/|unix:\/\/)/);
   docker(['info','--format','{{.ServerVersion}}']);
   report.image=docker(['image','inspect','postgres:17-alpine','--format','{{.Id}}']);assert.match(report.image,/^sha256:[a-f0-9]{64}$/);
  });
  await check('CREATE_OWNED_DISPOSABLE_POSTGRES',async()=>{
   launchAttempted=true;
   container=docker(['run','--detach','--name',containerName,'--label',`c4g.interest-gate=${gateId}`,
    '--env','POSTGRES_PASSWORD','--env','POSTGRES_USER=c4g_f12_admin','--env','POSTGRES_DB=postgres',
    '--tmpfs','/var/lib/postgresql/data:rw','-p','127.0.0.1::5432',report.image]);owned();
   const binding=docker(['port',container,'5432/tcp']);assert.match(binding,/^127\.0\.0\.1:\d+$/);
   const port=Number(binding.split(':')[1]);assert(port>1024&&port!==5432);
   const config={host:'127.0.0.1',port,user:'c4g_f12_admin',password:secret,database:'postgres',max:6,
    connectionTimeoutMillis:5000,query_timeout:20000,options:'-c timezone=UTC -c statement_timeout=15000 -c lock_timeout=10000'};
   adminPool=new Pool(config);let ready=false;const readyDeadline=Date.now()+30000;
   while(Date.now()<readyDeadline){try{await adminPool.query('SELECT 1');ready=true;break;}catch{await pause(250);}}
   assert.equal(ready,true);report.postgres=(await adminPool.query('SHOW server_version')).rows[0].server_version;
   for(const role of ['c4g_tenant_owner','c4g_tenant_migrator','c4g_tenant_runtime','c4g_import_worker_runtime'])
    await adminPool.query(`CREATE ROLE ${role} NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`);
   await adminPool.query('GRANT c4g_tenant_owner TO c4g_tenant_migrator');
   await adminPool.query(`CREATE DATABASE ${database} ENCODING 'UTF8' LOCALE_PROVIDER icu ICU_LOCALE 'und' TEMPLATE template0`);
   await adminPool.query(`GRANT CONNECT,CREATE ON DATABASE ${database} TO c4g_tenant_owner`);
   await adminPool.query(`GRANT CONNECT ON DATABASE ${database} TO c4g_tenant_migrator,c4g_tenant_runtime`);
   await adminPool.query(`REVOKE CONNECT,TEMP ON DATABASE ${database} FROM PUBLIC`);
   tenantPool=new Pool({...config,database});
   await tenantPool.query('REVOKE ALL ON SCHEMA public FROM PUBLIC');
   await tenantPool.query(`ALTER ROLE c4g_tenant_runtime IN DATABASE ${database} SET search_path TO pg_catalog,c4g_app`);
   report.containerId=container;
   report.disposableLoopbackBinding=true;
   f.poolConfig={...config,database};
  });
  const baseline=historical?Object.freeze(manifest.filter(entry=>entry.ordinal<=30)):candidate.baseline(),migrationInput={...expected,expectedRevision:1,correlationId:'interest-isolated-gate',idempotencyKey:`baseline-${gateId}`};
  const historyProof=historical?require('./historical'):null;let originalLedger,originalData;
  await check(historical?'BASELINE_030_ORIGINAL_RUNNER_AND_PREFLIGHT':'BASELINE_032_ORIGINAL_RUNNER_AND_PREFLIGHT',async()=>{
   owned();
   const result=await createTenantMigrationRunner({pool:tenantPool,entries:baseline,loadMigration:migrationSql,observationPublisher:{async publish(){}},timeoutMs:15000,scheduler:{setTimeout,clearTimeout}}).migrate(migrationInput);
   assert.equal(result.evidence.currentVersion,baseline.at(-1).version);
   await preflight.preflightTenant(tenantPool,expected,baseline,{timeoutMs:15000});
  });
  if(historical){
   await check('EXACT_HISTORICAL_LEDGER_FIXTURE_WITH_CANONICAL_PHYSICAL_SCHEMA',async()=>{originalLedger=await historyProof.initialize(tenantPool,expected,baseline);});
   await check('HISTORICAL_LEDGER_AND_PHYSICAL_DRIFT_REFUSED',()=>historyProof.refuseDrift(tenantPool,expected,baseline));
  }
  await check('SEED_PRESERVATION_BASELINE_WITH_REAL_APPLICATION_REPOSITORY',async()=>{
   await proof.seedBaseline((sql,p)=>tenantPool.query(sql,p),transactions(tenantPool),f);
   report.baselinePreservation=(await proof.preserved((sql,p)=>tenantPool.query(sql,p))).digest;
   if(historical)originalData=historyProof.oldData((await proof.preserved((sql,p)=>tenantPool.query(sql,p))).values);
  });
  if(historical)await check('FAILED_030_TO_033_UPGRADE_ROLLS_BACK_031_032_AND_LEDGER',()=>historyProof.rollbackUpgrade(tenantPool,migrationInput,baseline,()=>proof.preserved((sql,p)=>tenantPool.query(sql,p))));
  if(!verify){
   probeClient=await tenantPool.connect();await probeClient.query('BEGIN');
   await check('PROBE_033_MEASURED_SCHEMA_AND_UNBRANDED_SECURITY_CHECKS',async()=>{
    const material=candidate.source();report.sqlChecksum=material.checksum;
    report.subphase='APPLY_CANDIDATE_SQL';save();
    try{await probeClient.query(material.sql);}catch(error){report.migrationDiagnostic=error.where||null;throw error;}report.subphase='MEASURE_SCHEMA';save();const snapshot=await tenantSchemaSnapshot(probeClient),fingerprint=tenantSchemaFingerprint(snapshot);
    const measured=candidate.measuredCandidate(fingerprint);report.candidate=measured.entry;
    assert.equal(typeof preflight.validateFeatureCapabilities,'function','Feature validator export required; never replace the production preflight');
    await preflight.validateRolesAndPrivileges(probeClient,snapshot);await preflight.validateFeatureCapabilities(probeClient,measured.entry);
    fs.writeFileSync(path.join(evidence,'candidate.json'),JSON.stringify({measured:true,notRegistered:true,entry:measured.entry},null,2));
   });
   let savepoint=0;
   const transaction=async(org,work)=>{
    const name=`interest_proof_${savepoint++}`;await probeClient.query(`SAVEPOINT ${name}`);
    try{await probeClient.query('SET LOCAL ROLE c4g_opportunity_tenant_runtime');
     await probeClient.query("SELECT set_config('app.organization_id',$1,true),set_config('app.membership_id',$2,true)",[org,f.actor.membershipId]);
     const result=await work(probeClient);await probeClient.query('RESET ROLE');await probeClient.query(`RELEASE SAVEPOINT ${name}`);return result;
    }catch(error){await probeClient.query(`ROLLBACK TO SAVEPOINT ${name}`);await probeClient.query(`RELEASE SAVEPOINT ${name}`);throw error;}
   };
   report.repositoryResult=await proof.runProof({f,transaction,inspect:(sql,p)=>probeClient.query(sql,p),check});
   await check('ROLLBACK_RESTORES_032_SCHEMA_LEDGER_AND_ALL_SEEDED_ROWS',async()=>{
    await probeClient.query('ROLLBACK');probeClient.release();probeClient=null;
    assert.equal(tenantSchemaFingerprint(await tenantSchemaSnapshot(tenantPool)),baseline.at(-1).schemaFingerprint);
    assert.equal((await proof.preserved((sql,p)=>tenantPool.query(sql,p))).digest,report.baselinePreservation);
    await preflight.preflightTenant(tenantPool,expected,baseline,{timeoutMs:15000});
   });
  }else{
   await check('REGISTERED_033_ORIGINAL_RUNNER_PREFLIGHT_AND_IDEMPOTENT_UPGRADE',async()=>{
    const runner=createTenantMigrationRunner({pool:tenantPool,observationPublisher:{async publish(){}},timeoutMs:15000,scheduler:{setTimeout,clearTimeout}});
    const result=await runner.migrate({...migrationInput,idempotencyKey:`upgrade-${gateId}`});
    assert.deepEqual(result.appliedVersions,historical?['031_application_document_transport','032_document_worker_runtime',candidate.VERSION]:[candidate.VERSION]);assert.equal(result.evidence.schemaFingerprint,registered.schemaFingerprint);
    const repeated=await runner.migrate({...migrationInput,idempotencyKey:`repeat-${gateId}`});assert.deepEqual(repeated.appliedVersions,[]);
    await preflight.preflightTenant(tenantPool,expected,manifest,{timeoutMs:15000});report.runtimeAttestation=true;
    const existing=(await tenantPool.query('SELECT title,notes,total_budget::text,organization_budget::text,status,source_interest_id FROM opportunity_catalog.application WHERE application_id=$1',[f.baselineApplication.applicationId])).rows[0];
    assert.equal(existing.title,'Preserved existing application');assert.equal(existing.notes,'Preserve notes');assert.equal(existing.total_budget,'123.45');assert.equal(existing.organization_budget,f.baselineApplication.organizationBudget);assert.equal(existing.source_interest_id,null);
    assert.deepEqual(await transactions(tenantPool)(f.orgA,c=>proof.repositories(f).applications.create(c,f.baselineInput)),f.baselineApplication);
   });
   if(historical)await check('ALL_HISTORICAL_LEDGER_ROWS_AND_PREEXISTING_DATA_PRESERVED',async()=>{
    const rows=(await tenantPool.query('SELECT to_jsonb(t) AS row FROM c4g_system.schema_migration t WHERE ordinal<=30 ORDER BY ordinal')).rows.map(item=>item.row);
    assert.deepEqual(rows,originalLedger);
    assert.deepEqual(historyProof.oldData((await proof.preserved((sql,p)=>tenantPool.query(sql,p))).values),originalData);
   });
   await check('INDEPENDENT_RUNTIME_LOGIN_HAS_NO_BYPASS_OR_OWNER_MEMBERSHIP',async()=>{
    await tenantPool.query(`CREATE ROLE interest_gate_runtime LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD '${secret}'`);
    await tenantPool.query('GRANT c4g_opportunity_tenant_runtime TO interest_gate_runtime WITH ADMIN FALSE,INHERIT FALSE,SET TRUE');
    await tenantPool.query(`GRANT CONNECT ON DATABASE ${database} TO interest_gate_runtime`);
    runtimePool=new Pool({...f.poolConfig,user:'interest_gate_runtime'});reconnectPool=new Pool({...f.poolConfig,user:'interest_gate_runtime'});
    const role=(await runtimePool.query("SELECT rolsuper,rolbypassrls,pg_has_role(current_user,'c4g_tenant_owner','MEMBER') AS owns FROM pg_roles WHERE rolname=current_user")).rows[0];
    assert.equal(role.rolsuper,false);assert.equal(role.rolbypassrls,false);assert.equal(role.owns,false);
   });
   report.repositoryResult=await proof.runProof({f,transaction:transactions(runtimePool),reconnectTransaction:transactions(reconnectPool),concurrent:true,inspect:(sql,p)=>tenantPool.query(sql,p),check});
   await check('FINAL_REGISTERED_PREFLIGHT',()=>preflight.preflightTenant(tenantPool,expected,manifest,{timeoutMs:15000}));
  }
  await check('TESTED_SOURCE_SNAPSHOT_STABLE',async()=>assert.deepEqual(inputHashes(),hashes));
  report.status='PASS';
 }catch(error){report.status='FAIL';report.failure={phase:report.phase,subphase:report.subphase,location:(error.stack||'').match(/(?:gate|proof)\.js:\d+:\d+/)?.[0]||null,diagnostic:error.code==='22P02'&&/uuid: ""/.test(error.message||'')?'EMPTY_UUID_SETTING':null,routine:/^[a-zA-Z_]+$/.test(error.routine||'')?error.routine:null,position:error.position||null,code:/^[A-Z0-9_]{2,80}$/.test(error.code||'')?error.code:'GATE_FAILED',
  reason:/^[A-Z0-9_]{3,100}$/.test(error.message||'')?error.message:'CHECK_FAILED'};process.exitCode=1;
 }finally{
  if(probeClient){await probeClient.query('ROLLBACK').catch(()=>{});probeClient.release();}
  const ended=await Promise.allSettled([reconnectPool?.end(),runtimePool?.end(),tenantPool?.end(),adminPool?.end()]);
  if(ended.some(item=>item.status==='rejected')){report.status='FAIL';report.poolCleanup=false;process.exitCode=1;}
  if(launchAttempted){try{
   if(!container){const matches=docker(['ps','-aq','--no-trunc','--filter',`label=c4g.interest-gate=${gateId}`]).split(/\r?\n/).filter(Boolean);assert.equal(matches.length,1);container=matches[0];}
   owned();docker(['rm','--force','--volumes',container]);
   assert.equal(docker(['ps','-aq','--no-trunc','--filter',`id=${container}`]),'');
   assert.equal(docker(['ps','-aq','--filter',`label=c4g.interest-gate=${gateId}`]),'');report.cleanup=true;
  }catch{report.cleanup=false;report.status='FAIL';process.exitCode=1;}}
  else report.cleanup=true;
  report.elapsedMs=Date.now()-started;save();
  process.stdout.write(JSON.stringify({status:report.status,mode:report.mode,checks:report.checks.length,cleanup:report.cleanup,evidence:path.relative(root,evidence)})+'\n');
 }
 return report;
}
if(require.main===module)main().catch(()=>{process.stderr.write('INTEREST_GATE_INVOCATION_OR_SETUP_REFUSED\n');process.exitCode=1;});
module.exports={parseArguments,main};
