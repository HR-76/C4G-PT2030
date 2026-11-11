'use strict';
const assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');
const {Pool}=require('../../../backend/node_modules/pg');
const {manifest:fullManifest,migrationSql}=require('../../../backend/src/security/tenantMigrationManifest');
const manifest=Object.freeze(fullManifest.slice(0,10));
const {createTenantMigrationRunner}=require('../../../backend/src/security/tenantMigrationRunner');
const {preflightTenant}=require('../../../backend/src/security/tenantMigrationPreflight');
const {tenantSchemaSnapshot,tenantSchemaFingerprint}=require('../../../backend/src/security/tenantSchemaFingerprint');
const {createMembershipRepository}=require('../../../backend/src/security/membershipRepository');
const {createAuthoringRuntimeComposition}=require('../../../backend/src/organizationalProfile/authoringComposition');
const {createAuthoringTelemetry}=require('../../../backend/src/organizationalProfile/authoringTelemetry');
const {runtimeFixture}=require('./runtime-fixture');
const {centralAuthorityFixture}=require('./central-authority-fixture');
const tables=['profile_draft','profile_draft_revision','profile_item_version','profile_revision_item','idempotency_record'];
async function run(){
 if(process.env.F13_S2_DISPOSABLE_PROOF!=='C4G_F13_S2_DISPOSABLE_V1')throw new Error('Disposable proof required');
 const url=new URL(process.env.F13_S2_ADMIN_URL);
 if(url.hostname!=='127.0.0.1'||['5432','5433'].includes(url.port))throw new Error('Unsafe target');
 const admin=new Pool({connectionString:url.toString(),max:2}),databases=[],fixtures=[];
 let central;
 try{
  for(const role of ['c4g_tenant_owner','c4g_tenant_migrator','c4g_tenant_runtime'])await admin.query(`CREATE ROLE ${role} NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`);
  await admin.query('GRANT c4g_tenant_owner TO c4g_tenant_migrator');await admin.query('GRANT c4g_tenant_migrator TO c4g_f12_admin');
  for(let n=0;n<2;n++){
   const name=`c4g_f13_competency_${n}`,org=randomUUID(),gen=randomUUID();
   await admin.query(`CREATE DATABASE ${name} ENCODING 'UTF8' LOCALE_PROVIDER icu ICU_LOCALE 'und' TEMPLATE template0`);
   await admin.query(`ALTER DATABASE ${name} SET timezone TO 'UTC'`);
   await admin.query(`GRANT CONNECT,CREATE ON DATABASE ${name} TO c4g_tenant_owner`);
   await admin.query(`GRANT CONNECT ON DATABASE ${name} TO c4g_tenant_migrator,c4g_tenant_runtime`);
   const tenantUrl=new URL(url);tenantUrl.pathname=`/${name}`;
   const pool=new Pool({connectionString:tenantUrl.toString(),max:8}),db={name,org,gen,pool};databases.push(db);
   await pool.query('REVOKE ALL ON SCHEMA public FROM PUBLIC');await pool.query(`REVOKE CONNECT,TEMP ON DATABASE ${name} FROM PUBLIC`);
   await pool.query(`ALTER ROLE c4g_tenant_runtime IN DATABASE ${name} SET search_path TO pg_catalog,c4g_app`);
   const runner=(entries=manifest,source=pool)=>createTenantMigrationRunner({pool:source,entries,observationPublisher:{async publish(){}},timeoutMs:15000,scheduler:{setTimeout,clearTimeout}});
   const request={tenantId:org,databaseGenerationId:gen,expectedRevision:1,correlationId:'authoring-gate',idempotencyKey:'authoring-gate'};
   await runner(Object.freeze(manifest.slice(0,9))).migrate(request);
   if(process.env.F13_AUTHORING_CAPTURE==='1'){
    const client=await pool.connect();try{await client.query('BEGIN');await client.query(migrationSql(manifest[9].version,'up').sql);
     const fingerprint=tenantSchemaFingerprint(await tenantSchemaSnapshot(client));
     await client.query(migrationSql(manifest[9].version,'down').sql);
     assert.equal(tenantSchemaFingerprint(await tenantSchemaSnapshot(client)),manifest[8].schemaFingerprint);
     await client.query('ROLLBACK');process.stdout.write(JSON.stringify({captureOnly:true,fingerprint,emptyDownReturns008:true})+'\n');
    }finally{await client.query('ROLLBACK').catch(()=>{});client.release();}return;
   }
   const failing={async connect(){const c=await pool.connect();return{release:e=>c.release(e),async query(sql,values){
    if(sql.includes('INSERT INTO c4g_system.schema_migration')&&values?.[1]===9)throw new Error('008_LEDGER_FAILURE');return c.query(sql,values);}};}};
   await assert.rejects(()=>runner(manifest,failing).migrate(request));
   assert.equal((await pool.query("SELECT to_regclass('organization_profile.competency_assertion_version') AS present")).rows[0].present,null);
   assert.equal((await preflightTenant(pool,{tenantId:org,databaseGenerationId:gen},manifest,{timeoutMs:10000})).currentVersion,manifest[8].version);
   const upgraded=await runner().migrate(request);assert.deepEqual(upgraded.appliedVersions,[manifest[9].version]);
   assert.deepEqual((await runner().migrate(request)).appliedVersions,[]);
   const reverted=await runner().downgrade({...request,targetVersion:manifest[8].version,expectedRevision:2});
   assert.deepEqual(reverted.revertedVersions,[manifest[9].version]);assert.equal(reverted.evidence.schemaFingerprint,manifest[8].schemaFingerprint);
   assert.equal((await pool.query('SELECT count(*)::int n FROM c4g_system.schema_migration')).rows[0].n,9);
   assert.deepEqual((await runner().migrate({...request,expectedRevision:3})).appliedVersions,[manifest[9].version]);
   await assert.rejects(()=>runner().downgrade({...request,targetVersion:manifest[7].version}));
   db.evidence=await preflightTenant(pool,{tenantId:org,databaseGenerationId:gen},manifest,{timeoutMs:10000});
  }
  central=await centralAuthorityFixture(url.toString());
  const decisions=[],metrics=[];let auditFailure=false,loseCommit=false,functionalSql=0,allows=0,finalHook=null;
  const [a,b]=databases;
  const preparedPool={async connect(){const client=await a.pool.connect();return{release:e=>client.release(e),async query(sql,values){
   if(sql.includes('organization_profile.'))functionalSql++;
   if(sql.includes('audit.append_event_v1')&&auditFailure)throw new Error('AUTHORING_F7_FAILURE');
   const result=await client.query(sql,values);
   if(sql==='RESET ROLE'&&finalHook){const hook=finalHook;finalHook=null;await hook();}
   if(sql==='COMMIT'&&loseCommit){loseCommit=Number(loseCommit)-1;throw new Error('AUTHORING_COMMIT_UNKNOWN');}
   return result;
  }};}};
  const composition=createAuthoringRuntimeComposition({sessionStore:central.store,sessionRegistry:central.registry,authorityCoordinator:central.coordinator,
   authorizationCatalogs:central.catalogs,assurancePolicyVersion:'c4g-assurance-v1',recentMfaRequirement:central.requirement,
   telemetry:createAuthoringTelemetry({metrics:{record(name,value,labels){metrics.push({name,labels});}}})});
  async function bind(db,target){const evidence=await preflightTenant(target,{tenantId:db.org,databaseGenerationId:db.gen},manifest,{timeoutMs:10000});
   const fixture=await runtimeFixture({pool:target,evidence,sessions:{memberships:new Map()}});fixtures.push(fixture);
   fixture.dependencies.membershipRepository=createMembershipRepository(central.pool,central.coordinator);
   return composition.bindTenant({pool:target,organizationId:db.org,tenantId:db.org,tenantCapabilityEvidence:evidence,tenantRuntimeDependencies:fixture.dependencies,
    authorizationAuditPort:{async accept(event){decisions.push(event);if(event.result==='ALLOW')allows++;return'ACCEPTED';}}});
  }
  a.bound=await bind(a,preparedPool);b.bound=await bind(b,b.pool);
  const codes=['organization_profile.draft.create','organization_profile.draft.edit','organization_profile.submit','profile_evidence.attach','profile_evidence.link.read','profile_competency.verify','document.read'];
  async function actor(db){const u=await central.user(db.org,randomUUID(),randomUUID());u.version=1;
   await grants(db,u,codes.map(permission=>({permission,scope:{type:'ORGANIZATION',id:db.org,organizationId:db.org}})));
   u.handle=await db.bound.captureAuthenticatedRequest(u.request);return u;}
  async function grants(db,u,value){await central.data.change({organizationId:db.org,membershipId:u.membershipId,expectedVersion:u.version,grants:value,assuranceRequirements:central.requirement});u.version++;}
  const user=await actor(a),other=await actor(b),service=a.bound.service;
  const create=()=>({draftId:randomUUID(),scopeId:null,items:[],idempotencyKey:randomUUID()});
  const item=(itemId=randomUUID())=>({itemId,itemVersionId:randomUUID(),domain:'THEMATIC_AREA',knowledgeStatus:'UNKNOWN',conceptId:null});
  async function counts(db){const result={};for(const table of [...tables,'profile_scope'])result[table]=(await db.pool.query(`SELECT count(*)::int n FROM organization_profile.${table}`)).rows[0].n;
   result.events=(await db.pool.query("SELECT count(*)::int n FROM audit.event WHERE event_code LIKE 'PROFILE_DRAFT_%'")).rows[0].n;return result;}
  async function deniedUnchanged(fn,early=false){const before=await counts(a),beforeB=await counts(b),sql=functionalSql,positive=allows;
   await assert.rejects(fn);assert.deepEqual(await counts(a),before);assert.deepEqual(await counts(b),beforeB);
   if(early){assert.equal(functionalSql,sql);assert.equal(allows,positive);}}
  // Closed functional input and opaque session handles refuse injected authority before tenant SQL/F5.
  for(const field of ['actor','organizationId','membershipId','correlationId','assurance','resourceId'])await deniedUnchanged(()=>service.createDraft({...create(),[field]:randomUUID()},user.handle),true);
  await deniedUnchanged(()=>service.createDraft(create(),{}),true);
  await deniedUnchanged(()=>service.createDraft(create(),other.handle),true);
  const cmd=create(),created=await service.createDraft(cmd,user.handle);assert.equal(created.revision,1);
  assert.deepEqual(await service.createDraft(cmd,user.handle),created);
  await deniedUnchanged(()=>service.createDraft({...cmd,items:[item()]},user.handle));
  const edit={draftId:cmd.draftId,expectedRevision:1,items:[item()],idempotencyKey:randomUUID()};
  const edited=await service.editDraft(edit,user.handle);assert.equal(edited.revision,2);
  assert.deepEqual(await service.editDraft(edit,user.handle),edited);
  const contenders=[0,1].map(()=>({draftId:cmd.draftId,expectedRevision:2,items:[item(edit.items[0].itemId)],idempotencyKey:randomUUID()}));
  const races=await Promise.allSettled(contenders.map(c=>service.editDraft(c,user.handle)));
  assert.equal(races.filter(r=>r.status==='fulfilled').length,1);
  assert.equal(races.filter(r=>r.status==='rejected'&&r.reason.code==='F13_STALE_REVISION').length,1);
  const shared=create(),replayed=await Promise.all([service.createDraft(shared,user.handle),service.createDraft(shared,user.handle)]);assert.deepEqual(replayed[0],replayed[1]);
  const submitted=await service.submitDraft({draftId:cmd.draftId,expectedRevision:3,idempotencyKey:randomUUID()},user.handle);assert.equal(submitted.revision,4);assert.equal(submitted.lifecycle,'SUBMITTED');
  await deniedUnchanged(()=>service.editDraft({...edit,expectedRevision:4,idempotencyKey:randomUUID()},user.handle));
  assert.equal((await a.pool.query('SELECT count(*)::int n FROM organization_profile.profile_draft_revision WHERE draft_id=$1',[cmd.draftId])).rows[0].n,4);
  assert.equal((await a.pool.query('SELECT count(*)::int n FROM organization_profile.profile_revision_item WHERE draft_id=$1 AND revision IN(2,3,4)',[cmd.draftId])).rows[0].n,3);
  // Operation-scoped keys and physical A/B isolation.
  const bCmd={...cmd,draftId:randomUUID()};await b.bound.service.createDraft(bCmd,other.handle);
  await deniedUnchanged(()=>b.bound.service.editDraft(edit,other.handle));
  await service.editDraft({draftId:shared.draftId,expectedRevision:1,items:[],idempotencyKey:shared.idempotencyKey},user.handle);
  assert.equal((await a.pool.query('SELECT count(*)::int n FROM organization_profile.idempotency_record WHERE idempotency_key=$1',[shared.idempotencyKey])).rows[0].n,2);
  // Real F5 asymmetric grants, exact resources, and replay after revocation/version advancement.
  const restricted=await actor(a);
  await grants(a,restricted,[{permission:codes[0],scope:{type:'ORGANIZATION',id:a.org,organizationId:a.org}}]);
  restricted.handle=await a.bound.captureAuthenticatedRequest(restricted.request);
  const restrictedCmd=create();await service.createDraft(restrictedCmd,restricted.handle);
  await deniedUnchanged(()=>service.editDraft({...edit,draftId:restrictedCmd.draftId},restricted.handle));
  await deniedUnchanged(()=>service.submitDraft({draftId:restrictedCmd.draftId,expectedRevision:1,idempotencyKey:randomUUID()},restricted.handle));
  await grants(a,restricted,[{permission:codes[1],scope:{type:'ORGANIZATION',id:a.org,organizationId:a.org},resourceId:randomUUID(),resourceType:'PROFILE_DRAFT'}]);
  restricted.handle=await a.bound.captureAuthenticatedRequest(restricted.request);
  await deniedUnchanged(()=>service.editDraft({...edit,draftId:restrictedCmd.draftId},restricted.handle));
  await grants(a,restricted,[]);
  await deniedUnchanged(()=>service.createDraft(restrictedCmd,restricted.handle),true);
  restricted.handle=await a.bound.captureAuthenticatedRequest(restricted.request);
  await deniedUnchanged(()=>service.createDraft(restrictedCmd,restricted.handle));
  // UNIT/TEAM is derived from current server state, never caller authority.
  for(const type of ['UNIT','TEAM']){
   const scope=randomUUID();const c=await a.pool.connect();try{await c.query('BEGIN');await c.query("SELECT set_config('app.organization_id',$1,true)",[a.org]);
    await c.query(`INSERT INTO organizational_scope.scope(scope_id,organization_id,scope_type,label,provenance,created_by_actor_type,created_by_actor_id,updated_by_actor_type,updated_by_actor_id)
     VALUES($1,$2,$3,'Synthetic scope','{}','HUMAN',$4,'HUMAN',$4)`,[scope,a.org,type,user.id]);await c.query('COMMIT');
   }finally{c.release();}
   const scoped=await actor(a);await grants(a,scoped,codes.map(permission=>({permission,scope:{type,id:scope,organizationId:a.org}})));
   scoped.handle=await a.bound.captureAuthenticatedRequest(scoped.request);
   const scopedCmd={...create(),scopeId:scope};await service.createDraft(scopedCmd,scoped.handle);
   await service.editDraft({draftId:scopedCmd.draftId,expectedRevision:1,items:[],idempotencyKey:randomUUID()},scoped.handle);
   assert.equal((await a.pool.query('SELECT s.scope_type FROM organization_profile.profile_scope s JOIN organization_profile.profile_draft d USING(profile_scope_id) WHERE d.draft_id=$1',[scopedCmd.draftId])).rows[0].scope_type,type);
   await deniedUnchanged(()=>service.createDraft({...create(),scopeId:scope},other.handle),true);
  }
  // All three governed mutations roll back every functional/history/result/F7 row on append failure.
  const rollbackCmd=create();await service.createDraft(rollbackCmd,user.handle);auditFailure=true;
  try{await deniedUnchanged(()=>service.createDraft(create(),user.handle));
   await deniedUnchanged(()=>service.editDraft({...edit,draftId:rollbackCmd.draftId},user.handle));
   await deniedUnchanged(()=>service.submitDraft({draftId:rollbackCmd.draftId,expectedRevision:1,idempotencyKey:randomUUID()},user.handle));
  }finally{auditFailure=false;}
  // COMMIT physically succeeds, confirmation is lost: durable guard consults the same source-local record.
  const unknown=create();loseCommit=true;const reconciled=await service.createDraft(unknown,user.handle);
  assert.deepEqual(await service.createDraft(unknown,user.handle),reconciled);
  assert.equal((await a.pool.query('SELECT count(*)::int n FROM organization_profile.idempotency_record WHERE idempotency_key=$1',[unknown.idempotencyKey])).rows[0].n,1);
  assert.deepEqual((await central.pool.query("SELECT state,reconciliation_result FROM public.authority_commit_guard WHERE idempotency_key=$1 AND state='RECOVERED'",[unknown.idempotencyKey])).rows[0],{state:'RECOVERED',reconciliation_result:'COMMITTED'});
  // F4 drift at final verification causes integral rollback after F5 and provisional F7.
  const clean=structuredClone(fixtures[0].snapshot);finalHook=()=>{fixtures[0].snapshot.connectionRevision++;};
  await deniedUnchanged(()=>service.createDraft(create(),user.handle));fixtures[0].snapshot=clean;
  const events=(await a.pool.query("SELECT event_code,event_data FROM audit.event WHERE event_code LIKE 'PROFILE_DRAFT_%'")).rows;
  for(const code of ['PROFILE_DRAFT_CREATED','PROFILE_DRAFT_REVISION_CREATED','PROFILE_DRAFT_SUBMITTED'])assert.ok(events.some(e=>e.event_code===code));
  for(const row of events){const e=row.event_data,d=decisions.find(v=>v.correlationId===e.correlationId&&v.result==='ALLOW');assert.ok(d);
   assert.equal(e.actor.id,d.actorId);assert.equal(e.actor.membershipId,d.membershipId);assert.equal(e.organizationId,a.org);assert.equal(e.tenantId,a.org);
   for(const key of ['authorizationVersion','membershipVersion','policyVersion','assuranceLevel'])assert.equal(e.payload[key],d.evaluation?.[key]??d[key]);
   assert.ok(!Object.hasOwn(e.payload,'items'));assert.ok(e.payload.semanticDigest.match(/^[a-f0-9]{64}$/));}
  assert.equal(events.length,(await a.pool.query('SELECT count(*)::int n FROM organization_profile.idempotency_record')).rows[0].n);
  // Immutable history is enforced by PostgreSQL triggers, independent of repository behavior.
  for(const table of tables.filter(t=>t!=='profile_draft'))for(const verb of ['UPDATE','DELETE','TRUNCATE']){
   const c=await a.pool.connect();try{await c.query('BEGIN');await c.query("SELECT set_config('app.organization_id',$1,true)",[a.org]);
    await assert.rejects(()=>c.query(verb==='UPDATE'?`UPDATE organization_profile.${table} SET organization_id=organization_id`:verb==='DELETE'?`DELETE FROM organization_profile.${table}`:`TRUNCATE organization_profile.${table} CASCADE`),/F13_AUTHORING_APPEND_ONLY/);
   }finally{await c.query('ROLLBACK');c.release();}}
  const c=await a.pool.connect();try{await c.query('BEGIN');await c.query('SET LOCAL ROLE c4g_organization_profile_runtime');await c.query("SELECT set_config('app.organization_id',$1,true)",[b.org]);
   assert.equal((await c.query('SELECT count(*)::int n FROM organization_profile.profile_draft')).rows[0].n,0);
  }finally{await c.query('ROLLBACK');c.release();}
  // Appending new members to an already committed revision cannot change history.
  const sealed=await a.pool.connect();try{await sealed.query('BEGIN');await sealed.query("SELECT set_config('app.organization_id',$1,true)",[a.org]);
   await assert.rejects(()=>sealed.query(`INSERT INTO organization_profile.profile_revision_item
    SELECT * FROM organization_profile.profile_revision_item WHERE draft_id=$1 AND revision=2`,[cmd.draftId]),/F13_AUTHORING_APPEND_ONLY/);
  }finally{await sealed.query('ROLLBACK');sealed.release();}
  // A higher orphan revision cannot commit without its CAS head and contiguous history.
  const orphan=await a.pool.connect();try{await orphan.query('BEGIN');await orphan.query("SELECT set_config('app.organization_id',$1,true)",[a.org]);
   await orphan.query(`INSERT INTO organization_profile.profile_draft_revision
    SELECT organization_id,draft_id,profile_scope_id,99,lifecycle,semantic_digest,actor_subject_id,membership_id,correlation_id,authorization_evidence,created_at
     FROM organization_profile.profile_draft_revision WHERE draft_id=$1 AND revision=1`,[shared.draftId]);
   await assert.rejects(()=>orphan.query('COMMIT'),/F13_AUTHORING_INVALID_HEAD/);
  }finally{await orphan.query('ROLLBACK');orphan.release();}
  const snapshot=await tenantSchemaSnapshot(a.pool),down=await a.pool.connect();try{await down.query('BEGIN');
   await down.query(migrationSql(manifest[9].version,'down').sql);
   assert.equal(tenantSchemaFingerprint(await tenantSchemaSnapshot(down)),manifest[8].schemaFingerprint);
  }finally{await down.query('ROLLBACK');down.release();}
  assert.deepEqual(await tenantSchemaSnapshot(a.pool),snapshot);
  // KNOWN refs use a release published through the real governed taxonomy API on 008.
  const {createTaxonomyRuntimeComposition}=require('../../../backend/src/organizationalProfile/taxonomyComposition');
  const {createTaxonomyTelemetry}=require('../../../backend/src/organizationalProfile/taxonomyTelemetry');
  const taxonomy=createTaxonomyRuntimeComposition({sessionStore:central.store,sessionRegistry:central.registry,authorityCoordinator:central.coordinator,
   authorizationCatalogs:central.catalogs,assurancePolicyVersion:'c4g-assurance-v1',recentMfaRequirement:central.requirement,
   telemetry:createTaxonomyTelemetry({metrics:{record(){}}})}).bindTenant({pool:preparedPool,organizationId:a.org,tenantId:a.org,
   tenantCapabilityEvidence:await preflightTenant(preparedPool,{tenantId:a.org,databaseGenerationId:a.gen},manifest,{timeoutMs:10000}),
   tenantRuntimeDependencies:fixtures[0].dependencies,authorizationAuditPort:{async accept(event){decisions.push(event);return'ACCEPTED';}}});
  const subjects=[];for(let i=0;i<3;i++){const u=await central.user(a.org,randomUUID(),randomUUID());u.handle=await taxonomy.captureAuthenticatedRequest(u.request);subjects.push(u);}
  const provenance={sourceType:'ORGANIZATION_MANUAL',observedAt:new Date().toISOString()};
  const release={releaseId:randomUUID(),thematicSchemeId:randomUUID(),prioritySchemeId:randomUUID(),releaseVersion:'authoring-known-v1',
   semanticDigest:'b'.repeat(64),defaultLocale:'pt-PT',idempotencyKey:randomUUID(),provenance};
  await taxonomy.service.createRelease(release,subjects[0].handle);
  const concept={conceptId:randomUUID(),releaseId:release.releaseId,schemeId:release.thematicSchemeId,schemeCode:'THEMATIC_AREA',stableCode:'AUTHORING_KNOWN',
   labels:[{locale:'pt-PT',kind:'PREFERRED',label:'Synthetic known reference'}],idempotencyKey:randomUUID(),provenance};
  await taxonomy.service.createConcept(concept,subjects[0].handle);
  const known={...item(),knowledgeStatus:'KNOWN',conceptId:concept.conceptId};
  await deniedUnchanged(()=>service.createDraft({...create(),items:[known]},user.handle));
  await taxonomy.service.approveConcept({releaseId:release.releaseId,conceptId:concept.conceptId,idempotencyKey:randomUUID()},subjects[1].handle);
  await taxonomy.service.publishRelease({releaseId:release.releaseId,expectedDigest:release.semanticDigest,defaultLocale:'pt-PT',idempotencyKey:randomUUID()},subjects[2].handle);
  await service.createDraft({...create(),items:[known]},user.handle);
  await deniedUnchanged(()=>service.createDraft({...create(),items:[{...known,itemVersionId:randomUUID(),domain:'STRATEGIC_PRIORITY'}]},user.handle));
  // Excess column/table grants fail physical preflight, not just missing grants.
  await a.pool.query('GRANT UPDATE ON organization_profile.profile_item_version TO c4g_organization_profile_runtime');
  await assert.rejects(()=>preflightTenant(a.pool,{tenantId:a.org,databaseGenerationId:a.gen},manifest,{timeoutMs:10000}));
  await a.pool.query('REVOKE UPDATE ON organization_profile.profile_item_version FROM c4g_organization_profile_runtime');
  for(const [grant,revoke] of [
   ['GRANT CREATE ON SCHEMA organizational_scope TO c4g_organization_profile_runtime','REVOKE CREATE ON SCHEMA organizational_scope FROM c4g_organization_profile_runtime'],
   ['GRANT EXECUTE ON FUNCTION organization_profile.guard_authoring_material() TO PUBLIC','REVOKE EXECUTE ON FUNCTION organization_profile.guard_authoring_material() FROM PUBLIC']]){
   await a.pool.query(grant);
   await assert.rejects(()=>preflightTenant(a.pool,{tenantId:a.org,databaseGenerationId:a.gen},manifest,{timeoutMs:10000}));
   await a.pool.query(revoke);
  }
  await preflightTenant(a.pool,{tenantId:a.org,databaseGenerationId:a.gen},manifest,{timeoutMs:10000});
  await require('./competency-probes').runCompetencyProbes({central,a,b,user,other,actor,grants,create,preparedPool,fixtures,decisions,metrics,
   controls:{audit(value){auditFailure=value;},commit(value){loseCommit=value;}}});
  assert.ok(metrics.length);for(const m of metrics)assert.deepEqual(Object.keys(m.labels).sort(),['operation','resultClass']);
  process.stdout.write(JSON.stringify({authoringCompatibilityOn009:true,realCentralAndTwoTenants:true,upgrade008To009:true,canonical009To008To009:true,migrationLedgerRollback:true,casConcurrent:true,appendOnly:true,
   idempotencyConcurrent:true,intentionConflict:true,operationAndTenantIsolation:true,serverScopeUnitTeam:true,realF5AsymmetricResources:true,replayRevokedAndStaleDenied:true,
   persistedF7:true,threeMutationF7Rollback:true,uncertainCommitRecovered:true,physicalFenceRollback:true,sealedRevisionItems:true,orphanRevisionDenied:true,
   downRefusesProtectedData:true,knownRefsPublishedAndSchemeBound:true,taxonomyOn009:true,excessAclDenied:true,lowCardinality:true,checksum:manifest[9].sqlChecksum,fingerprint:manifest[9].schemaFingerprint})+'\n');
 }finally{
  for(const fixture of fixtures)await fixture.manager.closeAll();
  if(central)await central.close();for(const db of databases){await db.pool.end();await admin.query(`DROP DATABASE ${db.name}`);}
  await admin.end();
 }
}
run().catch(error=>{console.error(error.stack||error);process.exitCode=1;});
