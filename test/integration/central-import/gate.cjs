'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {execFileSync}=require('node:child_process'),{randomUUID,randomBytes,createHash}=require('node:crypto');
const {Pool}=require('../../../backend/node_modules/pg');
const root=path.resolve(__dirname,'../../..');
async function main(){
 assert.deepEqual(process.argv.slice(2),['--isolated']);
 const id=randomUUID(),name='c4g-central-import-'+id;
 const report={status:'RUNNING',isolated:true,habitualEnvironmentAccess:false,checks:[],cleanup:false};
 const folder=path.join(root,'output',name);fs.mkdirSync(folder,{recursive:true});
 const password=randomBytes(32).toString('hex');
 const docker=args=>execFileSync('docker',args,{encoding:'utf8',windowsHide:true,timeout:30000,stdio:['ignore','pipe','pipe'],env:{...process.env,POSTGRES_PASSWORD:password}}).trim();
 const inputFiles=['backend/database/central/candidates/pt2030_document_upload.up.sql','backend/src/security/centralImportMigrationPackage.js','backend/src/security/centralImportSecurity.js','backend/src/security/centralMigrationManifest.js','backend/src/security/centralSchemaManifest.js','backend/src/security/centralMigrationPreflight.js','backend/src/security/catalogReaderSchema.js','backend/src/security/catalogReaderSecurity.js','backend/scripts/runCentralMigrations.js','backend/src/opportunities/catalogRead/readSchema.js','backend/src/opportunities/catalogRead/ledgerContract.js','backend/src/portugal2030/uploadRuntime.js','test/integration/central-import/gate.cjs','test/integration/central-import/proof.cjs'];
 const hashes=()=>Object.fromEntries(inputFiles.map(f=>[f,createHash('sha256').update(fs.readFileSync(path.join(root,f))).digest('hex')]));
 report.inputHashes=hashes();
 let container,admin,pool,attempted=false;
 const owned=()=>{assert.match(container,/^[a-f0-9]{64}$/);assert.equal(docker(['inspect','--format','{{index .Config.Labels "c4g.central-import-gate"}}',container]),id);assert.equal(docker(['inspect','--format','{{.Name}}',container]),'/'+name);};
 const check=async(name,fn)=>{report.phase=name;await fn();report.checks.push({name,status:'PASS'});console.log('PASS '+name);};
 try{
  assert.match(docker(['context','inspect','--format','{{.Endpoints.docker.Host}}']),/^(npipe:\/\/|unix:\/\/)/);
  if(process.env.DOCKER_HOST)assert.match(process.env.DOCKER_HOST,/^(npipe:\/\/|unix:\/\/)/);
  const image=docker(['image','inspect','postgres:18-alpine','--format','{{.Id}}']);assert.match(image,/^sha256:[a-f0-9]{64}$/);report.image=image;
  attempted=true;container=docker(['run','--detach','--name',name,'--label','c4g.central-import-gate='+id,'--env','POSTGRES_PASSWORD','--env','POSTGRES_USER=c4g_f12_admin','--tmpfs','/var/lib/postgresql:rw','-p','127.0.0.1::5432',image]);owned();
  const binding=docker(['port',container,'5432/tcp']);assert.match(binding,/^127\.0\.0\.1:\d+$/);const port=Number(binding.split(':')[1]);assert(port>1024&&port!==5432&&port!==5433);
  const connection={host:'127.0.0.1',port,user:'c4g_f12_admin',password,connectionTimeoutMillis:3000,query_timeout:60000,options:'-c timezone=UTC -c statement_timeout=55000'};
  admin=new Pool({...connection,database:'postgres'});let ready=false;for(let i=0;i<80;i++){try{await admin.query('SELECT 1');ready=true;break;}catch{await new Promise(r=>setTimeout(r,250));}}assert(ready);
  await admin.query("CREATE DATABASE central_import_gate ENCODING 'UTF8' LOCALE_PROVIDER icu ICU_LOCALE 'und' TEMPLATE template0");
  pool=new Pool({...connection,database:'central_import_gate'});
  await check('BASELINE_048',async()=>{
   for(const role of ['c4g_central_owner','c4g_central_runtime','c4g_tenant_owner','c4g_tenant_migrator','c4g_tenant_runtime','c4g_import_worker_runtime'])await pool.query(`CREATE ROLE ${role} NOLOGIN ${role.startsWith('c4g_central_')?'INHERIT':'NOINHERIT'} NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`);
   await pool.query('GRANT c4g_tenant_owner TO c4g_tenant_migrator');
   await pool.query("CREATE TABLE public.c4g_database_identity(product_code text NOT NULL,database_role text NOT NULL);INSERT INTO public.c4g_database_identity VALUES('C4G','CENTRAL')");
   const m=require('../../../backend/src/security/centralMigrationManifest'),r=require('../../../backend/scripts/runCentralMigrations');
   await r.applyCentralMigrationsWithManifest(pool,m.prearchiveManifest,m.migrationSql);
   await r.applyRegisteredCatalogReadPackage(pool,'catalog-read-v1');
   await require('../../../backend/src/security/centralSchemaManifest').assertCentralSchema(pool,'048_catalog_read_service_v1');
  });
  await require('./proof.cjs')({pool,report,check,connection});assert.deepEqual(hashes(),report.inputHashes,'GATE_INPUT_CHANGED');report.status='PASS';
 }catch(e){report.status='FAIL';report.failure={code:e.code||e.name,message:String(e.message).slice(0,1400),stack:String(e.stack).split('\n').slice(1,4)};console.log('FAIL '+report.phase);}
 finally{
  await Promise.allSettled([pool,admin].filter(Boolean).map(p=>p.end()));
  try{if(attempted){if(!container){const found=docker(['ps','-aq','--no-trunc','--filter','label=c4g.central-import-gate='+id]).split(/\r?\n/).filter(Boolean);assert.equal(found.length,1);container=found[0];}owned();docker(['rm','-f',container]);}report.cleanup=true;}catch{report.status='FAIL';}
  fs.writeFileSync(path.join(folder,'verification.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({status:report.status,cleanup:report.cleanup,evidence:folder}));
 }
 if(report.status!=='PASS')process.exitCode=1;
}
main();
