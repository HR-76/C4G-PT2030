'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{randomUUID,createHash}=require('node:crypto'),{execFileSync}=require('node:child_process');
const {Pool}=require('../../../backend/node_modules/pg');
const {databaseFixture}=require('../http-oidc/fixture'),{seed}=require('../http-oidc/sqlProof');
const run=process.env.HTTP_PROOF_RUN,container=process.env.CIA_CONTAINER,reportName=process.env.CIA_REPORT;
assert(/^[a-f0-9]{32}$/.test(run));assert.equal(container,'c4g-cia-restore-'+run);assert(/^[a-z0-9-]+$/.test(reportName));
const out=path.resolve(__dirname,'../../../context/reviews',reportName);fs.mkdirSync(out);
const report={status:'RUNNING',checks:[],limits:['Synthetic data, disposable PostgreSQL and MinIO only; no real R2, production backups, WAL or disaster recovery.','MinIO cannot establish Cloudflare R2 provider compatibility.','CLEAN status is synthetic; no live antivirus proof.']};
const sourcePaths=['test/integration/cia-recovery/run.ps1','test/integration/cia-recovery/restore.cjs','test/integration/cia-recovery/proof.cjs','backend/src/documents/r2Storage.js','backend/src/documents/r2Adapter.js','backend/src/audit/appendService.js','backend/src/audit/postgresAppendRepository.js','backend/src/audit/verifier.js','backend/src/audit/integrity.js'];
const root=path.resolve(__dirname,'../../..'),hashSources=()=>Object.fromEntries(sourcePaths.map(p=>[p,createHash('sha256').update(fs.readFileSync(path.join(root,p))).digest('hex')]));
report.sourceHashes=hashSources();
const save=()=>fs.writeFileSync(path.join(out,'results.json'),JSON.stringify(report,null,2)+'\n');
const docker=(...args)=>execFileSync('docker',args,{stdio:['ignore','pipe','pipe'],encoding:'utf8',timeout:120000}).trim();
async function digest(pool,table){assert(/^[a-z_][a-z0-9_]*\.[a-z_][a-z0-9_]*$/.test(table));return (await pool.query(`SELECT count(*)::int AS count,md5(COALESCE(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text COLLATE "C")::text,'[]')) AS digest FROM ${table} t`)).rows[0];}
async function restore(admin,sourcePool,sourceName,targetName,tables){
 assert(/^[a-z0-9_]+$/.test(sourceName)&&/^cia_restore_[a-z]+$/.test(targetName));
 const archive='/tmp/'+targetName+'.dump';
 docker('exec',container,'pg_dump','-U','proof_admin','-Fc','-f',archive,sourceName);
 await admin.query(`CREATE DATABASE ${targetName} ENCODING 'UTF8' ${targetName==='cia_restore_central'?'':"LOCALE_PROVIDER icu ICU_LOCALE 'und'"} TEMPLATE template0`);
 docker('exec',container,'pg_restore','-U','proof_admin','--exit-on-error','-d',targetName,archive);
 const url=new URL(process.env.HTTP_PROOF_ADMIN_URL);url.pathname='/'+targetName;
 const target=new Pool({connectionString:url.toString(),max:2});
 const properties=async pool=>(await pool.query("SELECT pg_encoding_to_char(encoding) AS encoding,datlocprovider,datlocale,datcollate,datctype FROM pg_database WHERE datname=current_database()")).rows[0];
 assert.deepEqual(await properties(target),await properties(sourcePool));report.checks.push({target:targetName,databaseLocale:'EQUIVALENT'});
 for(const table of tables){const before=await digest(sourcePool,table),after=await digest(target,table);assert.deepEqual(after,before);report.checks.push({target:targetName,table,count:before.count,equivalent:true});}
 return target;
}
async function isolation(pool,org,otherOrg,expected){const c=await pool.connect();try{
 await c.query('BEGIN');await c.query('SET LOCAL ROLE c4g_opportunity_tenant_runtime');
 await c.query("SELECT set_config('app.organization_id',$1,true)",[org]);assert.equal((await c.query('SELECT count(*)::int n FROM opportunity_catalog.application')).rows[0].n,expected);
 await c.query("SELECT set_config('app.organization_id',$1,true)",[otherOrg]);assert.equal((await c.query('SELECT count(*)::int n FROM opportunity_catalog.application')).rows[0].n,0);
 report.checks.push({restoredTenantRls:'PASS',foreignOrganization:'DENIED'});
 }finally{await c.query('ROLLBACK');c.release();}}
async function main(){let db,admin,objects;const targets=[];
 try{
  const labels=JSON.parse(docker('inspect','--format','{{json .Config.Labels}}',container));assert.equal(labels['c4g.cia-restore'],run);
  db=await databaseFixture(report);admin=new Pool({connectionString:process.env.HTTP_PROOF_ADMIN_URL,max:1});
  const identity={issuer:'https://synthetic.example.invalid',user:async username=>({username,subject:randomUUID()})};
  const a=await db.tenant(identity,0),b=await db.tenant(identity,1);await seed(a,12,3);await seed(b,7,2);
  const objectContainer='c4g-cia-objects-'+run,objectLabels=JSON.parse(docker('inspect','--format','{{json .Config.Labels}}',objectContainer));assert.equal(objectLabels['c4g.cia-recovery'],run);
  objects=await require('./proof.cjs').setup(a,b,report);
  const centralName=new URL(db.central.connectionString).pathname.slice(1);
  const central=await restore(admin,db.central.pool,centralName,'cia_restore_central',['public.organization','public.global_user','public.organization_membership']);targets.push(central);
  const tables=['c4g_system.tenant_identity','c4g_system.schema_migration','opportunity_catalog.opportunity','opportunity_catalog.application','opportunity_catalog.application_change','organizational_scope.person','organizational_scope.person_profile','document_storage.document','document_storage.document_version','audit.event','audit.event_identity','audit.chain_head'];
  const ar=await restore(admin,a.pool,a.credentials.database,'cia_restore_tenanta',tables);targets.push(ar);
  const br=await restore(admin,b.pool,b.credentials.database,'cia_restore_tenantb',tables);targets.push(br);
  await isolation(ar,a.organizationId,b.organizationId,12);await isolation(br,b.organizationId,a.organizationId,7);
  const aid=(await ar.query('SELECT tenant_id,database_generation_id FROM c4g_system.tenant_identity')).rows[0],bid=(await br.query('SELECT tenant_id,database_generation_id FROM c4g_system.tenant_identity')).rows[0];assert.notEqual(aid.tenant_id,bid.tenant_id);assert.notEqual(aid.database_generation_id,bid.database_generation_id);
  report.checks.push({tenantMarkers:'PRESERVED_DISTINCT',note:'Markers are restored copies; no restored database is admitted to the live directory.'});
  await require('./proof.cjs').recover(objects,[ar,br],report);objects=null;
  assert.deepEqual(hashSources(),report.sourceHashes);report.sourceIntegrity='UNCHANGED';report.status='PASS';save();console.log('RESTORE_SYNTHETIC_PASS');
 }finally{if(objects){await Promise.allSettled([objects.aStore.shutdown(),objects.bStore.shutdown()]);objects.s3.destroy();}await Promise.allSettled(targets.map(p=>p.end()));await db?.close();await admin?.end();}
}
main().catch(error=>{report.status='FAIL';report.error={name:error.name,code:error.code||null,message:String(error.message).replace(/postgres(?:ql)?:\/\/\S+/g,'[redacted]').slice(0,500)};save();console.error('RESTORE_SYNTHETIC_FAILED',error.code||error.name);process.exitCode=1;});
