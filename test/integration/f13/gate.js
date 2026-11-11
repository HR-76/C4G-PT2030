'use strict';
const assert=require('node:assert/strict');
const {Pool}=require('../../../backend/node_modules/pg');
const {createTenantMigrationRunner}=require('../../../backend/src/security/tenantMigrationRunner');
const {manifest:fullManifest}=require('../../../backend/src/security/tenantMigrationManifest');
// Keep the closed slice-3 regression gate pinned to its canonical 007 boundary.
const manifest=Object.freeze(fullManifest.slice(0,8));
const {preflightTenant}=require('../../../backend/src/security/tenantMigrationPreflight');
const {tenantSchemaFingerprint,tenantSchemaSnapshot}=require('../../../backend/src/security/tenantSchemaFingerprint');
const {verifyTaxonomyProduction}=require('./taxonomy-production');
const DB='c4g_f13_s2_synthetic_gate';
const TENANT='71300000-0000-4000-8000-000000000001';
const OTHER_TENANT='71300000-0000-4000-8000-000000000003';
const GENERATION='71300000-0000-4000-8000-000000000002';
function target(){if(process.env.F13_S2_DISPOSABLE_PROOF!=='C4G_F13_S2_DISPOSABLE_V1')throw new Error('Disposable proof absent.');const u=new URL(process.env.F13_S2_GATE_URL);if(!['127.0.0.1','localhost'].includes(u.hostname)||u.pathname!==`/${DB}`||['5432','5433'].includes(u.port))throw new Error('Unsafe target.');}
async function run(){target();const admin=new Pool({connectionString:process.env.F13_S2_ADMIN_URL,max:2});let tenant,otherTenant;const otherDb='c4g_f13_s3_physical_b';try{
 for(const role of ['c4g_tenant_owner','c4g_tenant_migrator','c4g_tenant_runtime'])await admin.query(`CREATE ROLE ${role} NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`);
 await admin.query('GRANT c4g_tenant_owner TO c4g_tenant_migrator');await admin.query('GRANT c4g_tenant_migrator TO c4g_f12_admin');
 await admin.query(`CREATE DATABASE ${DB} ENCODING 'UTF8' LOCALE_PROVIDER icu ICU_LOCALE 'und' TEMPLATE template0`);await admin.query(`ALTER DATABASE ${DB} SET timezone TO 'UTC'`);
 await admin.query(`GRANT CONNECT,CREATE ON DATABASE ${DB} TO c4g_tenant_owner`);await admin.query(`GRANT CONNECT ON DATABASE ${DB} TO c4g_tenant_migrator,c4g_tenant_runtime`);
 tenant=new Pool({connectionString:process.env.F13_S2_GATE_URL,max:6});await tenant.query('REVOKE ALL ON SCHEMA public FROM PUBLIC');await tenant.query(`REVOKE CONNECT,TEMP ON DATABASE ${DB} FROM PUBLIC`);await tenant.query(`ALTER ROLE c4g_tenant_runtime IN DATABASE ${DB} SET search_path TO pg_catalog,c4g_app`);
 const observations=[];
 const makeRunner=entries=>createTenantMigrationRunner({pool:Object.freeze({connect:()=>tenant.connect()}),entries,observationPublisher:{async publish(value){observations.push(value);}},timeoutMs:15000,scheduler:{setTimeout,clearTimeout},fingerprintSchema:async client=>{const value=tenantSchemaFingerprint(await tenantSchemaSnapshot(client));if(!manifest.some(entry=>entry.schemaFingerprint===value))process.stderr.write(`F13 unexpected fingerprint: ${value}\n`);return value;}});
 const foundationRunner=makeRunner(Object.freeze(manifest.slice(0,7)));const foundation=await foundationRunner.migrate({tenantId:TENANT,databaseGenerationId:GENERATION,expectedRevision:1,correlationId:'f13-s2-foundation',idempotencyKey:'f13-s2-foundation'});assert.equal(foundation.evidence.currentVersion,'006_f13_p1_organizational_scope');
 const roundtripRunner=makeRunner(manifest,7);
 const roundtripInput={tenantId:TENANT,databaseGenerationId:GENERATION,expectedRevision:2,correlationId:'f13-s3-roundtrip-up',idempotencyKey:'f13-s3-roundtrip-up'};
 await roundtripRunner.migrate(roundtripInput);
 // R4-002: an independent root, with no release/F7 data, must prevent a down.
 const orphanKey='71300000-0000-4000-8000-000000000099';
 const orphanClient=await tenant.connect();
 try {
  await orphanClient.query('BEGIN');
  await orphanClient.query('SET LOCAL ROLE c4g_organization_profile_runtime');
  await orphanClient.query("SELECT set_config('app.organization_id',$1,true)",[TENANT]);
  await orphanClient.query("INSERT INTO organization_profile.taxonomy_idempotency_record(organization_id,operation,idempotency_key,intention_digest,result_projection) VALUES($1,'RELEASE_CREATE',$2,$3,'{}')",[TENANT,orphanKey,'d'.repeat(64)]);
  await orphanClient.query('COMMIT');
 } finally { await orphanClient.query('ROLLBACK').catch(()=>{});orphanClient.release(); }
 const orphanSnapshot=await tenantSchemaSnapshot(tenant);
 await assert.rejects(()=>roundtripRunner.downgrade({...roundtripInput,targetVersion:manifest[6].version,expectedRevision:3}));
 assert.deepEqual(await tenantSchemaSnapshot(tenant),orphanSnapshot);
 assert.equal((await tenant.query('SELECT count(*)::int count FROM organization_profile.taxonomy_idempotency_record WHERE idempotency_key=$1',[orphanKey])).rows[0].count,1);
 assert.equal((await tenant.query('SELECT count(*)::int count FROM c4g_system.schema_migration')).rows[0].count,8);
 assert.equal((await preflightTenant(tenant,{tenantId:TENANT,databaseGenerationId:GENERATION},manifest,{timeoutMs:10000})).schemaFingerprint,manifest[7].schemaFingerprint);
 assert.equal(observations.length,2,'refused downgrade must not publish');
 // Only the fixture created above, in this disposable gate database, is removed.
 await tenant.query('DELETE FROM organization_profile.taxonomy_idempotency_record WHERE organization_id=$1 AND operation=$2 AND idempotency_key=$3',[TENANT,'RELEASE_CREATE',orphanKey]);
 const failingDowngrade=createTenantMigrationRunner({entries:manifest,pool:{async connect(){const client=await tenant.connect();return{async query(sql,values){if(sql.startsWith('DELETE FROM c4g_system.schema_migration'))throw new Error('SYNTHETIC_LEDGER_FAILURE');return client.query(sql,values);},release:error=>client.release(error)};}},observationPublisher:{async publish(){throw new Error('FAILED_DOWNGRADE_MUST_NOT_PUBLISH');}},timeoutMs:15000,scheduler:{setTimeout,clearTimeout}});
 await assert.rejects(()=>failingDowngrade.downgrade({...roundtripInput,targetVersion:manifest[6].version,expectedRevision:3}));
 assert.equal((await preflightTenant(tenant,{tenantId:TENANT,databaseGenerationId:GENERATION},manifest,{timeoutMs:10000})).currentVersion,manifest[7].version);
 assert.equal((await tenant.query("SELECT count(*)::int count FROM pg_roles WHERE rolname LIKE 'c4g_organization_profile_%'")).rows[0].count,3);
 const auditConstraints=async()=> (await tenant.query("SELECT conname,pg_get_constraintdef(c.oid) definition FROM pg_constraint c JOIN pg_namespace n ON n.oid=c.connamespace WHERE n.nspname='audit' AND conname IN('event_identity_event_code_check','event_event_code_check','event_catalog_version_check') ORDER BY conname")).rows;
 const profileRoleOids=(await tenant.query("SELECT oid FROM pg_roles WHERE rolname LIKE 'c4g_organization_profile_%'")).rows.map(row=>row.oid);
 assert.equal((await tenant.query('SELECT count(*)::int count FROM c4g_system.schema_migration')).rows[0].count,8);
 const down=await roundtripRunner.downgrade({...roundtripInput,targetVersion:manifest[6].version,expectedRevision:3,correlationId:'f13-s3-roundtrip-down',idempotencyKey:'f13-s3-roundtrip-down'});
 assert.deepEqual(down.revertedVersions,[manifest[7].version]);assert.equal(down.evidence.currentVersion,manifest[6].version);
 for(const row of await auditConstraints())assert.doesNotMatch(row.definition,/TAXONOMY_|f13-taxonomy-events-v1/);
 assert.equal((await tenant.query('SELECT count(*)::int count FROM c4g_system.schema_migration')).rows[0].count,7);
 assert.equal((await tenant.query("SELECT tgenabled FROM pg_trigger WHERE tgname='schema_migration_append_only'")).rows[0].tgenabled,'O');
 const aclResidue=await tenant.query("SELECT count(*)::int count FROM (SELECT a.grantee FROM pg_namespace n CROSS JOIN LATERAL aclexplode(n.nspacl) a WHERE n.nspname='audit' UNION ALL SELECT a.grantee FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace CROSS JOIN LATERAL aclexplode(p.proacl) a WHERE n.nspname='audit') acl WHERE grantee=ANY($1::oid[])",[profileRoleOids]);
 assert.equal(aclResidue.rows[0].count,0);
 assert.equal((await tenant.query("SELECT count(*)::int count FROM pg_roles WHERE rolname LIKE 'c4g_organization_profile_%'")).rows[0].count,0);
 const runner=makeRunner(manifest,7);const first=await runner.migrate({tenantId:TENANT,databaseGenerationId:GENERATION,expectedRevision:4,correlationId:'f13-s2-first',idempotencyKey:'f13-s2-first'});
 assert.deepEqual(first.appliedVersions,['007_f13_profile_catalogs_and_policies']);assert.equal(first.evidence.currentVersion,'007_f13_profile_catalogs_and_policies');assert.ok(first.evidence.capabilities.includes('F13_PROFILE_CATALOG_FOUNDATION'));assert.equal(first.evidence.capabilities.includes('F13_ORGANIZATIONAL_PROFILE'),false);
 for(const row of await auditConstraints())assert.match(row.definition,row.conname==='event_catalog_version_check'?/f13-taxonomy-events-v1/:/TAXONOMY_/);
 assert.deepEqual(observations.map(value=>[value.expectedRevision,value.evidence.currentVersion]),[[1,manifest[6].version],[2,manifest[7].version],[3,manifest[6].version],[4,manifest[7].version]]);
 const second=await runner.migrate({tenantId:TENANT,databaseGenerationId:GENERATION,expectedRevision:5,correlationId:'f13-s2-second',idempotencyKey:'f13-s2-second'});assert.deepEqual(second.appliedVersions,[]);
 const tables=await tenant.query("SELECT tablename FROM pg_catalog.pg_tables WHERE schemaname='organization_profile' ORDER BY tablename");assert.equal(tables.rows.length,22);
 const security=await tenant.query(`SELECT count(*)::int count,bool_and(c.relrowsecurity AND c.relforcerowsecurity) AS protected FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='organization_profile' AND c.relkind IN ('r','p')`);assert.deepEqual(security.rows[0],{count:22,protected:true});
 const grants=await tenant.query("SELECT count(*)::int count FROM information_schema.table_privileges WHERE table_schema='organization_profile' AND grantee='c4g_organization_profile_runtime' AND ((table_name IN ('catalog_release','scheme','concept','concept_label','concept_relation','external_mapping') AND privilege_type IN ('SELECT','INSERT','UPDATE')) OR (table_name='taxonomy_idempotency_record' AND privilege_type IN ('SELECT','INSERT')))");assert.equal(grants.rows[0].count,20);
 // The canonical runner installs the guard; probes invoke it without executing a down migration or modifying the ledger.
 await tenant.query('SELECT organization_profile.assert_007_down_safe()');
 for(const [kind,withEntry] of [['purpose',false],['reason',false],['purpose',true],['reason',true]]){
  const client=await tenant.connect();
  try{
   await client.query('BEGIN');
   await client.query(`INSERT INTO organization_profile.${kind}_catalog_release(catalog_version,lifecycle,catalog_digest) VALUES('down-safety-v1','DRAFT',$1)`,['d'.repeat(64)]);
   if(withEntry){
    await client.query(`INSERT INTO organization_profile.${kind}_catalog_entry(catalog_version,${kind}_code,operation_code,lifecycle) VALUES('down-safety-v1','SYNTHETIC_CODE','F13_PROFILE_READ','PUBLISHED')`);
    await client.query(`UPDATE organization_profile.${kind}_catalog_release SET lifecycle='PUBLISHED',published_at=transaction_timestamp() WHERE catalog_version='down-safety-v1'`);
   }
   await client.query('SAVEPOINT down_guard_probe');
   await assert.rejects(()=>client.query('SELECT organization_profile.assert_007_down_safe()'),/F13_PROFILE_007_DOWN_REFUSES_DATA_LOSS/);
   await client.query('ROLLBACK TO SAVEPOINT down_guard_probe');
   assert.equal((await client.query(`SELECT count(*)::int AS count FROM organization_profile.${kind}_catalog_release`)).rows[0].count,1);
   assert.equal((await client.query(`SELECT count(*)::int AS count FROM organization_profile.${kind}_catalog_entry`)).rows[0].count,withEntry?1:0);
  }finally{await client.query('ROLLBACK');client.release();}
 }
 const owner=await tenant.connect();try{
  const unit='71300000-0000-4000-8000-000000000020',team='71300000-0000-4000-8000-000000000021',archived='71300000-0000-4000-8000-000000000022',otherUnit='71300000-0000-4000-8000-000000000023';
  await owner.query('BEGIN');await owner.query('SET LOCAL ROLE c4g_organizational_scope_owner');await owner.query("SELECT set_config('app.organization_id',$1,true)",[TENANT]);
  for(const [scopeId,type,label] of [[unit,'UNIT','Synthetic Unit'],[team,'TEAM','Synthetic Team'],[archived,'UNIT','Archived Unit']])await owner.query(`INSERT INTO organizational_scope.scope(scope_id,organization_id,scope_type,label,provenance,created_by_actor_type,created_by_actor_id,updated_by_actor_type,updated_by_actor_id) VALUES($1,$2,$3,$4,'{}','HUMAN',$5,'HUMAN',$5)`,[scopeId,TENANT,type,label,TENANT]);
  await owner.query("UPDATE organizational_scope.scope SET lifecycle='ARCHIVED',revision=2,updated_at=transaction_timestamp(),updated_by_actor_id=$2,archived_at=transaction_timestamp(),archived_by_actor_id=$2,archive_reason_code='TEST_ARCHIVE' WHERE organization_id=$1 AND scope_id=$3",[TENANT,TENANT,archived]);await owner.query('COMMIT');
  await owner.query('BEGIN');await owner.query('SET LOCAL ROLE c4g_organizational_scope_owner');await owner.query("SELECT set_config('app.organization_id',$1,true)",[OTHER_TENANT]);await owner.query("INSERT INTO organizational_scope.scope(scope_id,organization_id,scope_type,label,provenance,created_by_actor_type,created_by_actor_id,updated_by_actor_type,updated_by_actor_id) VALUES($1,$2,'UNIT','Other Tenant Unit','{}','HUMAN',$2,'HUMAN',$2)",[otherUnit,OTHER_TENANT]);await owner.query('COMMIT');
  await owner.query('BEGIN');await owner.query('SET LOCAL ROLE c4g_organization_profile_owner');await owner.query("SELECT set_config('app.organization_id',$1,true)",[TENANT]);
  await owner.query("INSERT INTO organization_profile.profile_scope(profile_scope_id,organization_id,scope_type,scope_id) VALUES('71300000-0000-4000-8000-000000000010',$1,'ORGANIZATION',NULL)",[TENANT]);
  await assert.rejects(()=>owner.query("INSERT INTO organization_profile.profile_scope(profile_scope_id,organization_id,scope_type,scope_id) VALUES('71300000-0000-4000-8000-000000000011',$1,'ORGANIZATION',NULL)",[TENANT]),/duplicate key/);await owner.query('ROLLBACK');
  for(const [profileId,type,scopeId,accepted] of [
   ['71300000-0000-4000-8000-000000000030','UNIT',unit,true],['71300000-0000-4000-8000-000000000031','TEAM',team,true],
   ['71300000-0000-4000-8000-000000000032','UNIT',team,false],['71300000-0000-4000-8000-000000000033','TEAM',unit,false],
   ['71300000-0000-4000-8000-000000000034','UNIT',archived,false]]){
    await owner.query('BEGIN');await owner.query('SET LOCAL ROLE c4g_organization_profile_owner');await owner.query("SELECT set_config('app.organization_id',$1,true)",[TENANT]);
    const insert=()=>owner.query('INSERT INTO organization_profile.profile_scope(profile_scope_id,organization_id,scope_type,scope_id) VALUES($1,$2,$3,$4)',[profileId,TENANT,type,scopeId]);
    if(accepted)await insert();else await assert.rejects(insert,/F13_PROFILE_SCOPE_REFERENCE_INVALID/);await owner.query('ROLLBACK');
  }
  await owner.query('BEGIN');await owner.query('SET LOCAL ROLE c4g_organization_profile_owner');await owner.query("SELECT set_config('app.organization_id',$1,true)",[TENANT]);await assert.rejects(()=>owner.query("INSERT INTO organization_profile.profile_scope(profile_scope_id,organization_id,scope_type,scope_id) VALUES('71300000-0000-4000-8000-000000000035',$1,'UNIT','71300000-0000-4000-8000-000000000099')",[TENANT]),/F13_PROFILE_SCOPE_REFERENCE_INVALID/);await owner.query('ROLLBACK');
  await owner.query('BEGIN');await owner.query('SET LOCAL ROLE c4g_organization_profile_owner');await owner.query("SELECT set_config('app.organization_id',$1,true)",[TENANT]);await assert.rejects(()=>owner.query("INSERT INTO organization_profile.profile_scope(profile_scope_id,organization_id,scope_type,scope_id) VALUES('71300000-0000-4000-8000-000000000036',$1,'UNIT',$2)",[TENANT,otherUnit]),/F13_PROFILE_SCOPE_REFERENCE_INVALID/);await owner.query('ROLLBACK');
 }finally{owner.release();}
 const immutable=async(sql,params=[],code=/F13_PROFILE_(?:RELEASE|POLICY|MANIFEST|CATALOG_ENTRY)_.*IMMUTABLE/)=>{await tenant.query('BEGIN');try{await assert.rejects(()=>tenant.query(sql,params),code);}finally{await tenant.query('ROLLBACK');}};
 const release='71300000-0000-4000-8000-000000000040',scheme='71300000-0000-4000-8000-000000000041',concept='71300000-0000-4000-8000-000000000042';
 const metricRelease='71300000-0000-4000-8000-000000000050',metric='71300000-0000-4000-8000-000000000051';
 const completion='71300000-0000-4000-8000-000000000060',manifestId='71300000-0000-4000-8000-000000000070';
 await tenant.query('BEGIN');
 await tenant.query("INSERT INTO organization_profile.catalog_release(release_id,organization_id,namespace,release_version,lifecycle,semantic_digest,provenance) VALUES($1,$2,'TENANT','immutability-v1','DRAFT',$3,'{}')",[release,TENANT,'a'.repeat(64)]);
 await tenant.query("INSERT INTO organization_profile.scheme(scheme_id,release_id,organization_id,scheme_code,relation_domain) VALUES($1,$2,$3,'THEMATIC_AREA','THEMATIC')",[scheme,release,TENANT]);
 await tenant.query("INSERT INTO organization_profile.concept(concept_id,release_id,scheme_id,organization_id,stable_code,provenance) VALUES($1,$2,$3,$4,'IMMUTABLE','{}')",[concept,release,scheme,TENANT]);
 await tenant.query("INSERT INTO organization_profile.concept_label(concept_id,locale,label_kind,label) VALUES($1,'pt-PT','PREFERRED','Immutable')",[concept]);
 await tenant.query("UPDATE organization_profile.catalog_release SET lifecycle='PUBLISHED',published_at=transaction_timestamp() WHERE release_id=$1",[release]);
 await tenant.query("INSERT INTO organization_profile.metric_catalog_release(metric_release_id,organization_id,release_version,lifecycle,semantic_digest,provenance) VALUES($1,$2,'metrics-v1','DRAFT',$3,'{}')",[metricRelease,TENANT,'b'.repeat(64)]);
 await tenant.query("INSERT INTO organization_profile.metric_definition(metric_id,metric_release_id,metric_code,value_kind,unit_code) VALUES($1,$2,'STAFF_COUNT','COUNT','PEOPLE')",[metric,metricRelease]);
 await tenant.query("UPDATE organization_profile.metric_catalog_release SET lifecycle='PUBLISHED' WHERE metric_release_id=$1",[metricRelease]);
 await tenant.query("INSERT INTO organization_profile.completion_policy(completion_policy_id,policy_version,profile_schema_version,scope_type,domain_code,lifecycle,policy_digest) VALUES($1,'completion-v1','profile-v1','ORGANIZATION','FOUNDATION','DRAFT',$2)",[completion,'c'.repeat(64)]);
 await tenant.query("INSERT INTO organization_profile.completion_slot(completion_policy_id,slot_code,allowed_knowledge_states,verification_requirement) VALUES($1,'IDENTITY',ARRAY['KNOWN'],'VERIFIED')",[completion]);
 await tenant.query("UPDATE organization_profile.completion_policy SET lifecycle='PUBLISHED' WHERE completion_policy_id=$1",[completion]);
 await tenant.query("INSERT INTO organization_profile.compatibility_manifest(manifest_id,manifest_version,manifest_digest,lifecycle) VALUES($1,'manifest-v1',$2,'DRAFT')",[manifestId,'d'.repeat(64)]);
 await tenant.query("INSERT INTO organization_profile.release_bundle(bundle_id,manifest_id,bundle_version,profile_schema_version,snapshot_schema_version,tuple_definition,bundle_digest) VALUES('71300000-0000-4000-8000-000000000071',$1,'bundle-v1','profile-v1','snapshot-v1','{}',$2)",[manifestId,'e'.repeat(64)]);
 await tenant.query("UPDATE organization_profile.compatibility_manifest SET lifecycle='PUBLISHED',published_at=transaction_timestamp() WHERE manifest_id=$1",[manifestId]);
  await tenant.query("INSERT INTO organization_profile.purpose_catalog_release(catalog_version,lifecycle,catalog_digest) VALUES('purpose-v1','DRAFT',$1)",['7'.repeat(64)]);
  await tenant.query("INSERT INTO organization_profile.reason_catalog_release(catalog_version,lifecycle,catalog_digest) VALUES('reason-v1','DRAFT',$1)",['8'.repeat(64)]);
  await tenant.query("INSERT INTO organization_profile.purpose_catalog_entry(catalog_version,purpose_code,operation_code,lifecycle) VALUES('purpose-v1','PROFILE_MAINTENANCE','F13_PROFILE_READ','PUBLISHED')");
  await tenant.query("INSERT INTO organization_profile.reason_catalog_entry(catalog_version,reason_code,operation_code,lifecycle) VALUES('reason-v1','AUTHORIZED_REVIEW','F13_PROFILE_READ','PUBLISHED')");
  await tenant.query("UPDATE organization_profile.purpose_catalog_release SET lifecycle='PUBLISHED',published_at=transaction_timestamp() WHERE catalog_version='purpose-v1'");
  await tenant.query("UPDATE organization_profile.reason_catalog_release SET lifecycle='PUBLISHED',published_at=transaction_timestamp() WHERE catalog_version='reason-v1'");
 await tenant.query('COMMIT');
 await immutable("UPDATE organization_profile.concept SET stable_code='CHANGED' WHERE concept_id=$1",[concept]);
 await immutable('DELETE FROM organization_profile.concept_label WHERE concept_id=$1',[concept]);
 await immutable("INSERT INTO organization_profile.scheme(scheme_id,release_id,organization_id,scheme_code,relation_domain) VALUES('71300000-0000-4000-8000-000000000043',$1,$2,'STRATEGIC_PRIORITY','THEMATIC')",[release,TENANT]);
 await immutable("UPDATE organization_profile.metric_definition SET unit_code='PERSONS' WHERE metric_id=$1",[metric]);
 await immutable("INSERT INTO organization_profile.band_policy(band_policy_id,metric_release_id,policy_version,definition,policy_digest) VALUES('71300000-0000-4000-8000-000000000052',$1,'band-v1','{}',$2)",[metricRelease,'f'.repeat(64)]);
 await immutable("UPDATE organization_profile.completion_slot SET verification_requirement='UNVERIFIED_ALLOWED' WHERE completion_policy_id=$1",[completion]);
 await immutable("INSERT INTO organization_profile.completion_rule(completion_policy_id,rule_code,rule_kind,operands) VALUES($1,'LATE_RULE','REQUIRE_SLOT','{}')",[completion]);
 await immutable("UPDATE organization_profile.release_bundle SET snapshot_schema_version='snapshot-v2' WHERE manifest_id=$1",[manifestId]);
 await immutable("UPDATE organization_profile.purpose_catalog_entry SET lifecycle='DEPRECATED' WHERE catalog_version='purpose-v1'");
 await immutable("DELETE FROM organization_profile.reason_catalog_entry WHERE catalog_version='reason-v1'");
  await immutable("INSERT INTO organization_profile.purpose_catalog_entry(catalog_version,purpose_code,operation_code,lifecycle) VALUES('purpose-v1','LATE_PURPOSE','F13_PROFILE_READ','PUBLISHED')");
  await immutable("INSERT INTO organization_profile.reason_catalog_entry(catalog_version,reason_code,operation_code,lifecycle) VALUES('reason-v1','LATE_REASON','F13_PROFILE_READ','PUBLISHED')");
 await immutable('TRUNCATE organization_profile.purpose_catalog_entry',[],/F13_PROFILE_TRUNCATE_FORBIDDEN/);
  const waitUntilBlocked=async backendPid=>{for(let attempt=0;attempt<100;attempt++){const result=await tenant.query('SELECT cardinality(pg_blocking_pids($1))::int AS blockers',[backendPid]);if(result.rows[0].blockers>0)return;await new Promise(resolve=>setTimeout(resolve,10));}throw new Error('F13_CONCURRENCY_PROBE_DID_NOT_BLOCK');};
  const publicationWins=async({publishSql,publishParams,memberSql,memberParams,error})=>{const publisher=await tenant.connect(),member=await tenant.connect();try{await publisher.query('BEGIN');await member.query('BEGIN');const memberPid=(await member.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;await publisher.query(publishSql,publishParams);const outcome=member.query(memberSql,memberParams).then(()=>({accepted:true}),failure=>({accepted:false,failure}));await waitUntilBlocked(memberPid);await publisher.query('COMMIT');const result=await outcome;assert.equal(result.accepted,false);assert.match(result.failure.message,error);await member.query('ROLLBACK');}finally{publisher.release();member.release();}};
  const concurrentCatalogRelease='71300000-0000-4000-8000-000000000080',concurrentScheme='71300000-0000-4000-8000-000000000081';
  const concurrentMetricRelease='71300000-0000-4000-8000-000000000090';
  const concurrentCompletion='71300000-0000-4000-8000-0000000000a0',concurrentManifest='71300000-0000-4000-8000-0000000000b0';
  await tenant.query("INSERT INTO organization_profile.catalog_release(release_id,organization_id,namespace,release_version,lifecycle,semantic_digest,provenance) VALUES($1,$2,'TENANT','concurrent-taxonomy-v1','DRAFT',$3,'{}')",[concurrentCatalogRelease,TENANT,'1'.repeat(64)]);
  await tenant.query("INSERT INTO organization_profile.scheme(scheme_id,release_id,organization_id,scheme_code,relation_domain) VALUES($1,$2,$3,'THEMATIC_AREA','THEMATIC')",[concurrentScheme,concurrentCatalogRelease,TENANT]);
  await tenant.query("INSERT INTO organization_profile.metric_catalog_release(metric_release_id,organization_id,release_version,lifecycle,semantic_digest,provenance) VALUES($1,$2,'concurrent-metric-v1','DRAFT',$3,'{}')",[concurrentMetricRelease,TENANT,'2'.repeat(64)]);
  await tenant.query("INSERT INTO organization_profile.completion_policy(completion_policy_id,policy_version,profile_schema_version,scope_type,domain_code,lifecycle,policy_digest) VALUES($1,'concurrent-completion-v1','profile-v1','ORGANIZATION','FOUNDATION','DRAFT',$2)",[concurrentCompletion,'3'.repeat(64)]);
  await tenant.query("INSERT INTO organization_profile.compatibility_manifest(manifest_id,manifest_version,manifest_digest,lifecycle) VALUES($1,'concurrent-manifest-v1',$2,'DRAFT')",[concurrentManifest,'4'.repeat(64)]);
  await publicationWins({publishSql:"UPDATE organization_profile.catalog_release SET lifecycle='PUBLISHED',published_at=transaction_timestamp() WHERE release_id=$1",publishParams:[concurrentCatalogRelease],memberSql:"INSERT INTO organization_profile.concept(concept_id,release_id,scheme_id,organization_id,stable_code,provenance) VALUES('71300000-0000-4000-8000-000000000082',$1,$2,$3,'LATE_CONCEPT','{}')",memberParams:[concurrentCatalogRelease,concurrentScheme,TENANT],error:/F13_PROFILE_RELEASE_MEMBER_IMMUTABLE/});
  await publicationWins({publishSql:"UPDATE organization_profile.metric_catalog_release SET lifecycle='PUBLISHED' WHERE metric_release_id=$1",publishParams:[concurrentMetricRelease],memberSql:"INSERT INTO organization_profile.metric_definition(metric_id,metric_release_id,metric_code,value_kind,unit_code) VALUES('71300000-0000-4000-8000-000000000091',$1,'LATE_METRIC','COUNT','PEOPLE')",memberParams:[concurrentMetricRelease],error:/F13_PROFILE_RELEASE_MEMBER_IMMUTABLE/});
  await publicationWins({publishSql:"UPDATE organization_profile.completion_policy SET lifecycle='PUBLISHED' WHERE completion_policy_id=$1",publishParams:[concurrentCompletion],memberSql:"INSERT INTO organization_profile.completion_slot(completion_policy_id,slot_code,allowed_knowledge_states,verification_requirement) VALUES($1,'LATE_SLOT',ARRAY['KNOWN'],'VERIFIED')",memberParams:[concurrentCompletion],error:/F13_PROFILE_POLICY_MEMBER_IMMUTABLE/});
  await publicationWins({publishSql:"UPDATE organization_profile.compatibility_manifest SET lifecycle='PUBLISHED',published_at=transaction_timestamp() WHERE manifest_id=$1",publishParams:[concurrentManifest],memberSql:"INSERT INTO organization_profile.release_bundle(bundle_id,manifest_id,bundle_version,profile_schema_version,snapshot_schema_version,tuple_definition,bundle_digest) VALUES('71300000-0000-4000-8000-0000000000b1',$1,'late-bundle-v1','profile-v1','snapshot-v1','{}',$2)",memberParams:[concurrentManifest,'5'.repeat(64)],error:/F13_PROFILE_MANIFEST_MEMBER_IMMUTABLE/});
  await tenant.query("INSERT INTO organization_profile.purpose_catalog_release(catalog_version,lifecycle,catalog_digest) VALUES('concurrent-purpose-v1','DRAFT',$1)",['9'.repeat(64)]);
  await tenant.query("INSERT INTO organization_profile.purpose_catalog_entry(catalog_version,purpose_code,operation_code,lifecycle) VALUES('concurrent-purpose-v1','INITIAL_PURPOSE','F13_PROFILE_READ','PUBLISHED')");
  await publicationWins({publishSql:"UPDATE organization_profile.purpose_catalog_release SET lifecycle='PUBLISHED',published_at=transaction_timestamp() WHERE catalog_version='concurrent-purpose-v1'",publishParams:[],memberSql:"INSERT INTO organization_profile.purpose_catalog_entry(catalog_version,purpose_code,operation_code,lifecycle) VALUES('concurrent-purpose-v1','LATE_PURPOSE','F13_PROFILE_READ','PUBLISHED')",memberParams:[],error:/F13_PROFILE_CATALOG_ENTRY_IMMUTABLE/});
  await tenant.query("INSERT INTO organization_profile.reason_catalog_release(catalog_version,lifecycle,catalog_digest) VALUES('incomplete-reason-v1','DRAFT',$1)",['a'.repeat(64)]);
  await assert.rejects(()=>tenant.query("UPDATE organization_profile.reason_catalog_release SET lifecycle='PUBLISHED',published_at=transaction_timestamp() WHERE catalog_version='incomplete-reason-v1'"),/F13_PROFILE_CATALOG_PUBLICATION_INCOMPLETE/);
  await tenant.query("INSERT INTO organization_profile.reason_catalog_entry(catalog_version,reason_code,operation_code,lifecycle) VALUES('incomplete-reason-v1','DRAFT_REASON','F13_PROFILE_READ','DRAFT')");
  await assert.rejects(()=>tenant.query("UPDATE organization_profile.reason_catalog_release SET lifecycle='PUBLISHED',published_at=transaction_timestamp() WHERE catalog_version='incomplete-reason-v1'"),/F13_PROFILE_CATALOG_PUBLICATION_INCOMPLETE/);
  const graphRelease='71300000-0000-4000-8000-0000000000d0',thematicScheme='71300000-0000-4000-8000-0000000000d1',territoryScheme='71300000-0000-4000-8000-0000000000d2',noneScheme='71300000-0000-4000-8000-0000000000d3',concurrentSchemeId='71300000-0000-4000-8000-0000000000d4';
  await tenant.query("INSERT INTO organization_profile.catalog_release(release_id,organization_id,namespace,release_version,lifecycle,semantic_digest,provenance) VALUES($1,$2,'TENANT','graph-v1','DRAFT',$3,'{}')",[graphRelease,TENANT,'b'.repeat(64)]);
  for(const [schemeId,schemeCode,domain] of [[thematicScheme,'THEMATIC_AREA','THEMATIC'],[territoryScheme,'ADMINISTRATIVE_AREA','TERRITORY'],[noneScheme,'LEGAL_NATURE','NONE'],[concurrentSchemeId,'STRATEGIC_PRIORITY','THEMATIC']])await tenant.query('INSERT INTO organization_profile.scheme(scheme_id,release_id,organization_id,scheme_code,relation_domain) VALUES($1,$2,$3,$4,$5)',[schemeId,graphRelease,TENANT,schemeCode,domain]);
  await assert.rejects(()=>tenant.query("INSERT INTO organization_profile.scheme(scheme_id,release_id,organization_id,scheme_code,relation_domain) VALUES('71300000-0000-4000-8000-0000000000df',$1,$2,'COUNTRY_TERRITORY','THEMATIC')",[graphRelease,TENANT]),/scheme_check/);
  const concepts=[
   ['71300000-0000-4000-8000-0000000000e0',thematicScheme,'THEME_A'],['71300000-0000-4000-8000-0000000000e1',thematicScheme,'THEME_B'],['71300000-0000-4000-8000-0000000000e2',thematicScheme,'THEME_C'],
   ['71300000-0000-4000-8000-0000000000e3',territoryScheme,'TERRITORY_A'],['71300000-0000-4000-8000-0000000000e4',territoryScheme,'TERRITORY_B'],
   ['71300000-0000-4000-8000-0000000000e5',noneScheme,'LEGAL_A'],['71300000-0000-4000-8000-0000000000e6',noneScheme,'LEGAL_B'],
   ['71300000-0000-4000-8000-0000000000e7',concurrentSchemeId,'PRIORITY_A'],['71300000-0000-4000-8000-0000000000e8',concurrentSchemeId,'PRIORITY_B']
  ];
  for(const [conceptId,schemeId,code] of concepts)await tenant.query("INSERT INTO organization_profile.concept(concept_id,release_id,scheme_id,organization_id,stable_code,provenance) VALUES($1,$2,$3,$4,$5,'{}')",[conceptId,graphRelease,schemeId,TENANT,code]);
  const addRelation=(id,schemeId,source,target,type)=>tenant.query("INSERT INTO organization_profile.concept_relation(relation_id,release_id,scheme_id,source_concept_id,target_concept_id,relation_type,provenance) VALUES($1,$2,$3,$4,$5,$6,'{}')",[id,graphRelease,schemeId,source,target,type]);
  await addRelation('71300000-0000-4000-8000-0000000000f0',thematicScheme,concepts[0][0],concepts[1][0],'PARENT');
  await addRelation('71300000-0000-4000-8000-0000000000f1',thematicScheme,concepts[0][0],concepts[2][0],'PARENT');
  await addRelation('71300000-0000-4000-8000-0000000000f2',thematicScheme,concepts[1][0],concepts[2][0],'PARENT');
  await assert.rejects(()=>addRelation('71300000-0000-4000-8000-0000000000f3',thematicScheme,concepts[2][0],concepts[0][0],'PARENT'),/F13_PROFILE_RELATION_CYCLE/);
  await assert.rejects(()=>addRelation('71300000-0000-4000-8000-0000000000f4',thematicScheme,concepts[2][0],concepts[0][0],'CONTAINS'),/F13_PROFILE_RELATION_DOMAIN_INVALID/);
  await addRelation('71300000-0000-4000-8000-0000000000f5',territoryScheme,concepts[3][0],concepts[4][0],'CONTAINS');
  await assert.rejects(()=>addRelation('71300000-0000-4000-8000-0000000000f6',territoryScheme,concepts[4][0],concepts[3][0],'PARENT'),/F13_PROFILE_RELATION_DOMAIN_INVALID/);
  await assert.rejects(()=>addRelation('71300000-0000-4000-8000-0000000000f7',noneScheme,concepts[5][0],concepts[6][0],'PARENT'),/F13_PROFILE_RELATION_DOMAIN_INVALID/);
  await assert.rejects(()=>tenant.query("UPDATE organization_profile.scheme SET scheme_code='STATISTICAL_REGION',relation_domain='TERRITORY' WHERE scheme_id=$1",[thematicScheme]),/F13_PROFILE_SCHEME_RELATION_DOMAIN_IMMUTABLE/);
  const competingRelations=await Promise.allSettled([
   addRelation('71300000-0000-4000-8000-0000000000f8',concurrentSchemeId,concepts[7][0],concepts[8][0],'PARENT'),
   addRelation('71300000-0000-4000-8000-0000000000f9',concurrentSchemeId,concepts[8][0],concepts[7][0],'PARENT')
  ]);
  assert.equal(competingRelations.filter(result=>result.status==='fulfilled').length,1);
  assert.equal(competingRelations.filter(result=>result.status==='rejected'&&/F13_PROFILE_RELATION_CYCLE/.test(result.reason.message)).length,1);
  const updateScheme='71300000-0000-4000-8000-000000000100';
  const updateA='71300000-0000-4000-8000-000000000101',updateB='71300000-0000-4000-8000-000000000102',updateC='71300000-0000-4000-8000-000000000103';
  const oldRelation='71300000-0000-4000-8000-000000000104',newRelation='71300000-0000-4000-8000-000000000105',otherRelation='71300000-0000-4000-8000-000000000106';
  await tenant.query("INSERT INTO organization_profile.scheme(scheme_id,release_id,organization_id,scheme_code,relation_domain) VALUES($1,$2,$3,'COUNTRY_TERRITORY','TERRITORY')",[updateScheme,graphRelease,TENANT]);
  for(const [conceptId,code] of [[updateA,'UPDATE_A'],[updateB,'UPDATE_B'],[updateC,'UPDATE_C']])await tenant.query("INSERT INTO organization_profile.concept(concept_id,release_id,scheme_id,organization_id,stable_code,provenance) VALUES($1,$2,$3,$4,$5,'{}')",[conceptId,graphRelease,updateScheme,TENANT,code]);
  await addRelation(oldRelation,updateScheme,updateA,updateB,'CONTAINS');
  await tenant.query('UPDATE organization_profile.concept_relation SET relation_id=$1,source_concept_id=$2,target_concept_id=$3 WHERE relation_id=$4',[newRelation,updateB,updateA,oldRelation]);
  assert.deepEqual((await tenant.query('SELECT relation_id,source_concept_id,target_concept_id FROM organization_profile.concept_relation WHERE scheme_id=$1',[updateScheme])).rows,[{relation_id:newRelation,source_concept_id:updateB,target_concept_id:updateA}]);
  await addRelation(otherRelation,updateScheme,updateA,updateC,'CONTAINS');
  await assert.rejects(()=>addRelation('71300000-0000-4000-8000-000000000107',updateScheme,updateC,updateB,'CONTAINS'),/F13_PROFILE_RELATION_CYCLE/);
  await assert.rejects(()=>tenant.query('UPDATE organization_profile.concept_relation SET target_concept_id=$1 WHERE relation_id=$2',[updateB,otherRelation]),/F13_PROFILE_RELATION_CYCLE/);
  assert.equal((await tenant.query('SELECT target_concept_id FROM organization_profile.concept_relation WHERE relation_id=$1',[otherRelation])).rows[0].target_concept_id,updateC);
  const orderedRelease='71300000-0000-4000-8000-0000000000c0',orderedScheme='71300000-0000-4000-8000-0000000000c1';
  const globalRelease='71300000-0000-4000-8000-000000000110',globalScheme='71300000-0000-4000-8000-000000000111',globalConcept='71300000-0000-4000-8000-000000000112';
  await tenant.query("INSERT INTO organization_profile.catalog_release(release_id,organization_id,namespace,release_version,lifecycle,semantic_digest,provenance) VALUES($1,NULL,'GLOBAL','ownership-global-v1','DRAFT',$2,'{}')",[globalRelease,'c'.repeat(64)]);
  await tenant.query("INSERT INTO organization_profile.scheme(scheme_id,release_id,organization_id,scheme_code,relation_domain) VALUES($1,$2,NULL,'THEMATIC_AREA','THEMATIC')",[globalScheme,globalRelease]);
  await tenant.query("INSERT INTO organization_profile.concept(concept_id,release_id,scheme_id,organization_id,stable_code,provenance) VALUES($1,$2,$3,NULL,'GLOBAL_CONCEPT','{}')",[globalConcept,globalRelease,globalScheme]);
  for(const [releaseId,organizationId] of [[graphRelease,null],[graphRelease,OTHER_TENANT],[globalRelease,TENANT]]){
   await assert.rejects(()=>tenant.query("INSERT INTO organization_profile.scheme(scheme_id,release_id,organization_id,scheme_code,relation_domain) VALUES('71300000-0000-4000-8000-000000000113',$1,$2,'INSTITUTION_TYPE','NONE')",[releaseId,organizationId]),error=>error.code==='23503');
  }
  for(const [releaseId,schemeId,organizationId] of [[graphRelease,thematicScheme,null],[graphRelease,thematicScheme,OTHER_TENANT],[globalRelease,globalScheme,TENANT]]){
   await assert.rejects(()=>tenant.query("INSERT INTO organization_profile.concept(concept_id,release_id,scheme_id,organization_id,stable_code,provenance) VALUES('71300000-0000-4000-8000-000000000114',$1,$2,$3,'INVALID_OWNER','{}')",[releaseId,schemeId,organizationId]),error=>error.code==='23503');
  }
  await assert.rejects(()=>tenant.query('UPDATE organization_profile.concept SET organization_id=$1 WHERE concept_id=$2',[TENANT,globalConcept]),error=>error.code==='23503');
  await assert.rejects(()=>tenant.query('UPDATE organization_profile.scheme SET organization_id=$1 WHERE scheme_id=$2',[OTHER_TENANT,thematicScheme]),error=>error.code==='23503');
  await assert.rejects(()=>tenant.query("UPDATE organization_profile.catalog_release SET organization_id=$1,namespace='TENANT' WHERE release_id=$2",[TENANT,globalRelease]),error=>error.code==='23503');
  await assert.rejects(()=>tenant.query('UPDATE organization_profile.catalog_release SET organization_id=$1 WHERE release_id=$2',[OTHER_TENANT,graphRelease]),error=>error.code==='23503');
  await assert.rejects(()=>tenant.query("UPDATE organization_profile.scheme SET ownership_key='GLOBAL' WHERE scheme_id=$1",[thematicScheme]),error=>error.code==='428C9');
  assert.equal((await tenant.query('SELECT organization_id FROM organization_profile.concept WHERE concept_id=$1',[globalConcept])).rows[0].organization_id,null);
  await tenant.query("INSERT INTO organization_profile.catalog_release(release_id,organization_id,namespace,release_version,lifecycle,semantic_digest,provenance) VALUES($1,$2,'TENANT','member-first-v1','DRAFT',$3,'{}')",[orderedRelease,TENANT,'6'.repeat(64)]);
  await tenant.query("INSERT INTO organization_profile.scheme(scheme_id,release_id,organization_id,scheme_code,relation_domain) VALUES($1,$2,$3,'THEMATIC_AREA','THEMATIC')",[orderedScheme,orderedRelease,TENANT]);
  const memberFirst=await tenant.connect(),publisherSecond=await tenant.connect();try{await memberFirst.query('BEGIN');await publisherSecond.query('BEGIN');const publisherPid=(await publisherSecond.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;await memberFirst.query("UPDATE organization_profile.scheme SET scheme_code='STRATEGIC_PRIORITY' WHERE scheme_id=$1",[orderedScheme]);const publication=publisherSecond.query("UPDATE organization_profile.catalog_release SET lifecycle='PUBLISHED',published_at=transaction_timestamp() WHERE release_id=$1",[orderedRelease]).then(()=>({accepted:true}),failure=>({accepted:false,failure}));await waitUntilBlocked(publisherPid);await memberFirst.query('COMMIT');assert.equal((await publication).accepted,true);await publisherSecond.query('COMMIT');}finally{memberFirst.release();publisherSecond.release();}
  assert.deepEqual((await tenant.query('SELECT r.lifecycle,s.scheme_code,s.relation_domain FROM organization_profile.catalog_release r JOIN organization_profile.scheme s ON s.release_id=r.release_id WHERE r.release_id=$1',[orderedRelease])).rows[0],{lifecycle:'PUBLISHED',scheme_code:'STRATEGIC_PRIORITY',relation_domain:'THEMATIC'});
 const runtime=await tenant.connect();try{await runtime.query('BEGIN');await runtime.query('SET LOCAL ROLE c4g_organization_profile_runtime');await runtime.query("SELECT set_config('app.organization_id',$1,true)",[TENANT]);await assert.rejects(()=>runtime.query('SELECT * FROM organization_profile.profile_scope'),/permission denied/);await runtime.query('ROLLBACK');await runtime.query('BEGIN');await runtime.query('SET LOCAL ROLE c4g_organization_profile_runtime');await runtime.query("SELECT set_config('app.organization_id',$1,true)",[TENANT]);assert.equal((await runtime.query('SELECT count(*)::int AS count FROM organization_profile.catalog_release WHERE release_id=ANY($1::uuid[])',[[graphRelease,globalRelease]])).rows[0].count,2);await runtime.query('SAVEPOINT global_write_probe');await assert.rejects(()=>runtime.query("INSERT INTO organization_profile.catalog_release(release_id,organization_id,namespace,release_version,lifecycle,semantic_digest,provenance) VALUES('71300000-0000-4000-8000-000000000120',NULL,'GLOBAL','runtime-global-denied','DRAFT',$1,'{}')",['a'.repeat(64)]),/row-level security/);await runtime.query('ROLLBACK TO SAVEPOINT global_write_probe');await runtime.query("SELECT set_config('app.organization_id',$1,true)",[OTHER_TENANT]);assert.equal((await runtime.query('SELECT count(*)::int AS count FROM organization_profile.catalog_release WHERE release_id=ANY($1::uuid[])',[[graphRelease,globalRelease]])).rows[0].count,1);await runtime.query('ROLLBACK');}finally{runtime.release();}
 await admin.query(`CREATE DATABASE ${otherDb} ENCODING 'UTF8' LOCALE_PROVIDER icu ICU_LOCALE 'und' TEMPLATE template0`);
 await admin.query(`ALTER DATABASE ${otherDb} SET timezone TO 'UTC'`);
 await admin.query(`GRANT CONNECT,CREATE ON DATABASE ${otherDb} TO c4g_tenant_owner`);
 await admin.query(`GRANT CONNECT ON DATABASE ${otherDb} TO c4g_tenant_migrator,c4g_tenant_runtime`);
 await admin.query(`ALTER ROLE c4g_tenant_runtime IN DATABASE ${otherDb} SET search_path TO pg_catalog,c4g_app`);
 const otherUrl=new URL(process.env.F13_S2_GATE_URL);otherUrl.pathname=`/${otherDb}`;
 otherTenant=new Pool({connectionString:otherUrl.toString(),max:2});
 await otherTenant.query('REVOKE ALL ON SCHEMA public FROM PUBLIC');await otherTenant.query(`REVOKE CONNECT,TEMP ON DATABASE ${otherDb} FROM PUBLIC`);
 const otherRunner=createTenantMigrationRunner({entries:manifest,pool:otherTenant,observationPublisher:{async publish(){}},timeoutMs:15000,scheduler:{setTimeout,clearTimeout}});
 await otherRunner.migrate({tenantId:OTHER_TENANT,databaseGenerationId:'71300000-0000-4000-8000-000000000004',expectedRevision:1,correlationId:'f13-physical-b',idempotencyKey:'f13-physical-b'});
 const taxonomyProof=await verifyTaxonomyProduction({pool:tenant,otherPool:otherTenant,organizationId:TENANT,generationId:GENERATION,globalRelease});
 const authorityProof=await require('./authority-commit-gate').verifyAuthorityCommitProtocol({pool:tenant,otherPool:otherTenant,
   organizationId:TENANT,generationId:GENERATION,otherOrganizationId:OTHER_TENANT,otherGenerationId:'71300000-0000-4000-8000-000000000004'});
 process.stdout.write(JSON.stringify(authorityProof)+'\n');
 await assert.rejects(()=>runner.downgrade({tenantId:TENANT,databaseGenerationId:GENERATION,expectedRevision:6,correlationId:'f13-down-data-denied',idempotencyKey:'f13-down-data-denied',targetVersion:manifest[6].version}));
 assert.equal((await tenant.query('SELECT count(*)::int count FROM c4g_system.schema_migration')).rows[0].count,8);
 const evidence=await preflightTenant(tenant,{tenantId:TENANT,databaseGenerationId:GENERATION},manifest,{timeoutMs:10000});assert.equal(evidence.schemaFingerprint,manifest.at(-1).schemaFingerprint);
 await tenant.query('ALTER TABLE organization_profile.profile_scope NO FORCE ROW LEVEL SECURITY');await assert.rejects(()=>preflightTenant(tenant,{tenantId:TENANT,databaseGenerationId:GENERATION},manifest,{timeoutMs:10000}));
   process.stdout.write(JSON.stringify({...taxonomyProof,postgres17:true,canonicalRunner:true,migration007:true,secondRunIdempotent:true,accessCatalogDownDataLossDenied:true,profileScopeBaselineUnique:true,profileScopeForeignKey:true,profileScopeTypeAndLifecycleBound:true,publishedMemberGraphsImmutable:true,publicationMemberMutationsSerialized:true,accessCatalogVersionsImmutable:true,taxonomyRelationDomainsAndDag:true,taxonomyRelationUpdatesEvaluateFutureGraph:true,catalogMemberOwnershipBound:true,forcedRls:true,exactTaxonomyRuntimeGrants:true,globalCatalogReadOnly:true,tenantTaxonomyIsolation:true,taxonomyIdempotencyConcurrent:true,materialAuthorMakerChecker:true,persistedF7Evidence:true,independentSchemeIds:true,securityDriftDenied:true,cleanupByFinally:true})+'\n');
 }finally{if(otherTenant)await otherTenant.end();if(tenant)await tenant.end();for(const database of [DB,otherDb]){await admin.query(`SELECT pg_terminate_backend(pid) FROM pg_catalog.pg_stat_activity WHERE datname=$1`,[database]).catch(()=>{});await admin.query(`DROP DATABASE IF EXISTS ${database}`).catch(()=>{});}for(const role of ['c4g_organization_profile_runtime','c4g_organization_profile_migrator','c4g_organization_profile_owner','c4g_organizational_scope_runtime','c4g_organizational_scope_migrator','c4g_organizational_scope_owner','c4g_tenant_runtime','c4g_tenant_migrator','c4g_tenant_owner'])await admin.query(`DROP ROLE IF EXISTS ${role}`).catch(()=>{});await admin.end();}}
run().catch(error=>{console.error(error.stack||error);process.exitCode=1;});
