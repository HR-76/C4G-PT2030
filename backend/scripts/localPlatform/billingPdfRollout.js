'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {execFileSync}=require('node:child_process'),{createHash,randomUUID}=require('node:crypto'),{Readable}=require('node:stream');
const {Pool}=require('pg'),cfg=require('./config');
const hash=b=>createHash('sha256').update(b).digest('hex');
const run=(file,args)=>execFileSync(file,args,{windowsHide:true,encoding:'utf8',stdio:['ignore','pipe','pipe'],timeout:30000}).trim();
function protect(folder){
 fs.mkdirSync(folder,{recursive:true});const sid=run('whoami',['/user','/fo','csv','/nh']).match(/S-1-5-[0-9-]+/)?.[0];assert(sid);
 run('icacls',[folder,'/inheritance:r','/grant:r',`*${sid}:(OI)(CI)F`,'*S-1-5-18:(OI)(CI)F']);
}
async function verifyStorage(root){
 const organizationId=randomUUID(),objectId=randomUUID();
 const storage=require('../../src/customerBilling/localStorage').createLocalBillingStorage({root,organizationId,environment:'development'});
 const scanner=require('../../src/documents/clamavScanner').createClamavScanner({organizationId,storage,port:3310,timeoutMs:10000});
 assert.equal((await scanner.health()).ready,true,'CLAMAV_REQUIRED');
 const b=Buffer.from('%PDF-1.7\n% Local infrastructure verification only\n'),sha256=hash(b);
 const handle=await storage.beginWrite({objectId,storageClass:'QUARANTINE',expectedSize:b.length,expectedSha256:sha256,declaredMime:'application/pdf',conditionalCreate:true});
 await storage.write(handle,Readable.from([b]));await storage.commit(handle,{size:b.length,sha256,mime:'application/pdf'});
 assert.equal((await scanner.scan({organizationId,objectId,expectedSize:b.length,expectedSha256:sha256})).status,'CLEAN');
 const reopened=require('../../src/customerBilling/localStorage').createLocalBillingStorage({root,organizationId,environment:'development'});assert.equal((await reopened.head({objectId,storageClass:'QUARANTINE'})).sha256,sha256);
 // Harmless antivirus test signature remains in memory, not in application storage.
 const eicar=Buffer.from('X5O!P%@AP[4\\PZX54(P^)7CC)7}$'+'EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*');
 const av=require('../../src/documents/clamavScanner').createClamavScanner({organizationId,port:3310,storage:{head:async()=>({size:eicar.length,sha256:hash(eicar),etag:'test'}),readRange:async({start,end})=>Readable.from([eicar.subarray(start,end+1)])}});
 assert.equal((await av.scan({organizationId,objectId,expectedSize:eicar.length,expectedSha256:hash(eicar)})).status,'INFECTED');
 await storage.shutdown();await reopened.shutdown();return {persistentRead:true,cleanScan:true,infectedRejected:true};
}
async function main(){
 assert.deepEqual(process.argv.slice(2),['--apply']);const config=cfg.readConfig(),state=JSON.parse(fs.readFileSync(path.join(cfg.folder,'runtime.json'),'utf8'));
 require('./platformBillingRollout').assertRolloutTarget(config,state);
 const folder=path.join(cfg.folder,'billing-pdfs');protect(folder);const objects=path.join(folder,'objects');protect(objects);
 assert.equal(run('docker',['inspect','--format','{{index .Config.Labels "c4g.component"}}','c4g-billing-clamav']),'billing-private-pdfs');
 assert.equal(run('docker',['port','c4g-billing-clamav','3310/tcp']),'127.0.0.1:3310');
 const scanner=await verifyStorage(objects),backup=path.join(folder,'backup-'+Date.now());protect(backup);
 fs.copyFileSync(path.join(cfg.folder,'runtime.json'),path.join(backup,'runtime.json'));
 const central=new Pool(cfg.connection(config,config.centralDatabase)),tenant=new Pool(cfg.connection(config,config.tenantDatabase));
 try{
  const preflight=require('../../src/security/centralMigrationPreflight').preflightCentral;
  const before=await preflight(central);assert(['048_catalog_read_service_v1','049_pt2030_document_upload','050_billing_private_documents'].includes(before.currentVersion));
  const bin='C:/Program Files/PostgreSQL/18/bin',snapshots={};
  for(const [name,pool] of [[config.centralDatabase,central],[config.tenantDatabase,tenant]]){
   const dump=path.join(backup,name+'.dump');snapshots[name]=await require('./platformBillingRollout').dumpConsistent({pool,config,bin,database:name,dump});run(path.join(bin,'pg_restore.exe'),['--list',dump]);
  }
  fs.writeFileSync(path.join(backup,'before.json'),JSON.stringify(snapshots,null,2));
  const runner=require('../runCentralMigrations');let applied=[];
  if(before.currentVersion==='048_catalog_read_service_v1')applied.push(...await runner.applyRegisteredCentralImportPackage(central,'central-pt2030-upload-preview-v1'));
  applied.push(...await runner.applyRegisteredBillingPdfsPackage(central,'billing-private-documents-v1'));
  assert.equal((await preflight(central)).currentVersion,'050_billing_private_documents');
  for(const [name,pool] of [[config.centralDatabase,central],[config.tenantDatabase,tenant]])for(const [table,value] of Object.entries(snapshots[name].data)){
   const rows=(await pool.query(`SELECT to_jsonb(t)::text AS row FROM ${table} t`)).rows.map(r=>r.row).sort();assert.deepEqual({count:rows.length,digest:hash(JSON.stringify(rows))},value,'EXISTING_DATA_CHANGED');
  }
  state.billingPdfs={mode:'local-private',installedAt:new Date().toISOString(),scannerContainer:'c4g-billing-clamav',schema:'050_billing_private_documents'};cfg.saveState(state);
  const report={status:'PASS',applied,scanner,existingDataPreserved:true,backup:path.relative(cfg.root,backup),fiscalProviderEnabled:false};fs.writeFileSync(path.join(folder,'installation.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
 }finally{await central.end();await tenant.end()}
}
if(require.main===module)main().catch(e=>{console.error(e.code||'BILLING_PDF_ROLLOUT_FAILED');process.exitCode=1});
module.exports={verifyStorage};
