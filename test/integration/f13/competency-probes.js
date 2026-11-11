'use strict';
const assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');
const {createCompetencyRuntimeComposition}=require('../../../backend/src/organizationalProfile/competencyComposition');
const {createCompetencyTelemetry}=require('../../../backend/src/organizationalProfile/competencyTelemetry');
const {manifest:fullManifest}=require('../../../backend/src/security/tenantMigrationManifest');
const manifest=Object.freeze(fullManifest.slice(0,10));
const {preflightTenant}=require('../../../backend/src/security/tenantMigrationPreflight');
const {createTenantMigrationRunner}=require('../../../backend/src/security/tenantMigrationRunner');
const tables=['profile_draft','profile_draft_revision','profile_item_version','profile_revision_item','idempotency_record',
 'competency_assertion_version','experience_evidence_version','competency_evidence_link','competency_verification_result','competency_revision_member','competency_idempotency_record'];
async function runCompetencyProbes({central,a,b,user,other,actor,grants,create,preparedPool,fixtures,decisions,metrics,controls}){
 const runtime=createCompetencyRuntimeComposition({sessionStore:central.store,sessionRegistry:central.registry,authorityCoordinator:central.coordinator,
  authorizationCatalogs:central.catalogs,assurancePolicyVersion:'c4g-assurance-v1',recentMfaRequirement:central.requirement,
  telemetry:createCompetencyTelemetry({metrics:{record(name,value,labels){metrics.push({name,labels});}}})});
 async function bind(db,pool,fixture){return runtime.bindTenant({pool,organizationId:db.org,tenantId:db.org,
  tenantCapabilityEvidence:await preflightTenant(pool,{tenantId:db.org,databaseGenerationId:db.gen},manifest,{timeoutMs:10000}),tenantRuntimeDependencies:fixture.dependencies,
  authorizationAuditPort:{async accept(event){decisions.push(event);return'ACCEPTED';}}});}
 const bound=await bind(a,preparedPool,fixtures[0]),boundB=await bind(b,b.pool,fixtures[1]),service=bound.service;
 async function counts(db){const value={};for(const table of tables)value[table]=(await db.pool.query(`SELECT count(*)::int n FROM organization_profile.${table}`)).rows[0].n;
  value.events=(await db.pool.query('SELECT count(*)::int n FROM audit.event')).rows[0].n;return value;}
 async function denied(fn){const before=await counts(a),beforeB=await counts(b);await assert.rejects(fn);assert.deepEqual(await counts(a),before);assert.deepEqual(await counts(b),beforeB);}
 let handle=await bound.captureAuthenticatedRequest(user.request);const draft=create();await a.bound.service.createDraft(draft,user.handle);
 const concept=randomUUID(),level=randomUUID(),experienceType=randomUUID(),method=randomUUID(),release=randomUUID(),framework=randomUUID();
 const assertion=()=>({assertionId:randomUUID(),versionId:randomUUID(),knowledgeStatus:'KNOWN',conceptId:concept,levelId:level});
 const set={draftId:draft.draftId,expectedRevision:1,assertions:[assertion()],idempotencyKey:randomUUID()};
 await denied(()=>service.setCompetencies(set,handle)); // Empty productive catalog is never permissive.
 for(const db of [a,b]){
  await db.pool.query("INSERT INTO organization_profile.competency_catalog_release(release_id,release_version,lifecycle,semantic_digest) VALUES($1,'synthetic-test-only','PUBLISHED',$2)",[release,'a'.repeat(64)]);
  for(const [id,kind,code] of [[concept,'COMPETENCY_CONCEPT','SYNTHETIC_CONCEPT'],[level,'FRAMEWORK_LEVEL','SYNTHETIC_LEVEL'],[experienceType,'EXPERIENCE_TYPE','SYNTHETIC_EXPERIENCE'],[method,'VERIFICATION_METHOD','SYNTHETIC_METHOD']])
   await db.pool.query('INSERT INTO organization_profile.competency_catalog_entry(entry_id,release_id,kind,stable_code,framework_id,framework_version,max_validity_seconds) VALUES($1,$2,$3,$4,$5,$6,$7)',
    [id,release,kind,code,['COMPETENCY_CONCEPT','FRAMEWORK_LEVEL'].includes(kind)?framework:null,['COMPETENCY_CONCEPT','FRAMEWORK_LEVEL'].includes(kind)?'synthetic-v1':null,kind==='VERIFICATION_METHOD'?3600:null]);
 }
 const setResult=await service.setCompetencies(set,handle);assert.equal(setResult.revision,2);assert.deepEqual(await service.setCompetencies(set,handle),setResult);
 await denied(()=>service.setCompetencies({...set,expectedRevision:2,assertions:[{...assertion(),conceptId:experienceType}],idempotencyKey:randomUUID()},handle));
 await denied(()=>service.setCompetencies({...set,expectedRevision:2,assertions:[{...assertion(),levelId:method}],idempotencyKey:randomUUID()},handle));
 await denied(()=>service.setCompetencies({...set,assertions:[assertion()]},handle));
 const exp=()=>({experienceId:randomUUID(),versionId:randomUUID(),typeId:experienceType,observedFrom:'2025-01-01T00:00:00.000Z',observedUntil:'2025-02-01T00:00:00.000Z',provenanceRef:randomUUID()});
 const experience=exp(),setExp={draftId:draft.draftId,expectedRevision:2,experiences:[experience],idempotencyKey:randomUUID()};
 const expResults=await Promise.all([service.setExperiences(setExp,handle),service.setExperiences(setExp,handle)]);assert.deepEqual(expResults[0],expResults[1]);
 const link={draftId:draft.draftId,expectedRevision:3,linkId:randomUUID(),assertionVersionId:set.assertions[0].versionId,experienceVersionId:experience.versionId,documentVersionId:null,idempotencyKey:randomUUID()};
 assert.equal((await service.attachEvidence(link,handle)).revision,4);
 await a.bound.service.editDraft({draftId:draft.draftId,expectedRevision:4,items:[],idempotencyKey:randomUUID()},user.handle);
 assert.equal((await a.pool.query('SELECT count(*)::int n FROM organization_profile.competency_revision_member WHERE draft_id=$1 AND revision=5',[draft.draftId])).rows[0].n,3);
 const verifier=await actor(a);let verifierHandle=await bound.captureAuthenticatedRequest(verifier.request);
 const verify={draftId:draft.draftId,expectedRevision:5,verificationId:randomUUID(),assertionVersionId:set.assertions[0].versionId,methodId:method,
  validUntil:new Date(Date.now()+1800000).toISOString(),idempotencyKey:randomUUID()};
 await denied(()=>service.verifyCompetency(verify,handle)); // Creator/editor cannot verify, even with MFA/grant.
 const check=await service.verifyCompetency(verify,verifierHandle);assert.equal(check.revision,6);assert.deepEqual(await service.verifyCompetency(verify,verifierHandle),check);
 await denied(()=>service.verifyCompetency({...verify,expectedRevision:6,methodId:experienceType,verificationId:randomUUID(),idempotencyKey:randomUUID()},verifierHandle));
 await denied(()=>service.verifyCompetency({...verify,expectedRevision:6,validUntil:new Date(Date.now()+7200000).toISOString(),verificationId:randomUUID(),idempotencyKey:randomUUID()},verifierHandle));
 assert.equal((await a.pool.query('SELECT verification_status FROM organization_profile.competency_assertion_version WHERE version_id=$1',[set.assertions[0].versionId])).rows[0].verification_status,'UNVERIFIED');
 assert.equal((await a.pool.query('SELECT status FROM organization_profile.competency_verification_result WHERE verification_id=$1',[verify.verificationId])).rows[0].status,'VERIFIED');
 const read={draftId:draft.draftId,linkId:link.linkId,idempotencyKey:randomUUID()};const metadata=await service.readEvidenceLink(read,handle);
 assert.deepEqual(Object.keys(metadata).sort(),['assertionVersionId','documentVersionId','experienceVersionId','linkId']);assert.deepEqual(await service.readEvidenceLink(read,handle),metadata);
 const bHandle=await boundB.captureAuthenticatedRequest(other.request);await denied(()=>boundB.service.setCompetencies(set,bHandle));
 const bDraft=create();await b.bound.service.createDraft(bDraft,other.handle);
 assert.equal((await boundB.service.setCompetencies({...set,draftId:bDraft.draftId},bHandle)).revision,2); // Same key/operation is source-local to B.
 const raceDraft=create();await a.bound.service.createDraft(raceDraft,user.handle);
 const candidates=[0,1].map(()=>({draftId:raceDraft.draftId,expectedRevision:1,assertions:[assertion()],idempotencyKey:randomUUID()}));
 const raced=await Promise.allSettled(candidates.map(command=>service.setCompetencies(command,handle)));
 assert.equal(raced.filter(row=>row.status==='fulfilled').length,1);assert.equal(raced.filter(row=>row.status==='rejected'&&row.reason.code==='F13_STALE_REVISION').length,1);
 controls.commit(true);const unknown={draftId:raceDraft.draftId,expectedRevision:2,experiences:[exp()],idempotencyKey:randomUUID()};
 const recovered=await service.setExperiences(unknown,handle);assert.deepEqual(await service.setExperiences(unknown,handle),recovered);
 assert.equal((await central.pool.query("SELECT reconciliation_result FROM public.authority_commit_guard WHERE idempotency_key=$1 AND state='RECOVERED'",[unknown.idempotencyKey])).rows[0].reconciliation_result,'COMMITTED');
 async function assurance(evidence){const sess=(await central.pool.query('SELECT sess FROM public.application_session_store WHERE sid=$1',[verifier.sid])).rows[0].sess;
  sess.auth.evidence=evidence;
  await central.coordinator.write([central.coordinator.sessionKey(verifier.sid)],()=>central.coordinator.pool.query('INSERT INTO "public"."application_session_store" (sess, expire, sid) SELECT $1, to_timestamp($2), $3 ON CONFLICT (sid) DO UPDATE SET sess=$1, expire=to_timestamp($2) RETURNING sid',[sess,sess.auth.absoluteExpiresAt/1000,verifier.sid]));}
 const fresh={authTime:Math.floor(Date.now()/1000),acr:'c4g-loa2',amr:['otp'],policyVersion:'c4g-assurance-v1'};
 for(const evidence of [{...fresh,authTime:fresh.authTime-1000},{...fresh,amr:[]}]){
  await assurance(evidence);verifierHandle=await bound.captureAuthenticatedRequest(verifier.request);
  await denied(()=>service.verifyCompetency({...verify,expectedRevision:6,verificationId:randomUUID(),idempotencyKey:randomUUID()},verifierHandle));
 }
 await assurance(fresh);verifierHandle=await bound.captureAuthenticatedRequest(verifier.request);
 const noGrant=await actor(a);await grants(a,noGrant,[]);const noGrantHandle=await bound.captureAuthenticatedRequest(noGrant.request);
 await denied(()=>service.setCompetencies({...set,idempotencyKey:randomUUID()},noGrantHandle));
 await denied(()=>service.readEvidenceLink(read,noGrantHandle));
 controls.audit(true);try{
  await denied(()=>service.setCompetencies({...set,draftId:raceDraft.draftId,expectedRevision:3,assertions:[assertion()],idempotencyKey:randomUUID()},handle));
  await denied(()=>service.setExperiences({...setExp,draftId:raceDraft.draftId,expectedRevision:3,experiences:[exp()],idempotencyKey:randomUUID()},handle));
  await denied(()=>service.attachEvidence({...link,expectedRevision:6,linkId:randomUUID(),idempotencyKey:randomUUID()},handle));
  await denied(()=>service.verifyCompetency({...verify,expectedRevision:6,verificationId:randomUUID(),idempotencyKey:randomUUID()},verifierHandle));
  await denied(()=>service.readEvidenceLink({...read,idempotencyKey:randomUUID()},handle));
 }finally{controls.audit(false);}
 // F11 metadata is locked/loaded by a closed function; neither the F13 role nor evidence permission grants document content.
 const document=randomUUID(),documentVersion=randomUUID();
 await a.pool.query("INSERT INTO document_storage.document(document_id,organization_id,resource_type,resource_id,created_by_actor_id,correlation_id) VALUES($1,$2,'EXPERIENCE_EVIDENCE',$3,$4,$5)",[document,a.org,experience.experienceId,user.id,randomUUID()]);
 await a.pool.query(`INSERT INTO document_storage.document_version(version_id,document_id,organization_id,version_number,object_id,storage_class,expected_size,expected_file_class,expected_sha256,declared_mime,display_filename,state,scan_state,idempotency_key,correlation_id,created_by_actor_id,observed_size,sha256)
  VALUES($1,$2,$3,1,$4,'DOCUMENTS',32,'PDF',$5,'application/pdf','synthetic.pdf','AVAILABLE','CLEAN',$6,$7,$8,32,$5)`,[documentVersion,document,a.org,randomUUID(),'b'.repeat(64),randomUUID(),randomUUID(),user.id]);
 const docLink={...link,expectedRevision:6,linkId:randomUUID(),documentVersionId:documentVersion,idempotencyKey:randomUUID()};
 const docUser=await actor(a);await grants(a,docUser,[{permission:'profile_evidence.attach',scope:{type:'ORGANIZATION',id:a.org,organizationId:a.org}}]);
 const docHandle=await bound.captureAuthenticatedRequest(docUser.request);await denied(()=>service.attachEvidence(docLink,docHandle));
 const linked=await service.attachEvidence(docLink,handle);assert.equal(linked.revision,7);
 const readDoc={draftId:draft.draftId,linkId:docLink.linkId,idempotencyKey:randomUUID()};
 await service.readEvidenceLink(readDoc,handle);
 await a.pool.query('UPDATE document_storage.document SET resource_id=$1 WHERE document_id=$2',[randomUUID(),document]);
 await denied(()=>service.readEvidenceLink(readDoc,handle));
 await a.pool.query('UPDATE document_storage.document SET resource_id=$1 WHERE document_id=$2',[experience.experienceId,document]);
 await a.pool.query("UPDATE document_storage.document_version SET state='QUARANTINED',scan_state='ERROR' WHERE version_id=$1",[documentVersion]);
 await denied(()=>service.readEvidenceLink(readDoc,handle));
 await a.pool.query("UPDATE document_storage.document_version SET state='AVAILABLE',scan_state='CLEAN' WHERE version_id=$1",[documentVersion]);
 const guard=(await central.pool.query('SELECT protected_operations FROM public.authority_commit_guard WHERE idempotency_key=$1',[docLink.idempotencyKey])).rows[0];
 assert.ok(guard.protected_operations.some(op=>op.operation==='DOCUMENT_READ'&&op.resourceId===document));
 const direct=await a.pool.connect();try{await direct.query('BEGIN');await direct.query('SET LOCAL ROLE c4g_organization_profile_runtime');await direct.query("SELECT set_config('app.organization_id',$1,true)",[a.org]);
  await assert.rejects(()=>direct.query('SELECT object_id FROM document_storage.document_version'),/permission denied/);
 }finally{await direct.query('ROLLBACK');direct.release();}
 await denied(()=>service.attachEvidence({...docLink,expectedRevision:7,linkId:randomUUID(),documentVersionId:randomUUID(),idempotencyKey:randomUUID()},handle));
 // Two assertions x two experiences, exact immutable version edges, no automatic verification.
 const multiDraft=create();await a.bound.service.createDraft(multiDraft,user.handle);
 const assertions=[assertion(),assertion()],experiences=[exp(),exp()];
 await service.setCompetencies({draftId:multiDraft.draftId,expectedRevision:1,assertions,idempotencyKey:randomUUID()},handle);
 await service.setExperiences({draftId:multiDraft.draftId,expectedRevision:2,experiences,idempotencyKey:randomUUID()},handle);
 let revision=3;
 for(const av of assertions)for(const ev of experiences){await service.attachEvidence({draftId:multiDraft.draftId,expectedRevision:revision++,linkId:randomUUID(),assertionVersionId:av.versionId,experienceVersionId:ev.versionId,documentVersionId:null,idempotencyKey:randomUUID()},handle);}
 assert.equal((await a.pool.query("SELECT count(*)::int n FROM organization_profile.competency_revision_member WHERE draft_id=$1 AND revision=$2 AND kind='LINK'",[multiDraft.draftId,revision])).rows[0].n,4);
 // R1-002: unrelated current verification results survive verification and re-verification.
 const verifications=[];
 for(const av of assertions){const command={...verify,draftId:multiDraft.draftId,expectedRevision:revision,
  assertionVersionId:av.versionId,verificationId:randomUUID(),idempotencyKey:randomUUID()};
  await service.verifyCompetency(command,verifierHandle);verifications.push(command.verificationId);revision++;}
 const currentVerifications=async()=> (await a.pool.query("SELECT version_id FROM organization_profile.competency_revision_member WHERE draft_id=$1 AND revision=$2 AND kind='VERIFICATION' ORDER BY version_id",[multiDraft.draftId,revision])).rows.map(row=>row.version_id);
 assert.deepEqual(await currentVerifications(),[...verifications].sort());
 const repeat={...verify,draftId:multiDraft.draftId,expectedRevision:revision,assertionVersionId:assertions[0].versionId,verificationId:randomUUID(),idempotencyKey:randomUUID()};
 await service.verifyCompetency(repeat,verifierHandle);revision++;
 assert.deepEqual(await currentVerifications(),[repeat.verificationId,verifications[1]].sort());
 await a.bound.service.submitDraft({draftId:multiDraft.draftId,expectedRevision:revision,idempotencyKey:randomUUID()},user.handle);revision++;
 assert.deepEqual(await currentVerifications(),[repeat.verificationId,verifications[1]].sort());
 assert.equal((await a.pool.query('SELECT count(*)::int n FROM organization_profile.competency_verification_result WHERE assertion_version_id=ANY($1::uuid[])',[assertions.map(row=>row.versionId)])).rows[0].n,3);
 // R1-001: independent SQL runtime checks, not repository doubles.
 const foreignRelease=randomUUID(),foreignEntry=randomUUID(),foreignType=randomUUID(),foreignMethod=randomUUID(),ownRelease=randomUUID(),ownEntry=randomUUID(),badLevel=randomUUID(),otherRelease=randomUUID(),otherLevel=randomUUID();
 for(const [rid,org,eid,kind,code] of [[foreignRelease,b.org,foreignEntry,'COMPETENCY_CONCEPT','FOREIGN'],[ownRelease,a.org,ownEntry,'COMPETENCY_CONCEPT','OWN']]){
  await a.pool.query("INSERT INTO organization_profile.competency_catalog_release(release_id,organization_id,release_version,lifecycle,semantic_digest) VALUES($1,$2,'synthetic-only','PUBLISHED',$3)",[rid,org,'c'.repeat(64)]);
  await a.pool.query('INSERT INTO organization_profile.competency_catalog_entry(entry_id,release_id,organization_id,kind,stable_code) VALUES($1,$2,$3,$4,$5)',[eid,rid,org,kind,code]);
 }
 await a.pool.query("INSERT INTO organization_profile.competency_catalog_entry(entry_id,release_id,kind,stable_code,framework_id,framework_version) VALUES($1,$2,'FRAMEWORK_LEVEL','MISMATCH',$3,'other')",[badLevel,release,randomUUID()]);
 for(const [eid,kind] of [[foreignType,'EXPERIENCE_TYPE'],[foreignMethod,'VERIFICATION_METHOD']])await a.pool.query('INSERT INTO organization_profile.competency_catalog_entry(entry_id,release_id,organization_id,kind,stable_code) VALUES($1,$2,$3,$4,$4)',[eid,foreignRelease,b.org,kind]);
 await a.pool.query("INSERT INTO organization_profile.competency_catalog_release(release_id,release_version,lifecycle,semantic_digest) VALUES($1,'synthetic-other','PUBLISHED',$2)",[otherRelease,'d'.repeat(64)]);
 await a.pool.query("INSERT INTO organization_profile.competency_catalog_entry(entry_id,release_id,kind,stable_code,framework_id,framework_version) VALUES($1,$2,'FRAMEWORK_LEVEL','OTHER_RELEASE',$3,'synthetic-v1')",[otherLevel,otherRelease,framework]);
 const beforeSql=await counts(a),sqlClient=await a.pool.connect();
 try{await sqlClient.query('BEGIN');await sqlClient.query('SET LOCAL ROLE c4g_organization_profile_runtime');await sqlClient.query("SELECT set_config('app.organization_id',$1,true)",[a.org]);
  assert.equal((await sqlClient.query('SELECT entry_id FROM organization_profile.competency_catalog_entry WHERE entry_id=$1',[foreignEntry])).rowCount,0);
  const assertionSql=`INSERT INTO organization_profile.competency_assertion_version(version_id,assertion_id,organization_id,profile_scope_id,knowledge_status,concept_id,level_id,actor_subject_id,membership_id,correlation_id)
   SELECT $1,assertion_id,organization_id,profile_scope_id,'KNOWN',$2,$3,actor_subject_id,membership_id,correlation_id FROM organization_profile.competency_assertion_version WHERE version_id=$4`;
  for(const [cid,lid] of [[foreignEntry,null],[experienceType,null],[concept,method],[concept,badLevel],[concept,otherLevel]]){
   await sqlClient.query('SAVEPOINT invalid_reference');await assert.rejects(()=>sqlClient.query(assertionSql,[randomUUID(),cid,lid,set.assertions[0].versionId]),/F13_COMPETENCY_INVALID_REFERENCE/);await sqlClient.query('ROLLBACK TO SAVEPOINT invalid_reference');
  }
  for(const [cid,lid] of [[concept,null],[concept,level],[ownEntry,null]])assert.equal((await sqlClient.query(assertionSql,[randomUUID(),cid,lid,set.assertions[0].versionId])).rowCount,1);
  for(const [table,idColumn,refColumn,source,wrong] of [['experience_evidence_version','version_id','type_id',experience.versionId,concept],['experience_evidence_version','version_id','type_id',experience.versionId,foreignType],['competency_verification_result','verification_id','method_id',verify.verificationId,experienceType],['competency_verification_result','verification_id','method_id',verify.verificationId,foreignMethod]]){
   const cols=(await a.pool.query("SELECT column_name FROM information_schema.columns WHERE table_schema='organization_profile' AND table_name=$1 ORDER BY ordinal_position",[table])).rows.map(row=>row.column_name);
   const select=cols.map(col=>col===idColumn?'$1':col===refColumn?'$2':col).join(',');
   await sqlClient.query('SAVEPOINT invalid_reference');await assert.rejects(()=>sqlClient.query(`INSERT INTO organization_profile.${table}(${cols.join(',')}) SELECT ${select} FROM organization_profile.${table} WHERE ${idColumn}=$3`,[randomUUID(),wrong,source]),/F13_COMPETENCY_INVALID_REFERENCE/);await sqlClient.query('ROLLBACK TO SAVEPOINT invalid_reference');
  }
 }finally{await sqlClient.query('ROLLBACK');sqlClient.release();}assert.deepEqual(await counts(a),beforeSql);
 // R1-003: two real commits with lost acknowledgments fail closed, then replay safely.
 for(const command of [{method:'readEvidenceLink',input:{...read,idempotencyKey:randomUUID()}},
  {method:'setExperiences',input:{...unknown,expectedRevision:3,experiences:[exp()],idempotencyKey:randomUUID()}}]){
  const before=await counts(a);controls.commit(2);
  await assert.rejects(()=>service[command.method](command.input,handle),error=>{
   assert.ok(!Object.hasOwn(error,'guard'));assert.ok(!Object.hasOwn(error,'uncertainCommit'));return true;});
  controls.commit(false);const result=await service[command.method](command.input,handle);
  assert.ok(!Object.hasOwn(result,'guard'));assert.ok(!Object.hasOwn(result,'uncertainCommit'));
  const after=await counts(a);assert.equal(after.events,before.events+1);assert.equal(after.competency_idempotency_record,before.competency_idempotency_record+1);
  assert.deepEqual(await service[command.method](command.input,handle),result);
 }
 // Replays still resolve the target and reauthorize against current grants and versions.
 await grants(a,user,[]);await denied(()=>service.setCompetencies(set,handle));await denied(()=>service.readEvidenceLink(read,handle));
 for(const table of tables.filter(table=>table.startsWith('competency_')||table==='experience_evidence_version'))for(const verb of ['UPDATE','DELETE','TRUNCATE']){
  const c=await a.pool.connect();try{await c.query('BEGIN');await c.query("SELECT set_config('app.organization_id',$1,true)",[a.org]);
   await assert.rejects(()=>c.query(verb==='UPDATE'?`UPDATE organization_profile.${table} SET organization_id=organization_id`:verb==='DELETE'?`DELETE FROM organization_profile.${table}`:`TRUNCATE organization_profile.${table} CASCADE`),/F13_AUTHORING_APPEND_ONLY/);
  }finally{await c.query('ROLLBACK');c.release();}}
 const down=createTenantMigrationRunner({pool:a.pool,entries:manifest,observationPublisher:{async publish(){}},timeoutMs:10000,scheduler:{setTimeout,clearTimeout}});
 await assert.rejects(()=>down.downgrade({tenantId:a.org,databaseGenerationId:a.gen,expectedRevision:4,correlationId:'synthetic-down',idempotencyKey:'synthetic-down',targetVersion:manifest[8].version}));
 assert.equal((await preflightTenant(a.pool,{tenantId:a.org,databaseGenerationId:a.gen},manifest,{timeoutMs:10000})).schemaFingerprint,manifest[9].schemaFingerprint);
 const events=(await a.pool.query("SELECT event_data FROM audit.event WHERE catalog_version='f13-competency-events-v1'")).rows;
 assert.equal(events.length,(await a.pool.query('SELECT count(*)::int n FROM organization_profile.competency_idempotency_record')).rows[0].n);
 for(const {event_data:event} of events){const decision=decisions.find(row=>row.result==='ALLOW'&&row.correlationId===event.correlationId&&row.operationCode===event.operationCode);assert.ok(decision);
  assert.equal(event.payload.assuranceLevel,decision.assuranceLevel);assert.equal(event.payload.policyVersion,decision.policyVersion);assert.ok(!Object.hasOwn(event.payload,'content'));}
 console.log(JSON.stringify({competency009:true,realF3F4F5F7:true,emptyCatalogFailClosed:true,syntheticCatalogOnly:true,versionedManyToMany:true,
  casConcurrent:true,idempotencyConcurrent:true,intentionConflict:true,tenantIsolation:true,authoringPreservesDomains:true,explicitVerification:true,makerChecker:true,
  missingAndStaleMfaDenied:true,f5DeniedRollback:true,fiveF7FailuresRollback:true,uncertainCommitRecovered:true,f11SeparateAuthorization:true,f11NoContentPrivilege:true,
  protectedDocumentPermission:true,appendOnly:true,canonicalDownProtectedDataDenied:true,persistedF7MatchesF5:true,
  sqlCatalogIntegrity:true,multipleVerificationsPreserved:true,doubleCommitUnknownFailClosed:true,fingerprint:manifest[9].schemaFingerprint}));
}
module.exports={runCompetencyProbes};
