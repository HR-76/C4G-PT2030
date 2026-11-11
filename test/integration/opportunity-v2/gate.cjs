'use strict';
// Explicit, owned, disposable PostgreSQL. No APP configuration or live endpoint.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {execFileSync}=require('node:child_process'),{randomUUID,randomBytes,createHash}=require('node:crypto');
const {Pool}=require('../../../backend/node_modules/pg');
const root=path.resolve(__dirname,'../../..');
function parseArgs(args){
 if(Array.isArray(args)&&args.includes('--activation-only'))throw Error('OPPORTUNITY_ACTIVATION_PROOF_SUPERSEDED_USE_ACTIVATION_HTTP_ONLY');
 if(!Array.isArray(args)||args[0]!=='--isolated'||args.length>2||(args[1]&&!['--temporal-only','--bootstrap-only','--activation-http-only'].includes(args[1])))throw Error('S6_EXPLICIT_ISOLATED_INVOCATION_REQUIRED');
 return {temporalOnly:args[1]==='--temporal-only',bootstrapOnly:args[1]==='--bootstrap-only',...(args[1]==='--activation-http-only'?{activationHttpOnly:true}:{})};
}
function inputHashes(){
 const roots=['backend/database/central','backend/database/tenant','backend/src/opportunities','backend/src/security','backend/src/applications','backend/src/opportunityInterests','backend/src/fundingTenders','backend/src/audit','backend/src/async','backend/src/portugal2030','backend/src/middlewares','test/integration/opportunity-v2'];
 const files=[];function visit(folder){for(const e of fs.readdirSync(folder,{withFileTypes:true})){const file=path.join(folder,e.name);if(e.isDirectory())visit(file);else if(/\.(sql|js|cjs|json)$/.test(file))files.push(file);}}
 for(const folder of roots)visit(path.join(root,folder));
 for(const file of ['backend/src/routes/opportunityInterestRoutes.js','backend/src/routes/organizationDashboardRoutes.js','backend/src/app.js','backend/src/productionComposition.js','backend/src/worker.js','backend/src/config/fundingTendersWorker.js','frontend/src/api/api.js','backend/scripts/runCentralMigrations.js','test/integration/opportunity-interests/proof.js','context/references/opportunity-v2/manifest.json'])files.push(path.join(root,file));
 return Object.fromEntries(files.sort().map(f=>[path.relative(root,f).replaceAll('\\','/'),createHash('sha256').update(fs.readFileSync(f)).digest('hex')]));
}
async function main(args=process.argv.slice(2)){
 const mode=parseArgs(args),gateId=randomUUID().replaceAll('-',''),name='c4g-s6-'+gateId;
 const folder=path.join(root,'output','opportunity-v2-s6-'+gateId);fs.mkdirSync(folder,{recursive:true});
 const report={gateId,status:'RUNNING',mode:mode.activationHttpOnly?'ACTIVATION_HTTP_ONLY':mode.temporalOnly?'TEMPORAL_ONLY':mode.bootstrapOnly?'BOOTSTRAP_ONLY':'FULL',checks:[],cleanup:false,isolated:true,habitualEnvironmentAccess:false,startedAt:new Date().toISOString(),inputHashes:inputHashes(),limitations:['Fixtures only; no production data or source recollection.','No OIDC or production authority integration is certified.','Candidate SQL is not registered in active migration manifests.']};
 const save=()=>fs.writeFileSync(path.join(folder,'verification.json'),JSON.stringify(report,null,2)+'\n');save();
 const secret=randomBytes(32).toString('hex'),dockerEnv={...process.env,POSTGRES_PASSWORD:secret};
 const docker=argv=>execFileSync('docker',argv,{encoding:'utf8',windowsHide:true,timeout:30000,stdio:['ignore','pipe','pipe'],env:dockerEnv}).trim();
 let container,attempted=false,adminPool,pool,tenantPool;
 const owned=()=>{assert.match(container,/^[a-f0-9]{64}$/);assert.equal(docker(['inspect','--format','{{index .Config.Labels "c4g.s6-gate"}}',container]),gateId);assert.equal(docker(['inspect','--format','{{.Name}}',container]),'/'+name);};
 async function check(label,work){report.phase=label;save();const start=Date.now();await work();report.checks.push({name:label,status:'PASS',durationMs:Date.now()-start});save();process.stdout.write('PASS '+label+'\n');}
 try{
  await check('OWNED_LOCAL_POSTGRES18',async()=>{
   assert.match(docker(['context','inspect','--format','{{.Endpoints.docker.Host}}']),/^(npipe:\/\/|unix:\/\/)/);
   if(process.env.DOCKER_HOST)assert.match(process.env.DOCKER_HOST,/^(npipe:\/\/|unix:\/\/)/);
   docker(['info','--format','{{.ServerVersion}}']);report.image=docker(['image','inspect','postgres:18-alpine','--format','{{.Id}}']);assert.match(report.image,/^sha256:[a-f0-9]{64}$/);
   attempted=true;container=docker(['run','--detach','--name',name,'--label','c4g.s6-gate='+gateId,'--env','POSTGRES_PASSWORD','--env','POSTGRES_USER=c4g_f12_admin','--env','POSTGRES_DB=postgres','--tmpfs','/var/lib/postgresql:rw','-p','127.0.0.1::5432',report.image]);owned();
   const binding=docker(['port',container,'5432/tcp']);assert.match(binding,/^127\.0\.0\.1:\d+$/);const port=Number(binding.split(':')[1]);assert(port>1024&&port!==5432);
   const config={host:'127.0.0.1',port,user:'c4g_f12_admin',password:secret,database:'postgres',max:8,connectionTimeoutMillis:3000,query_timeout:30000,options:'-c timezone=UTC -c statement_timeout=25000 -c lock_timeout=10000'};
   adminPool=new Pool(config);let ready=false;for(let n=0;n<80;n++){try{await adminPool.query('SELECT 1');ready=true;break;}catch{await new Promise(r=>setTimeout(r,250));}}assert(ready,'POSTGRES_NOT_READY');
   report.postgres=(await adminPool.query('SHOW server_version')).rows[0].server_version;report.containerId=container;
   for(const role of ['c4g_central_owner','c4g_central_runtime','c4g_tenant_owner','c4g_tenant_migrator','c4g_tenant_runtime','c4g_import_worker_runtime'])await adminPool.query(`CREATE ROLE ${role} NOLOGIN ${role.startsWith('c4g_central_')?'INHERIT':'NOINHERIT'} NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`);
   await adminPool.query('GRANT c4g_tenant_owner TO c4g_tenant_migrator');
   for(const db of ['s6_central','s6_tenant']){await adminPool.query(`CREATE DATABASE ${db} ENCODING 'UTF8' LOCALE_PROVIDER icu ICU_LOCALE 'und' TEMPLATE template0`);await adminPool.query(`REVOKE CONNECT,TEMP ON DATABASE ${db} FROM PUBLIC`);}
   await adminPool.query('GRANT CONNECT,CREATE ON DATABASE s6_tenant TO c4g_tenant_owner');await adminPool.query('GRANT CONNECT ON DATABASE s6_tenant TO c4g_tenant_migrator,c4g_tenant_runtime');
   pool=new Pool({...config,database:'s6_central'});tenantPool=new Pool({...config,database:'s6_tenant'});
   await tenantPool.query('REVOKE ALL ON SCHEMA public FROM PUBLIC');
   await adminPool.query("ALTER ROLE c4g_tenant_runtime IN DATABASE s6_tenant SET search_path TO pg_catalog,c4g_app");
  });
  if(mode.temporalOnly){await require('./temporal-proof.cjs').temporalProof({pool,check,report});}
  else{
   await check('BOOTSTRAP_CENTRAL035_TENANT033',async()=>{
    const central=require('../../../backend/src/security/centralMigrationManifest');
    await pool.query("CREATE TABLE public.c4g_database_identity(product_code text NOT NULL,database_role text NOT NULL);INSERT INTO public.c4g_database_identity VALUES('C4G','CENTRAL')");
    await require('../../../backend/scripts/runCentralMigrations').applyCentralMigrationsWithManifest(pool,central.manifest,central.migrationSql);
    const tenant=require('../../../backend/src/security/tenantMigrationManifest'),identity={tenantId:randomUUID(),databaseGenerationId:randomUUID()};
    const result=await require('../../../backend/src/security/tenantMigrationRunner').createTenantMigrationRunner({pool:tenantPool,entries:tenant.manifest,loadMigration:tenant.migrationSql,observationPublisher:{async publish(){}},timeoutMs:30000,scheduler:{setTimeout,clearTimeout}}).migrate({...identity,expectedRevision:1,correlationId:'s6-isolated',idempotencyKey:'s6-'+gateId});
    report.baseline={central:central.manifest.at(-1).version,tenant:result.evidence.currentVersion,tenantIdentity:identity};
   });
   if(mode.activationHttpOnly){
    await require('./activation-http-proof.cjs').activationHttpProof({pool,tenantPool,check,report,outputDirectory:folder});
   }else if(!mode.bootstrapOnly){
    report.reconciliation=await require('./reconciliation-proof.cjs').reconciliationProof({pool,check,report,evidenceDir:folder});
    const persisted=await require('./persistence-proof.cjs').persistenceProof({pool,check,report});
    await require('./temporal-proof.cjs').temporalProof({pool,check,report});
    await require('./tenant-proof.cjs').tenantProof({pool,tenantPool,check,report,persisted,outputDirectory:folder});
   }
  }
  assert.deepEqual(inputHashes(),report.inputHashes,'S6_INPUT_CHANGED_DURING_GATE');
  report.status='PASS';
 }catch(error){report.status='FAIL';report.failure={code:error.internalCode||error.code||'S6_GATE_FAILED',name:error.name,detail:String(error.message||'').slice(0,1600),location:String(error.stack||'').split('\n').filter(s=>s.includes('opportunity-v2')).slice(0,3)};process.stdout.write('FAIL '+report.phase+' '+report.failure.code+'\n');}
 finally{
  const ends=await Promise.allSettled([pool,tenantPool,adminPool].filter(Boolean).map(p=>p.end()));
  if(ends.some(e=>e.status==='rejected'))report.poolCleanupFailed=true;
  try{if(attempted){if(!container){const found=docker(['ps','-aq','--no-trunc','--filter','label=c4g.s6-gate='+gateId]).split(/\r?\n/).filter(Boolean);assert.equal(found.length,1);container=found[0];}owned();docker(['rm','-f',container]);assert.equal(docker(['ps','-aq','--filter','label=c4g.s6-gate='+gateId]),'');}report.cleanup=true;}catch{report.cleanup=false;report.status='FAIL';}
  report.finishedAt=new Date().toISOString();save();process.stdout.write(JSON.stringify({status:report.status,cleanup:report.cleanup,evidence:path.relative(root,folder).replaceAll('\\','/')})+'\n');
 }
 if(report.status!=='PASS')throw Error('S6_GATE_FAILED_SEE_REPORT');return report;
}
if(require.main===module)main().catch(()=>{process.exitCode=1;});
module.exports={parseArgs,inputHashes,main};
