'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const schema=require('../../src/security/centralSchemaManifest'),authority=require('../../src/security/authoritySecurityManifest');
const admission=require('../../src/security/userDeletionAdmission'),email=require('../../src/security/memberEmailAdmission');
const version='053_opportunity_complement',checksum='5ea3e482f88f76ac3e17509e3f549b1777411449ed7b85ebe71305d2e0ffcda8';
const tables=['global_user','auth_identity_ref','organization','organization_membership','platform_admin_assignment','application_session','application_session_store','platform_member_operation','platform_member_invitation','platform_onboarding_operation','platform_onboarding_invitation','entity_admission','entity_admission_invitation','authority_f5_state','c4g_schema_migration'];
async function records(client){const result={};for(const table of tables)result[table]=(await client.query(`SELECT count(*)::text AS count,md5(coalesce(string_agg(value,E'\\n' ORDER BY value),'')) AS digest FROM (SELECT to_jsonb(t)::text AS value FROM public.${table} t) rows`)).rows[0];return result;}
async function rollout(pool,{mode,expectedDatabase}){
 if(!['check','rehearse','apply'].includes(mode))throw Error('USER_DELETION_MODE_REQUIRED');
 const sql=fs.readFileSync(path.join(__dirname,'../../database/central/candidates/platform_user_deletion.up.sql'),'utf8').replace(/\r\n/g,'\n');
 if(crypto.createHash('sha256').update(sql).digest('hex')!==checksum)throw Error('USER_DELETION_PACKAGE_CHANGED');
 const client=await pool.connect();let begun=false;
 try{
  await client.query(mode==='check'?'BEGIN READ ONLY':'BEGIN');begun=true;
  await client.query("SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='60s'");
  if((await client.query('SELECT current_database() AS name')).rows[0].name!==expectedDatabase)throw Error('USER_DELETION_TARGET_MISMATCH');
  if(mode!=='check'){await client.query('SELECT pg_advisory_xact_lock(42420002)');await client.query('SELECT pg_advisory_xact_lock(43001306,1)');}
  if((await client.query('SELECT version FROM public.c4g_schema_migration ORDER BY version DESC LIMIT 1')).rows[0].version!==version)throw Error('USER_DELETION_VERSION_REQUIRED');
  const beforeFingerprint=await schema.assertCentralSchema(client,version),installed=admission.admits(version,'schema',beforeFingerprint);
  if(!installed&&!email.admits(version,'schema',beforeFingerprint))throw Error('USER_DELETION_BASE_VARIANT_REQUIRED');
  const before=await records(client);
  if(!installed&&mode!=='check')await client.query(sql);
  const afterFingerprint=await schema.assertCentralSchema(client,version);
  await authority.assertAuthoritySecurity(client,version);
  await require('../../src/security/catalogReaderSchema').assertCatalogReaderSchema(client);
  assert.deepEqual(await records(client),before,'existing records must remain identical');
  if(mode!=='check'&&!admission.admits(version,'schema',afterFingerprint))throw Error('USER_DELETION_PATCH_NOT_PRESENT');
  await client.query(mode==='apply'?'COMMIT':'ROLLBACK');begun=false;
  return {mode,version,alreadyInstalled:installed,installed:installed||mode==='apply',rehearsalPassed:mode==='rehearse',recordsPreserved:true,fingerprint:afterFingerprint,counts:Object.fromEntries(Object.entries(before).map(([key,value])=>[key,value.count]))};
 }finally{if(begun)await client.query('ROLLBACK').catch(()=>{});client.release();}
}
async function main(){
 const [flag,...extra]=process.argv.slice(2);
 if(extra.length||!['--check','--rehearse','--apply'].includes(flag))throw Error('USER_DELETION_MODE_REQUIRED');
 if(process.env.PUBLIC_APP_URL!=='https://app-teste.c4g.ai'||new URL(process.env.CENTRAL_DATABASE_URL).pathname!=='/c4g_central_staging')throw Error('USER_DELETION_STAGING_REQUIRED');
 const options=require('../../src/config/databaseConfig').databasePoolOptions(process.env,'CENTRAL_DATABASE_URL','CENTRAL_DB');
 const pool=new (require('pg').Pool)({...options,max:1,connectionTimeoutMillis:5000});
 try{console.log(JSON.stringify(await rollout(pool,{mode:flag.slice(2),expectedDatabase:'c4g_central_staging'})));}finally{await pool.end();}
}
if(require.main===module)main().catch(error=>{console.error(JSON.stringify({error:/^[A-Z][A-Z0-9_]{2,80}$/.test(error.message||'')?error.message:'USER_DELETION_ROLLOUT_FAILED'}));process.exitCode=1;});
module.exports={rollout};
