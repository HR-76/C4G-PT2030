'use strict';
// Fixed, previously owned restore cluster. Never accepts a live endpoint.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{spawnSync}=require('node:child_process');
const cfg=require('../../../backend/scripts/localPlatform/config'),{Pool}=require('../../../backend/node_modules/pg');
const {ownedCluster}=require('../../../backend/scripts/localPlatform/backupOpportunityInterests');
const id='ce08320b-bd74-45a9-b64b-1a5fa090a85d',folder=path.join(cfg.folder,'interest-backup-'+id),cluster=path.join(folder,'restore-cluster');
const bin='C:/Program Files/PostgreSQL/18/bin';
function run(exe,args,connection){const r=spawnSync(path.join(bin,exe+'.exe'),args,{windowsHide:true,stdio:'ignore',timeout:60000,env:{...process.env,...(connection?{PGPASSWORD:connection.password,PGOPTIONS:'-c timezone=UTC'}:{})}});assert.equal(r.status,0,'ISOLATED_TOOL_FAILED');}
async function main(){
 assert.deepEqual(process.argv.slice(2),['--isolated']);ownedCluster(folder,cluster,id);assert(!fs.existsSync(path.join(cluster,'postmaster.pid')));
 const configText=fs.readFileSync(path.join(cluster,'postgresql.conf'),'utf8'),port=Number(configText.match(/^port=(\d+)$/m)[1]);assert.notEqual(port,5432);
 const connection={host:'127.0.0.1',port,user:'postgres',password:fs.readFileSync(path.join(folder,'restore-password'),'utf8'),options:'-c timezone=UTC'};
 const report={status:'IN_PROGRESS',isolated:true,stages:[],cleanup:false};let central,tenant,authorityBase;
 try{
  run('pg_ctl',['-D',cluster,'-l',path.join(folder,'restore-server.log'),'-w','-t','30','start']);
  for(const name of ['central','tenant'])run('pg_restore',['--no-password','-h',connection.host,'-p',String(port),'-U','postgres','--exit-on-error','--clean','--if-exists','--create','-d','postgres',path.join(folder,name+'.dump')],connection);
  central=new Pool({...connection,database:'c4g_central_dev'});tenant=new Pool({...connection,database:'c4g_tenant_dev'});
  await tenant.query(fs.readFileSync(path.join(folder,'tenant-restore-acl.sql'),'utf8'));
  authorityBase=new Pool({...connection,database:'c4g_central_dev'});
  const authority={async connect(){const c=await authorityBase.connect();await c.query('SET SESSION AUTHORIZATION c4g_authority_runtime');return c;},async query(...args){const c=await this.connect();try{return await c.query(...args)}finally{c.release()}}};
  const names=['runtime.json','members/worker.json'],files=[];
  for(const name of names){const file=path.join(folder,'activation-rehearsal',name);fs.mkdirSync(path.dirname(file),{recursive:true});fs.copyFileSync(path.join(folder,'configuration/.tmp/local-platform',name),file);files.push(file);}
  const state=JSON.parse(fs.readFileSync(files[0])),plan=JSON.parse(fs.readFileSync(path.join(cfg.folder,'opportunity-interest-activation-plan.json')));
  assert.equal(plan.tenant.version,'030_organization_notices');assert.equal(plan.tenantId,state.tenantId);
  report.result=await require('../../../scripts/interest-activation.cjs').activate({central,tenant,authority,state,stateFiles:files,plan,checkpoint:stage=>{report.stages.push(stage);console.log(stage)}});
  const reader=await tenant.connect();
  try{
   await reader.query('SET SESSION AUTHORIZATION c4g_local_api');await reader.query('BEGIN READ ONLY');
   const observed=await require('../../../backend/src/security/tenantRuntimeMetadata').observeTenantRuntimeMetadata(reader,{tenantId:state.tenantId,databaseGenerationId:state.generationId});
   assert.equal(observed.currentVersion,'033_organizational_opportunity_interests');report.restrictedApiMetadata=true;
  }finally{await reader.query('ROLLBACK');await reader.query('RESET SESSION AUTHORIZATION');reader.release();}
  report.status='PASS';
 }catch(e){report.status='FAIL';report.code=e.internalCode||e.code||'ACTIVATION_REHEARSAL_FAILED';report.location=String(e.stack||'').match(/interest-activation\.cjs:\d+:\d+/)?.[0]||null;report.assertion=String(e.message||'').split('\n')[0].match(/^[A-Z0-9_]+$/)?.[0]||null;throw e;}
 finally{
  await Promise.allSettled([central,tenant,authorityBase].filter(Boolean).map(p=>p.end()));
  if(fs.existsSync(path.join(cluster,'postmaster.pid'))){ownedCluster(folder,cluster,id);run('pg_ctl',['-D',cluster,'-m','fast','-w','-t','30','stop']);}
  report.cleanup=!fs.existsSync(path.join(cluster,'postmaster.pid'));report.at=new Date().toISOString();
  cfg.saveState(report,path.join(cfg.root,'output/organizational-opportunity-interest/activation-rehearsal.json'));console.log(JSON.stringify(report));
 }
}
main().catch(()=>{console.error('ISOLATED_ACTIVATION_REHEARSAL_FAILED');process.exitCode=1});
