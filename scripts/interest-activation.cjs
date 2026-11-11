'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{createHash}=require('node:crypto');
const cfg=require('../backend/scripts/localPlatform/config');
const {grantPlan}=require('../backend/scripts/localPlatform/prepareOpportunityInterests');
const VERSION='033_organizational_opportunity_interests';
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const q=value=>'"'+value.replaceAll('"','""')+'"';
const MEMBER_SQL=`SELECT m.id membership_id,m.organization_id,m.base_role_code,m.membership_version,f.authorization_version,f.grants,f.policy_version,f.assurance_requirements,
 (m.status='ACTIVE' AND o.status='ACTIVE' AND u.status='ACTIVE' AND m.valid_from<=clock_timestamp() AND (m.valid_until IS NULL OR m.valid_until>clock_timestamp())) eligible
 FROM public.organization_membership m JOIN public.organization o ON o.id=m.organization_id JOIN public.global_user u ON u.id=m.global_user_id
 LEFT JOIN public.authority_f5_state f ON f.organization_id=m.organization_id AND f.membership_id=m.id WHERE m.organization_id=$1 ORDER BY m.id`;
function mergeGrants(row,expected,organizationId){
 assert(row.eligible);assert.equal(row.organization_id,organizationId);assert.equal(row.membership_id,expected.membershipId);
 assert.equal(row.base_role_code,expected.profile);assert.equal(Number(row.membership_version),expected.membershipVersion);
 const digest=grants=>hash({grants,policy:row.policy_version,assurance:row.assurance_requirements});
 if(Number(row.authorization_version)===expected.authorizationVersion){
  assert.equal(digest(row.grants),expected.authorityDigest,'AUTHORITY_CHANGED');
  assert.deepEqual(grantPlan(row,organizationId).addPermissions,expected.addPermissions);
  return [...structuredClone(row.grants),...expected.addPermissions.map(permission=>({permission,scope:{type:'ORGANIZATION',id:organizationId,organizationId}}))];
 }
 assert.equal(Number(row.authorization_version),expected.authorizationVersion+1,'AUTHORITY_VERSION_CHANGED');
 const prior=row.grants.slice(0,row.grants.length-expected.addPermissions.length);
 assert.equal(digest(prior),expected.authorityDigest,'AUTHORITY_CHANGED');
 assert.deepEqual(row.grants.slice(prior.length),expected.addPermissions.map(permission=>({permission,scope:{type:'ORGANIZATION',id:organizationId,organizationId}})));
 return structuredClone(row.grants);
}
async function grantAccess({authority,state,expected}){
 const {createAuthorityCoordinator}=require('../backend/src/security/authorityCoordinator');
 const coordinator=createAuthorityCoordinator({pool:authority,permitSecret:state.permitSecret});
 const catalogs=require('../backend/src/authorization/catalogs').createProductionCatalogs({catalogVersion:'f13'});
 return coordinator.write([`ORG:${state.organizationId}`,`MEMBER:${expected.membershipId}`],async client=>{
  const row=(await client.query('SELECT f.organization_id,f.membership_id,f.authorization_version,f.policy_version,f.grants,f.assurance_requirements, m.membership_version,m.base_role_code FROM public.authority_f5_state f JOIN public.organization_membership m ON m.id=f.membership_id AND m.organization_id=f.organization_id WHERE f.organization_id=$1 AND f.membership_id=$2',[state.organizationId,expected.membershipId])).rows[0];assert(row);
  const data=require('../backend/src/authorization/authorityDataRepository').createAuthorityDataRepository({coordinator,catalogs,policyVersion:row.policy_version,recentMfaRequirement:row.assurance_requirements});
  const member=await data.membershipPort.revalidate({organizationId:state.organizationId,membershipId:expected.membershipId});
  row.eligible=member?.status==='ACTIVE';
  const grants=mergeGrants(row,expected,state.organizationId);
  for(const permission of expected.addPermissions)assert(catalogs.permissionCatalog.resolve(permission));
  if(grants.length===row.grants.length)return {added:0,authorizationVersion:Number(row.authorization_version)};
  const event=require('../backend/src/audit/event').createAuditEvent({trustedContext:{organizationId:state.organizationId,tenantId:null,operationAuthority:'CENTRAL',operationCode:'ORGANIZATION_MEMBERSHIP_MANAGE',source:'LOCAL_INSTALLER',channel:'OPERATIONS',synchronous:true},input:{
   eventCode:'GRANT_CHANGED',actor:{type:'SERVICE',id:state.installationId,membershipId:null,serviceActorCode:'C4G_LOCAL_INSTALLER',supportGrantId:null},subject:null,resource:{type:'ORGANIZATION_MEMBERSHIP',id:expected.membershipId},decision:'ACCEPT',outcome:'SUCCESS',observedAt:new Date().toISOString(),correlationId:require('../backend/src/audit/uuidV7').createUuidV7(),causationId:null,
   idempotencyKey:`INTEREST_ACCESS:${expected.membershipId}:${expected.authorizationVersion}`,streamType:'SECURITY',payload:{detailCode:'INTEREST_ACCESS_GRANTED',previousVersion:String(expected.authorizationVersion),newVersion:String(expected.authorizationVersion+1)}}});
  await require('../backend/src/audit/appendService').createAppendService({appendPort:new (require('../backend/src/audit/postgresAppendRepository').PostgresAppendRepository)()}).append(event,client);
  const result=await client.query(`UPDATE public.authority_f5_state SET authorization_version=authorization_version+1,
   policy_version=$4,grants=$5,assurance_requirements=$6,updated_at=clock_timestamp()
   WHERE organization_id=$1 AND membership_id=$2 AND authorization_version=$3 RETURNING authorization_version`,
   [state.organizationId,expected.membershipId,expected.authorizationVersion,row.policy_version,JSON.stringify(grants),JSON.stringify(row.assurance_requirements)]);
  assert.equal(result.rowCount,1,'AUTHORITY_VERSION_CHANGED');
  return {added:expected.addPermissions.length,authorizationVersion:Number(result.rows[0].authorization_version)};
 });
}
async function baseline(pool,schemas){
 const rows=(await pool.query(`SELECT n.nspname,c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE c.relkind IN ('r','p')
  AND n.nspname=ANY($1::text[]) ORDER BY 1,2`,[schemas])).rows;
 const result={};
 for(const row of rows){const name=q(row.nspname)+'.'+q(row.relname);
  const columns=(await pool.query('SELECT column_name FROM information_schema.columns WHERE table_schema=$1 AND table_name=$2 ORDER BY ordinal_position',[row.nspname,row.relname])).rows.map(r=>r.column_name);
  const where=row.nspname==='c4g_system'&&row.relname==='schema_migration'?' WHERE ordinal<=30':'';
  const sql=`SELECT row_to_json(t)::text AS value FROM (SELECT ${columns.map(q).join(',')} FROM ${name}${where}) t`;
  const data=(await pool.query(sql)).rows.map(r=>r.value).sort();result[name]={sql,count:data.length,digest:hash(data)};
 }
 return result;
}
async function preserved(pool,expected){for(const item of Object.values(expected)){const rows=(await pool.query(item.sql)).rows.map(r=>r.value).sort();assert.equal(rows.length,item.count,'PRESERVATION_COUNT');assert.equal(hash(rows),item.digest,'PRESERVATION_DIGEST');}}
function updateSnapshot(value,schema){const copy=structuredClone(value);copy.schema=structuredClone(schema);return copy;}
async function activate({tenant,central,authority,state,stateFiles,plan,checkpoint=()=>{}}){
 assert.equal(plan.desired.version,VERSION);assert.equal(plan.tenant.preflight.passed,true);
 const expected={tenantId:state.tenantId,databaseGenerationId:state.generationId};
 const tenantBefore=await baseline(tenant,['c4g_system','opportunity_catalog','organizational_scope','organization_profile','document_storage','async_exec','audit']);
 const centralBefore=await baseline(central,['opportunity_catalog']);
 const identities=(await central.query('SELECT to_jsonb(t)::text value FROM public.organization_membership t ORDER BY id')).rows;
 const allAuthority=(await central.query('SELECT to_jsonb(t) value FROM public.authority_f5_state t ORDER BY organization_id,membership_id')).rows.map(r=>r.value);
 const bindings=(await central.query('SELECT to_jsonb(t)::text value FROM public.tenant_workload_binding t ORDER BY tenant_id,workload')).rows;
 const members=(await central.query(MEMBER_SQL,[state.organizationId])).rows;
 for(const member of plan.authority.memberships.filter(m=>m.eligible))mergeGrants(members.find(m=>m.membership_id===member.membershipId),member,state.organizationId);
 const {createTenantSchemaRepository}=require('../backend/src/security/tenantSchemaRepository');
 const publisher=require('../backend/src/security/tenantSchemaObservationPublisher').createTenantSchemaObservationPublisher(createTenantSchemaRepository(central));
 const runner=require('../backend/src/security/tenantMigrationRunner').createTenantMigrationRunner({pool:tenant,observationPublisher:publisher,timeoutMs:30000,scheduler:{setTimeout,clearTimeout}});
 const input={...expected,expectedRevision:Number(plan.authority.schema[0].revision),correlationId:state.installationId,idempotencyKey:`interest-033-${state.tenantId}-${plan.authority.schema[0].revision}`};
 checkpoint('MIGRATING');
 const result=await runner.migrate(input);assert.equal(result.evidence.currentVersion,VERSION);
 assert(result.appliedVersions.length===0||JSON.stringify(result.appliedVersions)===JSON.stringify(['031_application_document_transport','032_document_worker_runtime',VERSION]));
 checkpoint('SCHEMA_PUBLISHED');
 await preserved(tenant,tenantBefore);await preserved(central,centralBefore);
 let added=0;for(const member of plan.authority.memberships.filter(m=>m.eligible&&m.addPermissions.length))added+=(await grantAccess({authority,state,expected:member})).added;
 checkpoint('GRANTS_APPLIED');
 // Exercise replay through the original runner and audit-coordinated grant path.
 const replay=await runner.migrate(input);assert.deepEqual(replay.appliedVersions,[]);
 for(const member of plan.authority.memberships.filter(m=>m.eligible&&m.addPermissions.length))assert.equal((await grantAccess({authority,state,expected:member})).added,0);
 const directory=require('../backend/src/security/tenantDirectoryRepository').createTenantDirectoryRepository(central);
 const resolved=await directory.resolveSnapshotByOrganization(state.organizationId,'API');
 assert.equal(resolved.tenantId,state.tenantId);assert.equal(resolved.databaseGenerationId,state.generationId);
 assert.equal(resolved.schema.currentVersion,VERSION);assert.equal(resolved.schema.schemaFingerprint,result.evidence.schemaFingerprint);
 for(const file of stateFiles){
  const value=JSON.parse(fs.readFileSync(file));let next=structuredClone(value);
  if(file.endsWith('runtime.json')){assert.equal(value.tenantId,state.tenantId);next.snapshot=updateSnapshot(value.snapshot,resolved.schema);}
  else{assert(Array.isArray(value.bindings));let count=0;next.bindings=next.bindings.map(binding=>{if(binding.organizationId!==state.organizationId||binding.snapshot?.tenantId!==state.tenantId)return binding;count++;return {...binding,snapshot:updateSnapshot(binding.snapshot,resolved.schema)};});assert.equal(count,1);}
  cfg.saveState(next,file);
 }
 checkpoint('SNAPSHOTS_UPDATED');
 const after=(await central.query('SELECT to_jsonb(t) value FROM public.authority_f5_state t ORDER BY organization_id,membership_id')).rows.map(r=>r.value);
 assert.equal(after.length,allAuthority.length);
 for(let i=0;i<allAuthority.length;i++){
  const old=allAuthority[i],current=after[i],member=plan.authority.memberships.find(m=>m.membershipId===old.membership_id&&old.organization_id===state.organizationId&&m.addPermissions.length);
  if(!member){assert.deepEqual(current,old);continue;}
  assert.equal(current.authorization_version,member.authorizationVersion+1);assert.deepEqual(current.grants.slice(0,old.grants.length),old.grants);
  const strip=row=>{const copy={...row};for(const key of ['grants','authorization_version','updated_at'])delete copy[key];return copy;};assert.deepEqual(strip(current),strip(old));
 }
 assert.deepEqual((await central.query('SELECT to_jsonb(t)::text value FROM public.organization_membership t ORDER BY id')).rows,identities);
 assert.deepEqual((await central.query('SELECT to_jsonb(t)::text value FROM public.tenant_workload_binding t ORDER BY tenant_id,workload')).rows,bindings);
 await preserved(tenant,tenantBefore);await preserved(central,centralBefore);
 await require('../backend/src/security/centralMigrationPreflight').preflightCentral(central);
 await require('../backend/src/security/tenantMigrationPreflight').preflightTenant(tenant,expected,undefined,{timeoutMs:30000});
 return {version:VERSION,appliedVersions:result.appliedVersions,permissionsAdded:added,replayNoChanges:true,tenantDataPreserved:true,centralCatalogPreserved:true,membershipsPreserved:true,bindingsPreserved:true,snapshotFiles:stateFiles.length,fingerprint:result.evidence.schemaFingerprint};
}
module.exports={activate,mergeGrants,updateSnapshot,MEMBER_SQL};
