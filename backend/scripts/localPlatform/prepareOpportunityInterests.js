'use strict';
// Read-only preparation. There is deliberately no apply mode or migration runner.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{createHash}=require('node:crypto');
const cfg=require('./config');
const VERSION='033_organizational_opportunity_interests';
const ALLOWED=Object.freeze({ORG_ADMIN:['read','register','manage'],FUNDING_MANAGER:['read','register','manage'],CONTRIBUTOR:['read','register'],VIEWER:['read']});
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
function args(values){if(values.length!==1||values[0]!=='--prepare')throw Error('INTEREST_PREPARE_ONLY');}
function baselineManifest(version){return Object.freeze(require('../../src/security/tenantMigrationManifest').manifest.filter(entry=>entry.ordinal<=Number(version.slice(0,3))));}
function status(preflight,pending){return !preflight.passed?'PREPARED_BASELINE_BLOCKED':pending.length>1?'PREPARED_DEPENDENCIES_IDENTIFIED':'PREPARED_NOT_APPLIED';}
function target(config,state){
 cfg.assertTarget(config);assert.equal(config.host,'localhost');assert.equal(config.port,5432);
 assert.equal(config.centralDatabase,'c4g_central_dev');assert.equal(config.tenantDatabase,'c4g_tenant_dev');assert.equal(state.phase,'READY');
 assert.deepEqual(state.target,{host:config.host,port:config.port,centralDatabase:config.centralDatabase,tenantDatabase:config.tenantDatabase});
 assert.equal(state.snapshot?.organizationId,state.organizationId);assert.equal(state.snapshot?.tenantId,state.tenantId);
 for(const key of ['organizationId','tenantId','generationId'])assert.match(state[key]||'',/^[a-f0-9-]{36}$/i);
 assert.equal(state.credentials?.database,config.tenantDatabase);assert.equal(state.credentials?.tenantId,state.tenantId);
}
function grantPlan(row,organizationId){
 assert.equal(row.organization_id,organizationId);
 const result={membershipId:row.membership_id,profile:row.base_role_code,membershipVersion:Number(row.membership_version),eligible:row.eligible,addPermissions:[]};
 if(!row.eligible)return {...result,reason:'INACTIVE_OR_OUTSIDE_VALIDITY'};
 if(!Object.hasOwn(ALLOWED,row.base_role_code))throw Error('INTEREST_PROFILE_REQUIRES_REVIEW');
 if(!Array.isArray(row.grants)||!Number.isSafeInteger(Number(row.authorization_version))||Number(row.authorization_version)<1)throw Error('INTEREST_AUTHORITY_REQUIRED');
 const desired=ALLOWED[row.base_role_code].map(action=>'opportunity_interest.'+action);
 if(row.grants.some(grant=>grant.permission?.startsWith('opportunity_interest.')&&!desired.includes(grant.permission)))throw Error('INTEREST_EXISTING_GRANT_REQUIRES_REVIEW');
 result.authorizationVersion=Number(row.authorization_version);
 result.authorityDigest=hash({grants:row.grants,policy:row.policy_version,assurance:row.assurance_requirements});
 result.addPermissions=desired.filter(permission=>!row.grants.some(g=>g.permission===permission&&!g.resourceId&&!g.resourceType&&g.scope?.type==='ORGANIZATION'&&g.scope.id===organizationId&&g.scope.organizationId===organizationId));
 return result;
}
async function readonly(pool,work){const client=await pool.connect();try{await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');const value=await work(client);await client.query('ROLLBACK');return value;}catch(error){await client.query('ROLLBACK').catch(()=>{});throw error;}finally{client.release();}}
async function main(values=process.argv.slice(2)){
 args(values);const config=cfg.readConfig(),stateFile=path.join(cfg.folder,'runtime.json'),state=JSON.parse(fs.readFileSync(stateFile));target(config,state);
 const {Pool}=require('pg');
 const pool=database=>new Pool({...cfg.connection(config,database),max:1,options:'-c timezone=UTC -c default_transaction_read_only=on -c statement_timeout=20000 -c lock_timeout=3000'});
 const central=pool(config.centralDatabase),tenant=pool(config.tenantDatabase);
 try{
  const {manifest}=require('../../src/security/tenantMigrationManifest'),head=manifest.at(-1);assert.equal(head.version,VERSION);
  const centralVersion=await require('../../src/security/centralMigrationPreflight').preflightCentral(central);
  const authority=await readonly(central,async client=>{
   const rows=(await client.query(`SELECT m.id membership_id,m.organization_id,m.base_role_code,m.membership_version,f.authorization_version,f.grants,f.policy_version,f.assurance_requirements,
    (m.status='ACTIVE' AND o.status='ACTIVE' AND u.status='ACTIVE' AND m.valid_from<=clock_timestamp() AND (m.valid_until IS NULL OR m.valid_until>clock_timestamp())) eligible
    FROM public.organization_membership m JOIN public.organization o ON o.id=m.organization_id JOIN public.global_user u ON u.id=m.global_user_id
    LEFT JOIN public.authority_f5_state f ON f.organization_id=m.organization_id AND f.membership_id=m.id WHERE m.organization_id=$1 ORDER BY m.id`,[state.organizationId])).rows;
   const schema=(await client.query('SELECT current_version,target_version,compatibility_state,revision,verified_capabilities FROM public.tenant_schema_state WHERE tenant_id=$1',[state.tenantId])).rows;
   const bindings=(await client.query('SELECT workload,current_connection_version,lifecycle_status,compatibility_status,provisioning_status,fence,revision FROM public.tenant_workload_binding WHERE tenant_id=$1 ORDER BY workload',[state.tenantId])).rows;
   return {memberships:rows.map(row=>grantPlan(row,state.organizationId)),schema,bindings};
  });
  const observed=await readonly(tenant,async client=>{
   const current=(await client.query('SELECT migration_id FROM c4g_system.schema_migration ORDER BY ordinal DESC LIMIT 1')).rows[0]?.migration_id;
   if(!['030_organization_notices','031_application_document_transport','032_document_worker_runtime',VERSION].includes(current))throw Error('INTEREST_UNEXPECTED_BASELINE');
   const {tenantSchemaSnapshot,tenantSchemaFingerprint}=require('../../src/security/tenantSchemaFingerprint');
   const fingerprint=tenantSchemaFingerprint(await tenantSchemaSnapshot(client));
   const ledger=(await client.query('SELECT migration_id,ordinal,checksum_sha256,irreversible,resulting_fingerprint FROM c4g_system.schema_migration ORDER BY ordinal')).rows;
   const historical=require('../../src/security/tenantHistoricalOwnership');
   const ledgerObservation={digest:historical.ledgerDigest(ledger),matchesHistoricalOwnershipBaseline:historical.isHistoricalOwnershipLedger(ledger)};
   const tables={};for(const table of ['application','application_change','application_receipt','application_participant','application_work_change','organization_opportunity']){
    const rows=(await client.query(`SELECT to_jsonb(t) AS row FROM opportunity_catalog.${table} t ORDER BY to_jsonb(t)::text`)).rows;
    tables[table]={count:rows.length,digest:hash(rows)};
   }
   let preflight={passed:true};
   try{await require('../../src/security/tenantMigrationPreflight').preflightTenantClient(client,{tenantId:state.tenantId,databaseGenerationId:state.generationId},baselineManifest(current));}
   catch(error){const code=error.internalCode||error.code||'';preflight={passed:false,code:/^[A-Z0-9_]{3,100}$/.test(code)?code:'PREFLIGHT_FAILED'};}
   return {version:current,fingerprint,ledger:ledgerObservation,preflight,tables};
  });
  const pendingMigrations=manifest.filter(entry=>entry.ordinal>Number(observed.version.slice(0,3))).map(entry=>({version:entry.version,checksum:entry.sqlChecksum}));
  const report={status:status(observed.preflight,pendingMigrations),pendingMigrations,observedAt:new Date().toISOString(),target:state.target,organizationId:state.organizationId,tenantId:state.tenantId,generationId:state.generationId,
   centralVersion:centralVersion.currentVersion,tenant:observed,desired:{version:VERSION,checksum:head.sqlChecksum,fingerprint:head.schemaFingerprint},authority,
   runtime:{memberAccess:state.memberAccess===true,snapshotVersion:state.snapshot.schema.currentVersion,stateDigest:hash(state)},
   limitations:['Preparation is a read-only observation, not a maintenance lock or a backup.','Recheck identities, versions, grants and active writers immediately before applying.','No apply command is exposed by this preparation tool.']};
  const output=path.join(cfg.folder,'opportunity-interest-activation-plan.json');cfg.saveState(report,output);
  console.log(JSON.stringify({status:report.status,from:observed.version,to:VERSION,memberships:authority.memberships.length,eligible:authority.memberships.filter(m=>m.eligible).length,
   changedMemberships:authority.memberships.filter(m=>m.addPermissions.length).length,addedPermissions:authority.memberships.reduce((n,m)=>n+m.addPermissions.length,0),centralVersion:report.centralVersion,plan:path.relative(cfg.root,output)}));
  return report;
 }finally{await Promise.all([central.end(),tenant.end()]);}
}
if(require.main===module)main().catch(error=>{console.error(/^[A-Z0-9_]{3,100}$/.test(error.message||'')?error.message:'INTEREST_PREPARATION_FAILED');process.exitCode=1;});
module.exports={args,baselineManifest,status,target,grantPlan,readonly,main};
