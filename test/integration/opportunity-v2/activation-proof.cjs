'use strict';
// Only invoked by the owned disposable gate. Fixtures never use APP secrets,
// habitual databases, a real identity provider, or a live collector.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {randomUUID,createHash}=require('node:crypto');
const root=path.resolve(__dirname,'../../..');
const read=file=>fs.readFileSync(path.join(root,file),'utf8');
const sha=value=>createHash('sha256').update(value).digest('hex');
const policyVersion='c4g-user-mfa-v1';
const recentMfaRequirement={mfa:false,maxAgeSeconds:300,acceptedAcr:['c4g-loa1'],acceptedAmr:['pwd'],amrMode:'any'};
async function runtimeTransaction(pool,work){
 const client=await pool.connect();try{await client.query('BEGIN');await client.query('SET LOCAL ROLE c4g_opportunity_central_runtime');const result=await work(client);await client.query('COMMIT');return result;}catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
}
// Fixture-only authority metadata changes retain the production SQL permits and
// deferred guards. The production coordinator's baseline admission intentionally
// rejects unregistered candidate schemas; no admission pin or trigger is weakened.
async function fixtureAuthorityMutation(pool,actor,sql,values){
 const keys=['SESSION:'+sha(actor.sessionId),'SUBJECT:'+actor.id].sort(),requestId=randomUUID(),client=await pool.connect();
 try{await client.query('BEGIN');await client.query('SELECT pg_advisory_xact_lock(43001306,1)');
  assert.equal((await client.query("SELECT count(*)::int AS n FROM public.authority_commit_guard WHERE state IN ('PREPARED','TENANT_COMMIT_UNKNOWN') AND scope_keys && $1::text[]",[keys])).rows[0].n,0);
  await client.query("INSERT INTO public.authority_write_request(request_id,scope_keys,epoch,state,deadline) VALUES($1,$2,nextval('public.authority_epoch_seq'),'WAITING',clock_timestamp()+interval '30 seconds')",[requestId,keys]);
  await client.query("INSERT INTO public.authority_write_permit(transaction_id,backend_pid,scope_keys,epoch,request_id,phase) SELECT txid_current(),pg_backend_pid(),scope_keys,epoch,request_id,'REGISTER' FROM public.authority_write_request WHERE request_id=$1",[requestId]);
  await client.query('INSERT INTO public.authority_scope_epoch(scope_key,epoch) SELECT key,r.epoch FROM public.authority_write_request r CROSS JOIN unnest(r.scope_keys) AS key WHERE request_id=$1 ON CONFLICT(scope_key) DO UPDATE SET epoch=EXCLUDED.epoch',[requestId]);
  await client.query('DELETE FROM public.authority_write_permit WHERE transaction_id=txid_current()');
  await client.query("INSERT INTO public.authority_write_permit(transaction_id,backend_pid,scope_keys,epoch,request_id,phase) SELECT txid_current(),pg_backend_pid(),scope_keys,epoch,request_id,'APPLY' FROM public.authority_write_request WHERE request_id=$1",[requestId]);
  const result=await client.query(sql,values);
  await client.query("UPDATE public.authority_write_request SET state='APPLIED',finished_at=clock_timestamp() WHERE request_id=$1",[requestId]);
  await client.query('SET CONSTRAINTS ALL IMMEDIATE');await client.query('DELETE FROM public.authority_write_permit WHERE transaction_id=txid_current()');await client.query('COMMIT');return result;
 }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
}
async function seedSession(pool,{administrator=true}={}){
 const id=randomUUID(),sessionId='activation-isolated-'+randomUUID(),assignmentId=randomUUID();
 const now=Date.now(),expiry=new Date(now+3600000).toISOString();
 const session={cookie:{expires:expiry},auth:{user:{id},policyVersion,revocationVersion:1,absoluteExpiresAt:now+3600000,evidence:{authTime:Math.floor(now/1000),acr:'c4g-loa1',amr:['pwd'],policyVersion}}};
 await pool.query("INSERT INTO public.global_user(id,display_name,primary_email,status) VALUES($1,'Activation isolated fixture',$2,'ACTIVE')",[id,id+'@example.invalid']);
 if(administrator)await pool.query("INSERT INTO public.platform_admin_assignment(id,global_user_id,role_code,status) VALUES($1,$2,'C4G_ADMIN','ACTIVE')",[assignmentId,id]);
 await pool.query('INSERT INTO public.application_session_store(sid,sess,expire) VALUES($1,$2,$3)',[sessionId,session,expiry]);
 await pool.query("INSERT INTO public.application_session(sid,global_user_id,status,revocation_version,created_at,last_seen_at,expires_at) VALUES($1,$2,'ACTIVE',1,clock_timestamp(),clock_timestamp(),$3)",[sessionId,id,expiry]);
 return {id,sessionId,assignmentId,session,context:{actor:{type:'HUMAN',id},sessionId}};
}
async function stageEu(pool,actor,{observedAt='2026-10-30T22:45:39.461Z',syntheticSummary=null}={}){
 const {buildEvidence}=require('../../../backend/src/fundingTenders/sourceEvidence');
 const {adaptEuOpportunityV2}=require('../../../backend/src/fundingTenders/adapterV2');
 const {createCandidateArchiveV2}=require('../../../backend/src/fundingTenders/candidateRepositoryV2');
 const variants=JSON.parse(read('context/references/opportunity-v2/evidence/eu-11145.json')).results;
 if(syntheticSummary!==null)variants.forEach(variant=>{variant.summary=syntheticSummary;});
 const evidence=buildEvidence('CASCADE:11145',variants);
 const snapshot=adaptEuOpportunityV2(evidence,{observedAt}),runId=randomUUID();
 await pool.query("INSERT INTO opportunity_catalog.funding_run(run_id,request_id,requested_by,source_code,status,observed_at,collected,canonical_v2_required) VALUES($1,$2,$3,'EU_FUNDING_TENDERS','SUCCESS',$4,true,true)",[runId,randomUUID(),actor.id,observedAt]);
 const run=(await pool.query('SELECT * FROM opportunity_catalog.funding_run WHERE run_id=$1',[runId])).rows[0];
 const batch={outcome:'FOUND',observedAt,received:evidence.variants.length,record:{externalIdentifier:'CASCADE:11145'},evidence,canonicalSnapshot:snapshot};
 const staged=await runtimeTransaction(pool,client=>createCandidateArchiveV2().stage(client,{run,batch}));
 const verified=await runtimeTransaction(pool,client=>createCandidateArchiveV2().verify(client,{run,externalIdentifier:'CASCADE:11145'}));
 assert.deepEqual(verified.canonicalSnapshot,snapshot);assert.equal(verified.payloadDigest,staged.payloadDigest);
 return {run,runId,snapshot,verified};
}
async function stageOfficial(pool,actor,source,number){
 const {createOfficialProgrammeEvidenceV2,adaptOfficialProgrammeV2}=require('../../../backend/src/fundingTenders/officialAdapterV2');
 const {createCandidateArchiveV2}=require('../../../backend/src/fundingTenders/candidateRepositoryV2');
 const {SOURCES}=require('../../../backend/src/fundingTenders/officialSources');
 const observedAt='2026-10-30T23:45:00.000Z',externalIdentifier=source+':2021-2027:CALL:'+number;
 const bytes=file=>fs.readFileSync(path.join(root,file)).toString('base64');
 const documents=source==='INTERREG_EUROPE'?[{url:SOURCES[source].url,mediaType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',bodyBase64:bytes('backend/test/fixtures/official-programmes/interreg.xlsx')}]
  :['calendar','open'].map((name,index)=>({url:index?SOURCES[source].details:SOURCES[source].url,mediaType:'application/json',bodyBase64:bytes('backend/test/fixtures/official-programmes/v2/'+name+'.json')}));
 const sourceEvidence=createOfficialProgrammeEvidenceV2({source,observedAt,documents}),snapshot=adaptOfficialProgrammeV2({sourceEvidence,externalIdentifier}),runId=randomUUID();
 await pool.query("INSERT INTO opportunity_catalog.funding_run(run_id,request_id,requested_by,source_code,status,observed_at,collected,canonical_v2_required) VALUES($1,$2,$3,$4,'SUCCESS',$5,true,true)",[runId,randomUUID(),actor.id,source,observedAt]);
 const run=(await pool.query('SELECT * FROM opportunity_catalog.funding_run WHERE run_id=$1',[runId])).rows[0];
 const evidence={kind:'OFFICIAL_PROGRAMME',externalIdentifier,fingerprint:sourceEvidence.fingerprint,sourceEvidence};
 await runtimeTransaction(pool,client=>createCandidateArchiveV2().stage(client,{run,batch:{outcome:'FOUND',observedAt,received:documents.length,record:{externalIdentifier},evidence,canonicalSnapshot:snapshot}}));
 return {archive:{kind:'FUNDING',runId,externalIdentifier},snapshot};
}
async function counts(pool){return (await pool.query(`SELECT
 (SELECT count(*) FROM opportunity_catalog.opportunity)::int AS opportunities,
 (SELECT count(*) FROM opportunity_catalog.revision)::int AS revisions,
 (SELECT count(*) FROM opportunity_catalog.source_observation_v2)::int AS observations,
 (SELECT count(*) FROM opportunity_catalog.accepted_receipt_v2)::int AS receipts,
 (SELECT count(*) FROM audit.event)::int AS audits`)).rows[0];}

async function seedLegacy(pool,run){
 const opportunityId=randomUUID(),revisionId=randomUUID(),snapshot={schemaVersion:1,title:'Historical EU fixture',funderName:'Historical funder',provenanceId:randomUUID(),lifecycleState:'ACTIVE',validationState:'PENDING_REVIEW',normalizationVersion:'opportunity-normalization-v1',qualityRuleVersion:'opportunity-quality-v1'};
 const client=await pool.connect();try{await client.query('BEGIN');
  await client.query("INSERT INTO opportunity_catalog.opportunity(opportunity_id,current_revision_id,revision_number,row_version,lifecycle_state,validation_state,title,funder_name,quality_score,quality_bucket,content_digest,normalization_version,quality_rule_version) VALUES($1,$2,1,1,'ACTIVE','PENDING_REVIEW',$3,$4,0,'LOW',$5,'opportunity-normalization-v1','opportunity-quality-v1')",[opportunityId,revisionId,snapshot.title,snapshot.funderName,'a'.repeat(64)]);
  await client.query("INSERT INTO opportunity_catalog.revision(revision_id,opportunity_id,revision_number,row_version,snapshot,normalized_projection,quality_projection,content_digest) VALUES($1,$2,1,1,$3,'{}','{}',$4)",[revisionId,opportunityId,snapshot,'a'.repeat(64)]);
  await client.query("INSERT INTO opportunity_catalog.funding_identity(external_identifier,opportunity_id,last_source_fields,observed_at,last_run_id) VALUES('CASCADE:11145',$1,$2,$3,$4)",[opportunityId,snapshot,run.observed_at,run.run_id]);
  await client.query('COMMIT');
 }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
 return {opportunityId,revisionId,rowVersion:1,snapshot};
}
const expected=value=>({opportunityId:value.opportunityId,revisionId:value.revisionId,rowVersion:value.rowVersion});
const codeMatches=error=>typeof error?.code==='string'&&/^(OPPORTUNITY_|FUNDING_)/.test(error.code);
async function activationProof({pool,tenantPool,check,report}){
 const sqlFiles=['funding_canonical_v2.up.sql','manual_opportunity_v2.up.sql','pt2030_plan_v2.up.sql','opportunity_persistence_v2.up.sql','opportunity_activation_authority_v2.up.sql','opportunity_activation_approval_v2.up.sql'];
 const centralSchema=require('../../../backend/src/security/centralSchemaManifest'),authoritySecurity=require('../../../backend/src/security/authoritySecurityManifest'),catalogSecurity=require('../../../backend/src/security/catalogSecurityManifest');
 const fingerprints=async()=>({schema:centralSchema.schemaFingerprint(await centralSchema.centralSchemaSnapshot(pool)),authority:authoritySecurity.digest(await authoritySecurity.authoritySecuritySnapshot(pool)),catalog:catalogSecurity.digest(await catalogSecurity.catalogSecuritySnapshot(pool))});
 const auditPredicates=async()=>Object.fromEntries((await pool.query("SELECT c.conname,pg_get_expr(c.conbin,c.conrelid) AS predicate FROM pg_constraint c WHERE c.conrelid IN ('audit.event'::regclass,'audit.event_identity'::regclass) AND c.conname IN ('event_event_code_check','event_identity_event_code_check') AND c.convalidated ORDER BY c.conname")).rows.map(row=>[row.conname,row.predicate]));
 const originalAuditPredicates=await auditPredicates();
 await check('ACTIVATION_CANDIDATE_SQL_ONLY_IN_DISPOSABLE_DATABASE',async()=>{
  report.activationBaselineFingerprints=await fingerprints();report.activationSql=[];
  for(const name of sqlFiles){const file='backend/database/central/candidates/'+name,sql=read(file);await pool.query(sql);report.activationSql.push({file,sha256:sha(sql),fingerprints:await fingerprints(),registered:false});}
 });
 await check('ACTIVATION_AUDIT_ALLOWLIST_IS_STRICTLY_ADDITIVE',async()=>{
  const current=await auditPredicates(),catalog=require('../../../backend/src/audit/eventCatalog').EVENTS;
  const codes=[...new Set((Array.isArray(catalog)?catalog:Object.values(catalog)).map(value=>value.code).filter(Boolean)),'UNKNOWN_ISOLATED_EVENT'];
  const added=['OPPORTUNITY_IMPORT_UPLOADED','OPPORTUNITY_IMPORT_CONFIRMED','OPPORTUNITY_IMPORT_CANCELLED'];
  for(const code of added)if(!codes.includes(code))codes.push(code);
  assert(codes.length>100);assert.equal(Object.keys(current).length,2);
  for(const name of Object.keys(current)){
   const rows=(await pool.query(`SELECT event_code,(${originalAuditPredicates[name]}) AS before,(${current[name]}) AS after FROM unnest($1::text[]) q(event_code)`,[codes])).rows;
   for(const row of rows)assert.equal(row.after,row.before||added.includes(row.event_code),name+':'+row.event_code);
   assert.equal(rows.find(row=>row.event_code==='UNKNOWN_ISOLATED_EVENT').after,false);
  }
  report.auditAllowlist={constraints:2,codesCompared:codes.length,added,preserved:true,unknownRejected:true};
 });
 const {createActivationAuthorityV2}=require('../../../backend/src/opportunities/v2/activationAuthority');
 const authority=createActivationAuthorityV2({policyVersion,recentMfaRequirement});
 const actor=await seedSession(pool),outsider=await seedSession(pool,{administrator:false});
 await check('ACTIVATION_PERSISTED_ADMIN_SESSION_ASSURANCE_AND_MINIMAL_PRIVILEGES',async()=>{
  assert.equal(await runtimeTransaction(pool,c=>authority.authorize(c,actor.context)),true);
  for(const context of [outsider.context,{...actor.context,actor:{type:'HUMAN',id:outsider.id}},{actor:{type:'SERVICE',id:'funding_worker'}},{...actor.context,sessionId:'absent-isolated-session'}]){
   const allowed=await runtimeTransaction(pool,c=>authority.authorize(c,context)).catch(()=>false);assert.equal(allowed,false);
  }
  for(const table of ['public.global_user','public.application_session','public.application_session_store','public.platform_admin_assignment'])await assert.rejects(runtimeTransaction(pool,c=>c.query('SELECT * FROM '+table)),{code:'42501'});
  const stale=structuredClone(actor.session);stale.auth.evidence.authTime-=3600;
  await fixtureAuthorityMutation(pool,actor,'UPDATE public.application_session_store SET sess=$1 WHERE sid=$2',[stale,actor.sessionId]);
  assert.equal(await runtimeTransaction(pool,c=>authority.authorize(c,actor.context)).catch(()=>false),false);
  await fixtureAuthorityMutation(pool,actor,'UPDATE public.application_session_store SET sess=$1 WHERE sid=$2',[actor.session,actor.sessionId]);
  await fixtureAuthorityMutation(pool,actor,"UPDATE public.application_session SET status='REVOKED',revoked_at=clock_timestamp() WHERE sid=$1",[actor.sessionId]);
  assert.equal(await runtimeTransaction(pool,c=>authority.authorize(c,actor.context)).catch(()=>false),false);
  await fixtureAuthorityMutation(pool,actor,"UPDATE public.application_session SET status='ACTIVE',revoked_at=NULL WHERE sid=$1",[actor.sessionId]);
  await fixtureAuthorityMutation(pool,actor,"UPDATE public.global_user SET status='SUSPENDED' WHERE id=$1",[actor.id]);
  assert.equal(await runtimeTransaction(pool,c=>authority.authorize(c,actor.context)).catch(()=>false),false);
  await fixtureAuthorityMutation(pool,actor,"UPDATE public.global_user SET status='ACTIVE' WHERE id=$1",[actor.id]);
 });
 await check('ACTIVATION_AUTHORITY_LOCK_SERIALIZES_REVOCATION',async()=>{
  const holder=await pool.connect(),revoker=await pool.connect();try{
   await holder.query('BEGIN');await holder.query('SET LOCAL ROLE c4g_opportunity_central_runtime');assert.equal(await authority.authorize(holder,actor.context),true);
   await revoker.query('BEGIN');await revoker.query("SET LOCAL lock_timeout='150ms'");
   await assert.rejects(revoker.query("UPDATE public.platform_admin_assignment SET status='REVOKED' WHERE id=$1",[actor.assignmentId]),{code:'55P03'});await revoker.query('ROLLBACK');
   await holder.query('COMMIT');
   await pool.query("UPDATE public.platform_admin_assignment SET status='REVOKED' WHERE id=$1",[actor.assignmentId]);
   assert.equal(await runtimeTransaction(pool,c=>authority.authorize(c,actor.context)).catch(()=>false),false);
   await pool.query("UPDATE public.platform_admin_assignment SET status='ACTIVE' WHERE id=$1",[actor.assignmentId]);
  }finally{await holder.query('ROLLBACK').catch(()=>{});await revoker.query('ROLLBACK').catch(()=>{});holder.release();revoker.release();}
 });
 const {createOpportunityActivationV2}=require('../../../backend/src/opportunities/v2/activationComposition');
 const diagnosticPool={async connect(){const client=await pool.connect();return {release:()=>client.release(),async query(sql,values){try{return await client.query(sql,values);}catch(error){report.isolatedDatabaseDiagnostic={code:error.code,message:String(error.message).slice(0,400),statement:typeof sql==='string'?sql.slice(0,90):'QUERY'};throw error;}}};}};
 const composition=createOpportunityActivationV2({pool:diagnosticPool,policyVersion,recentMfaRequirement});
 const archived=await stageEu(pool,actor),legacy=await seedLegacy(pool,archived.run);
 const archive={kind:'FUNDING',runId:archived.runId,externalIdentifier:'CASCADE:11145'};
 const prepare=prior=>composition.prepare({requestId:randomUUID(),archive,expected:prior?expected(prior):null},actor.context);
 const approve=plan=>composition.approve({requestId:randomUUID(),planId:plan.planId,planDigest:plan.planDigest},actor.context);
 let plan,approved,accepted,acceptCommand;
 await check('ACTIVATION_VERIFIED_ARCHIVE_PREVIEW_AND_DURABLE_APPROVAL',async()=>{
  plan=await prepare(legacy);assert.equal(plan.state,'DRAFT');assert.match(plan.planDigest,/^[a-f0-9]{64}$/);
  assert.equal(plan.preview.items[0].action,'CHANGE_REQUIRES_APPROVAL');
  await assert.rejects(composition.accept({requestId:randomUUID(),planId:plan.planId,fence:plan.fence},actor.context),codeMatches);
  await assert.rejects(composition.approve({requestId:randomUUID(),planId:plan.planId,planDigest:'0'.repeat(64)},actor.context),{code:'OPPORTUNITY_V2_APPROVAL_STALE'});
  const decision={requestId:randomUUID(),planId:plan.planId,planDigest:plan.planDigest},before=await counts(pool);
  const concurrent=await Promise.all([composition.approve(decision,actor.context),composition.approve(decision,actor.context)]);
  assert.equal(concurrent.filter(value=>value.replayed).length,1);assert.equal((await counts(pool)).audits,before.audits+1);
  approved=concurrent[0];assert.equal(approved.state,'APPROVED');assert(approved.fence>plan.fence);
 });
 await check('ACTIVATION_ACCEPT_EU_11145_WITH_TRANSACTIONAL_PLATFORM_AUDIT',async()=>{
  acceptCommand={requestId:randomUUID(),planId:plan.planId,fence:approved.fence};accepted=await composition.accept(acceptCommand,actor.context);
  assert.equal(accepted.opportunityId,legacy.opportunityId);assert.notEqual(accepted.revisionId,legacy.revisionId);
  assert.deepEqual((await pool.query('SELECT snapshot FROM opportunity_catalog.revision WHERE revision_id=$1',[accepted.revisionId])).rows[0].snapshot,archived.snapshot);
  assert.deepEqual((await pool.query('SELECT amount_canonical,currency_state,currency_code FROM opportunity_catalog.revision_allocation_v2 WHERE revision_id=$1',[accepted.revisionId])).rows,[{amount_canonical:'120000',currency_state:'NOT_FOUND',currency_code:null}]);
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM opportunity_catalog.revision_deadline_v2 WHERE revision_id=$1',[accepted.revisionId])).rows[0].n,7);
  const before=await counts(pool);assert.deepEqual(await composition.accept(acceptCommand,actor.context),accepted);assert.deepEqual(await counts(pool),before);
  assert(before.audits>=2,'Approval and acceptance must be audited');
 });
 await check('ACTIVATION_OFFICIAL_AND_MANUAL_ARCHIVES_WITH_SOURCE_BLOCKS',async()=>{
  for(const [source,number]of [['INTERREG_EUROPE',1],['POCTEP',1],['POCTEP',10]]){
   const stored=await stageOfficial(pool,actor,source,number),proposal=await composition.prepare({requestId:randomUUID(),archive:stored.archive,expected:null},actor.context);
   if(source==='POCTEP'&&number===10){assert.equal(proposal.preview.items[0].action,'BLOCKED');await assert.rejects(approve(proposal),{code:'OPPORTUNITY_V2_RECONCILIATION_BLOCKED'});}
   else{const ready=await approve(proposal),result=await composition.accept({requestId:randomUUID(),planId:proposal.planId,fence:ready.fence},actor.context);assert.deepEqual((await pool.query('SELECT snapshot FROM opportunity_catalog.revision WHERE revision_id=$1',[result.revisionId])).rows[0].snapshot,stored.snapshot);}
  }
  const manual=require('../../../backend/src/opportunities/manualV2'),requestId=randomUUID(),editorialId=manual.manualEditorialId(actor.id,requestId),observedAt=new Date().toISOString();
  const bundle=manual.adaptManualOpportunityV2({kind:'CALL',fields:{'/description/title':{state:'PRESENT',value:'Isolated operational manual candidate',reason:null}}},{editorialId,observedAt});
  const writer=require('../../../backend/src/opportunities/manualV2Archive').createManualCandidateArchiveV2({audit:require('../../../backend/src/fundingTenders/audit').createPlatformAudit({source:'API'})});
  const staged=await runtimeTransaction(pool,async client=>{await authority.assertAdministrator(client,actor.context);return writer.stage(client,{userId:actor.id,requestId,editorialId,observedAt,...bundle});});
  const proposal=await composition.prepare({requestId:randomUUID(),archive:{kind:'MANUAL',candidateId:staged.candidateId},expected:null},actor.context),ready=await approve(proposal);
  const result=await composition.accept({requestId:randomUUID(),planId:proposal.planId,fence:ready.fence},actor.context);
  assert.deepEqual((await pool.query('SELECT snapshot FROM opportunity_catalog.revision WHERE revision_id=$1',[result.revisionId])).rows[0].snapshot,bundle.snapshot);
  await assert.rejects(composition.prepare({requestId:randomUUID(),archive:{kind:'PORTUGAL2030_PLAN'},expected:null},actor.context),{code:'OPPORTUNITY_V2_DOCUMENT_PIPELINE_REQUIRED'});
 });
 await check('ACTIVATION_APPROVAL_FENCE_REVOCATION_AND_ACTOR_REVALIDATION',async()=>{
  const next=await prepare(accepted),ready=await approve(next);
  const command={requestId:randomUUID(),planId:next.planId,fence:ready.fence};
  await assert.rejects(composition.accept({...command,fence:next.fence},actor.context),codeMatches);
  await fixtureAuthorityMutation(pool,actor,'UPDATE public.global_user SET session_revocation_version=session_revocation_version+1 WHERE id=$1',[actor.id]);
  await assert.rejects(composition.accept(command,actor.context),codeMatches);
  await fixtureAuthorityMutation(pool,actor,'UPDATE public.global_user SET session_revocation_version=1 WHERE id=$1',[actor.id]);
  const revoked=await composition.revoke({requestId:randomUUID(),planId:next.planId,planDigest:next.planDigest},actor.context);assert.equal(revoked.state,'REVOKED');
  const before=await counts(pool);await assert.rejects(composition.accept(command,actor.context),codeMatches);assert.deepEqual(await counts(pool),before);
 });
 await check('ACTIVATION_RECEIPT_IS_BOUND_TO_ITS_APPROVED_PLAN',async()=>{
  const left=await prepare(accepted),right=await prepare(accepted),a=await approve(left),b=await approve(right),requestId=randomUUID();
  const result=await composition.accept({requestId,planId:left.planId,fence:a.fence},actor.context);assert.equal(result.action,'UNCHANGED');
  const before=await counts(pool);
  await assert.rejects(composition.accept({requestId,planId:right.planId,fence:b.fence},actor.context),{code:'OPPORTUNITY_V2_IDEMPOTENCY_CONFLICT'});
  assert.deepEqual(await counts(pool),before);
 });
 await check('ACTIVATION_AUDIT_DATABASE_FAILURE_ROLLS_BACK_ACCEPTANCE',async()=>{
  const next=await prepare(accepted),ready=await approve(next),before=await counts(pool);
  await pool.query("CREATE SCHEMA activation_evidence;REVOKE ALL ON SCHEMA activation_evidence FROM PUBLIC;CREATE FUNCTION activation_evidence.reject_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'ISOLATED_AUDIT_FAILURE'; END $$;CREATE TRIGGER activation_reject_audit BEFORE INSERT ON audit.event FOR EACH ROW EXECUTE FUNCTION activation_evidence.reject_audit()");
  try{await assert.rejects(composition.accept({requestId:randomUUID(),planId:next.planId,fence:ready.fence},actor.context),{code:'OPPORTUNITY_V2_PERSISTENCE_UNAVAILABLE'});assert.equal(report.isolatedDatabaseDiagnostic?.message,'ISOLATED_AUDIT_FAILURE');assert.deepEqual(await counts(pool),before);report.expectedAuditFailure=report.isolatedDatabaseDiagnostic;delete report.isolatedDatabaseDiagnostic;}finally{await pool.query('DROP TRIGGER activation_reject_audit ON audit.event');}
 });
 await check('ACTIVATION_REAL_HISTORICAL_RESOLUTION_BLOCKS_REPLACEMENT',async()=>{
  const resolutionId=randomUUID();
  await pool.query('INSERT INTO opportunity_catalog.funding_resolution(resolution_id,request_id,batch_digest,command_digest,decision_digest,external_identifier,opportunity_id,previous_revision_id,applied_revision_id,source_fingerprint,evidence,decision,decided_by,decided_at) VALUES($1,$2,$3,$3,$3,$4,$5,$6,$7,$3,$8,$9,$10,clock_timestamp())',[resolutionId,randomUUID(),'b'.repeat(64),'CASCADE:11145',accepted.opportunityId,legacy.revisionId,accepted.revisionId,{isolated:true},{action:'KEEP_ACCEPTED'},actor.id]);
  const changed=await stageEu(pool,actor,{observedAt:'2026-10-31T00:00:00.000Z',syntheticSummary:'Synthetic changed source summary used only to test protection of the historical decision.'});
  const before=await counts(pool);
  const blocked=await composition.prepare({requestId:randomUUID(),archive:{kind:'FUNDING',runId:changed.runId,externalIdentifier:'CASCADE:11145'},expected:expected(accepted)},actor.context);
  assert.equal(blocked.preview.items[0].action,'BLOCKED');assert(blocked.preview.items[0].reasonCodes.includes('SOURCE_RESOLUTION_REQUIRES_REVIEW'));
  await assert.rejects(approve(blocked),{code:'OPPORTUNITY_V2_RECONCILIATION_BLOCKED'});
  const after=await counts(pool);assert.deepEqual({...after,audits:before.audits},before);assert.equal(after.audits,before.audits+1);
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM opportunity_catalog.funding_resolution WHERE resolution_id=$1',[resolutionId])).rows[0].n,1);
  assert.deepEqual((await pool.query('SELECT snapshot FROM opportunity_catalog.revision WHERE revision_id=$1',[legacy.revisionId])).rows[0].snapshot,legacy.snapshot);
 });
 await check('ACTIVATION_AUDIT_CHAIN_INTEGRITY_AND_CANDIDATE_FINGERPRINTS',async()=>{
  const rows=(await pool.query("SELECT event_data,event_hash FROM audit.event WHERE organization_id IS NULL AND stream_id='PLATFORM:DATA' ORDER BY sequence")).rows;
  const events=rows.map(row=>({...row.event_data,eventHash:row.event_hash}));assert(events.length>=4);
  assert.equal(require('../../../backend/src/audit/verifier').verifyEvents(events).valid,true);
  assert(!JSON.stringify(events).includes(actor.sessionId));assert(!JSON.stringify(events).includes('@example.invalid'));
  const central=require('../../../backend/src/security/centralSchemaManifest'),tenant=require('../../../backend/src/security/tenantSchemaFingerprint');
  report.activationFingerprints={central:central.schemaFingerprint(await central.centralSchemaSnapshot(pool)),tenant:tenant.tenantSchemaFingerprint(await tenant.tenantSchemaSnapshot(tenantPool)),registered:false};
  report.activation={authority:'Persisted administrator/session/assurance and SQL locks; optional MFA policy, fixture session, no identity-provider login',authorityMutations:'Fixture-only REGISTER/APPLY/APPLIED permits with existing guards; production coordinator admission is not bypassed or certified',approval:'Durable per-source plan, exact archive/preview/mapping and fence',auditEvents:events.length,auditChainValid:true,euAmount:'120000',euCurrencyState:'NOT_FOUND',euCutoffs:7,legacyUuidPreserved:true,historicalResolutionPreserved:true,habitualActivation:false};
 });
}
module.exports={activationProof,seedSession,stageEu,runtimeTransaction,counts,policyVersion,recentMfaRequirement,fixtureAuthorityMutation,seedLegacy};
