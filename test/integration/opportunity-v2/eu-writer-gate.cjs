'use strict';
// Operational installer, owned disposable databases only. Historical
// gates and application configuration are never modified or loaded.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {execFileSync}=require('node:child_process'),{randomUUID,randomBytes,createHash}=require('node:crypto');
const {Pool}=require('../../../backend/node_modules/pg');
const root=path.resolve(__dirname,'../../..');
function parseArgs(args){assert.ok(args.length===2 && args[0]==='--isolated' && ['--eu-writer','--measure-eu-writer'].includes(args[1]),'EU_WRITER_EXPLICIT_ISOLATED_INVOCATION_REQUIRED');}
function inputHashes(){
 const files=[];
 function visit(folder){for(const item of fs.readdirSync(folder,{withFileTypes:true})){const file=path.join(folder,item.name);if(item.isDirectory())visit(file);else if(/\.(sql|js|cjs|json)$/.test(file))files.push(file);}}
 for(const folder of ['backend/database','backend/src','backend/scripts','test/integration/opportunity-v2'])visit(path.join(root,folder));
 for(const directory of ['scripts','test'])for(const item of fs.readdirSync(path.join(root,directory)))if(/^eu-writer-window.*\.cjs$/.test(item))files.push(path.join(root,directory,item));
 for(const directory of ['scripts','test'])for(const item of fs.readdirSync(path.join(root,directory)))if(/^eu-writer-(?:install|execute-window|controlled-cycle)(?:\.test)?\.cjs$/.test(item))files.push(path.join(root,directory,item));
 for(const file of ['scripts/opportunity-v2-install.cjs','scripts/opportunity-v2-execute-window.cjs','scripts/opportunity-v2-approve.cjs','backend/test/opportunityV2Install.test.js','test/opportunity-v2-execute-window.test.cjs'])files.push(path.join(root,file));
 for(const item of fs.readdirSync(path.join(root,'backend/test')))if(/opportunityV2|euWriter|funding.*Writer/i.test(item))files.push(path.join(root,'backend/test',item));
 files.push(path.join(root,'backend/test/opportunityV2HabitualApproval.test.js'));
 files.push(path.join(root,'frontend/src/api/api.js'));
 files.push(path.join(root,'backend/.env.example'));
 files.push(path.join(root,'backend/test/opportunityV2ExecutorGate.test.js'));
 for(const file of ['backend/test/centralMigrationPreflight.test.js','backend/test/f12OpportunityPreflight.test.js','backend/test/catalogReaderV2Admission.test.js','context/references/opportunity-v2/eu-writer-contract.md'])files.push(path.join(root,file));
 files.push(path.join(root,'context/references/opportunity-v2/writer-window-043-contract.md'));
 files.push(path.join(root,'context/references/opportunity-v2/writer-execution-043-contract.md'));
 for(const file of ['authorityMetadataDedup.test.js','centralSchemaCatalogBatch.test.js','centralMigrationAndLifecycle.test.js'])files.push(path.join(root,'backend/test',file));
 const normativeRoot=path.join(root,'context/references/opportunity-v2');
 const normative=JSON.parse(fs.readFileSync(path.join(normativeRoot,'manifest.json'),'utf8'));
 for(const artifact of normative.artifacts){const file=path.resolve(normativeRoot,artifact.path);assert(file.startsWith(normativeRoot+path.sep));assert.equal(createHash('sha256').update(fs.readFileSync(file)).digest('hex'),artifact.sha256,'NORMATIVE_ARTIFACT_DRIFT');files.push(file);}
 for(const file of ['backend/scripts/runCentralMigrations.js','context/references/opportunity-v2/manifest.json','backend/scripts/localPlatform/backupOpportunityV2.js','backend/scripts/localPlatform/prepareOpportunityV2Window.js','scripts/opportunity-v2-window.cjs','scripts/interest-maintenance-processes.ps1','backend/src/config/documentWorkerInfrastructure.js','backend/src/applications/composition.js','backend/src/organizationDirectory/composition.js','backend/src/opportunityInterests/composition.js','backend/src/documents/apiTenantPool.js','backend/scripts/localPlatform/config.js','backend/scripts/localPlatform/prepareOpportunityInterests.js','backend/scripts/localPlatform/prepareOpportunityV2.js','backend/scripts/localPlatform/backupOpportunityInterests.js','scripts/start-local.cjs'])files.push(path.join(root,file));
 return Object.fromEntries(files.sort().map(file=>[path.relative(root,file).replaceAll('\\','/'),createHash('sha256').update(fs.readFileSync(file)).digest('hex')]));
}
async function main(args=process.argv.slice(2)){
 parseArgs(args);
 const id=randomUUID().replaceAll('-',''),name='c4g-v2-writer-'+id;
 const folder=path.join(root,'output','opportunity-v2-writer-'+id);fs.mkdirSync(folder,{recursive:true});
 const report={id,gateType:'OPPORTUNITY_V2_EU_WRITER',status:'RUNNING',isolated:true,habitualEnvironmentAccess:false,startedAt:new Date().toISOString(),checks:[],cleanup:false,inputHashes:inputHashes(),limitations:['Synthetic identities, signed sessions, private configuration and legacy v1 history.','No OIDC provider login, real-person approval or habitual activation is certified.','No habitual backup/restore or migration is executed by this gate.']};
 const save=()=>fs.writeFileSync(path.join(folder,'verification.json'),JSON.stringify(report,null,2)+'\n');save();
 async function check(label,work){report.phase=label;save();const started=Date.now();await work();report.checks.push({name:label,status:'PASS',durationMs:Date.now()-started});save();process.stdout.write('PASS '+label+'\n');}
 const password=randomBytes(32).toString('hex'),env={...process.env,POSTGRES_PASSWORD:password};
 const docker=args=>execFileSync('docker',args,{encoding:'utf8',windowsHide:true,timeout:30000,stdio:['ignore','pipe','pipe'],env}).trim();
 let container,attempted=false,admin,central,tenant;
 const owned=()=>{assert.match(container,/^[a-f0-9]{64}$/);assert.equal(docker(['inspect','--format','{{index .Config.Labels "c4g.executor-gate"}}',container]),id);assert.equal(docker(['inspect','--format','{{.Name}}',container]),'/'+name);};
 try{
  let connection;
  await check('EXECUTOR_OWNED_LOCAL_POSTGRES18',async()=>{
   assert.match(docker(['context','inspect','--format','{{.Endpoints.docker.Host}}']),/^(npipe:\/\/|unix:\/\/)/);
   if(process.env.DOCKER_HOST)assert.match(process.env.DOCKER_HOST,/^(npipe:\/\/|unix:\/\/)/);
   report.image=docker(['image','inspect','postgres:18-alpine','--format','{{.Id}}']);assert.match(report.image,/^sha256:[a-f0-9]{64}$/);
   attempted=true;container=docker(['run','--detach','--name',name,'--label','c4g.executor-gate='+id,'--env','POSTGRES_PASSWORD','--env','POSTGRES_USER=c4g_f12_admin','--env','POSTGRES_DB=postgres','--tmpfs','/var/lib/postgresql:rw','-p','127.0.0.1::5432',report.image]);owned();
   const binding=docker(['port',container,'5432/tcp']);assert.match(binding,/^127\.0\.0\.1:\d+$/);const port=Number(binding.split(':')[1]);assert(port>1024&&!['5432','5433'].includes(String(port)));
   connection={host:'127.0.0.1',port,user:'c4g_f12_admin',password,max:8,connectionTimeoutMillis:3000,query_timeout:30000,options:'-c timezone=UTC -c statement_timeout=25000 -c lock_timeout=10000'};
   admin=new Pool({...connection,database:'postgres'});let ready=false;for(let i=0;i<80;i++){try{await admin.query('SELECT 1');ready=true;break;}catch{await new Promise(resolve=>setTimeout(resolve,250));}}assert(ready);
   report.postgres=(await admin.query('SHOW server_version')).rows[0].server_version;report.containerId=container;
   for(const role of ['c4g_central_owner','c4g_central_runtime','c4g_tenant_owner','c4g_tenant_migrator','c4g_tenant_runtime','c4g_import_worker_runtime'])await admin.query(`CREATE ROLE ${role} NOLOGIN ${role.startsWith('c4g_central_')?'INHERIT':'NOINHERIT'} NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`);
   await admin.query('GRANT c4g_tenant_owner TO c4g_tenant_migrator');
   for(const db of ['registered_central','registered_tenant']){await admin.query(`CREATE DATABASE ${db} ENCODING 'UTF8' LOCALE_PROVIDER icu ICU_LOCALE 'und' TEMPLATE template0`);await admin.query(`REVOKE CONNECT,TEMP ON DATABASE ${db} FROM PUBLIC`);}
   await admin.query('GRANT CONNECT,CREATE ON DATABASE registered_tenant TO c4g_tenant_owner');await admin.query('GRANT CONNECT ON DATABASE registered_tenant TO c4g_tenant_migrator,c4g_tenant_runtime');
   central=new Pool({...connection,database:'registered_central'});tenant=new Pool({...connection,database:'registered_tenant'});
   await tenant.query('REVOKE ALL ON SCHEMA public FROM PUBLIC');await admin.query('ALTER ROLE c4g_tenant_runtime IN DATABASE registered_tenant SET search_path TO pg_catalog,c4g_app');
  });
  await require('./eu-writer-proof.cjs').euWriterProof({central,tenant,connection,report,check,outputDirectory:folder,measureOnly:args[1]==='--measure-eu-writer'});
  assert.deepEqual(inputHashes(),report.inputHashes,'EXECUTOR_GATE_INPUT_CHANGED');report.status='PASS';
 }catch(error){report.status='FAIL';report.failure={code:error.internalCode||error.code||'EXECUTOR_GATE_FAILED',name:error.name,detail:String(error.message||'').slice(0,1400),location:String(error.stack||'').split('\n').filter(line=>line.includes('opportunity-v2')).slice(0,3)};process.stdout.write('FAIL '+report.phase+' '+report.failure.code+'\n');}
 finally{
  const ended=await Promise.allSettled([central,tenant,admin].filter(Boolean).map(pool=>pool.end()));if(ended.some(result=>result.status==='rejected'))report.poolCleanupFailed=true;
  try{if(attempted){if(!container){const found=docker(['ps','-aq','--no-trunc','--filter','label=c4g.executor-gate='+id]).split(/\r?\n/).filter(Boolean);assert.equal(found.length,1);container=found[0];}owned();docker(['rm','-f',container]);assert.equal(docker(['ps','-aq','--filter','label=c4g.executor-gate='+id]),'');}report.cleanup=true;}catch{report.cleanup=false;report.status='FAIL';}
  report.finishedAt=new Date().toISOString();save();process.stdout.write(JSON.stringify({status:report.status,cleanup:report.cleanup,evidence:path.relative(root,folder).replaceAll('\\','/')})+'\n');
 }
 if(report.status!=='PASS')throw Error('EXECUTOR_GATE_FAILED_SEE_REPORT');return report;
}
if(require.main===module)main().catch(()=>{process.exitCode=1;});
module.exports={parseArgs,inputHashes,main};
