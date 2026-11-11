'use strict';
const fs=require('node:fs'),path=require('node:path'),{Pool}=require('pg');
const cfg=require('./config');
const {preflightCentral}=require('../../src/security/centralMigrationPreflight');
const {applyCentralMigrationsWithManifest}=require('../runCentralMigrations');
const {manifest,migrationSql}=require('../../src/security/centralMigrationManifest');
async function main(){
 const apply=process.argv.includes('--apply');
 if(process.argv.slice(2).some(x=>!['--apply','--check'].includes(x)))throw Error('ACTIVATION_ARGUMENT_INVALID');
 const config=cfg.readConfig();
 if(config.host!=='localhost'||config.port!==5432||config.centralDatabase!=='c4g_central_dev')throw Error('LOCAL_TARGET_REQUIRED');
 const stateFile=path.join(cfg.folder,'runtime.json'),original=fs.readFileSync(stateFile,'utf8'),state=JSON.parse(original);
 if(state.phase!=='READY'||state.funding?.source!=='live-local')throw Error('LOCAL_RUNTIME_REQUIRED');
 const pool=new Pool(cfg.connection(config,config.centralDatabase));
 try{
  const before=await preflightCentral(pool);
  if(!['033_funding_coverage','034_funding_temporal_refresh'].includes(before.currentVersion))throw Error('ACTIVATION_PREDECESSOR_UNEXPECTED');
  const conflicts=Number((await pool.query("SELECT count(*) n FROM (SELECT global_user_id FROM public.organization_membership WHERE status IN ('PENDING_PROJECTION','ACTIVE','SUSPENDED') GROUP BY global_user_id HAVING count(*)>1) x")).rows[0].n);
  const active=Number((await pool.query("SELECT count(*) n FROM opportunity_catalog.funding_run WHERE status IN ('QUEUED','RUNNING')")).rows[0].n);
  const counts=async()=> (await pool.query('SELECT (SELECT count(*)::int FROM opportunity_catalog.funding_identity) identities,(SELECT count(*)::int FROM opportunity_catalog.revision) revisions,(SELECT count(*)::int FROM public.organization_membership) memberships')).rows[0];
  const preserved=await counts();
  console.log(JSON.stringify({mode:apply?'apply':'check',version:before.currentVersion,conflicts,active,...preserved}));
  if(conflicts)throw Error('SINGLE_MEMBERSHIP_EXISTING_CONFLICT');
  if(active)throw Error('ACTIVE_COLLECTION_MUST_FINISH');
  if(!apply)return;
  if(fs.readFileSync(stateFile,'utf8')!==original)throw Error('LOCAL_STATE_CHANGED');
  const applied=await applyCentralMigrationsWithManifest(pool,manifest.filter(entry=>entry.version<='034_funding_temporal_refresh'),migrationSql);
  const after=await preflightCentral(pool);
  if(after.currentVersion!=='034_funding_temporal_refresh'||JSON.stringify(await counts())!==JSON.stringify(preserved))throw Error('ACTIVATION_VERIFICATION_FAILED');
  if(fs.readFileSync(stateFile,'utf8')!==original)throw Error('LOCAL_STATE_CHANGED');
  cfg.saveState({...state,funding:{...state.funding,coverage:'durable-v1'}});
  console.log(JSON.stringify({status:'MIGRATED_AND_CONFIGURED',applied,version:after.currentVersion,...preserved,restartRequired:true}));
 }finally{await pool.end()}
}
main().catch(error=>{console.error(/^[A-Z][A-Z0-9_]+$/.test(error.message)?error.message:error.code||'LOCAL_ACTIVATION_FAILED');process.exitCode=1});
