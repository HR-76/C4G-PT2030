'use strict';
const assert=require('node:assert/strict');
const {randomUUID,randomBytes}=require('node:crypto');
const {createPq1UiComposition}=require('../../../backend/src/organizationalProfile/pq1UiComposition');
const {createPrequalificationComposition}=require('../../../backend/src/prequalification/composition');
const {createCriteriaComposition}=require('../../../backend/src/opportunityCriteria/composition');
async function run({databases,central,options}){
 for(const db of databases){
  const shared={...options,tenantRuntimeDependencies:db.dependencies,tokenKeys:{local:randomBytes(32).toString('hex')},tokenKeyId:'local',mfaCategory:'recent-mfa'};
  db.pq1=createPq1UiComposition(shared);db.effective=createPrequalificationComposition(shared);db.criteria=createCriteriaComposition(shared);
  const call=(method,input,id,actor=db.maker)=>db.pq1.execute(method,input,id,actor.request,randomUUID());
  const draftId=randomUUID();await call('create',{draftId,items:db.draft.items,idempotencyKey:randomUUID()});
  await call('competencies',{expectedRevision:1,assertions:[{assertionId:randomUUID(),versionId:randomUUID(),knowledgeStatus:'UNKNOWN',conceptId:null,levelId:null}],idempotencyKey:randomUUID()},draftId);
  const submitted=await call('submit',{expectedRevision:2,idempotencyKey:randomUUID()},draftId);
  const candidate=await call('candidate',{},submitted.candidateId,db.checker);
  const version=await call('approve',{concurrencyToken:candidate.actions[0].concurrencyToken,idempotencyKey:randomUUID()},submitted.candidateId,db.checker);
  const projected=await call('version',{},version.versionId,db.checker);
  await call('publish',{concurrencyToken:projected.actions[0].concurrencyToken,idempotencyKey:randomUUID()},version.versionId,db.checker);
  db.versionId=version.versionId;console.log('PQ1_SOURCE_PUBLISHED');
 }
 const [a,b]=databases,call=(db,method,input,actor=db.checker)=>db.effective.execute(method,input,actor.request);
 const activate={versionId:a.versionId,expectedActivationId:null,expectedGeneration:0,reason:'Synthetic activation',idempotencyKey:randomUUID()};
 await assert.rejects(call(a,'activate',activate,a.maker));
 await assert.rejects(call(b,'activate',activate));
 assert.equal((await a.pool.query('SELECT count(*)::int AS n FROM organization_profile.pq1_activation')).rows[0].n,0);
 const active=await call(a,'activate',activate);console.log('PQ1_ACTIVATED');assert.equal(active.generation,1);
 assert.deepEqual(await call(a,'activate',activate),active);
 await assert.rejects(call(a,'activate',{...activate,reason:'Different payload'}),{code:'IDEMPOTENCY_CONFLICT'});
 await assert.rejects(call(a,'activate',{...activate,idempotencyKey:randomUUID()}),{code:'STALE_ACTIVATION'});
 assert.equal((await call(a,'active',{})).active.activationId,active.activationId);
 assert.equal((await call(b,'active',{})).active,null);
 const c=await a.pool.connect();const opportunityId=randomUUID(),revisionId=randomUUID();
 try{await c.query('BEGIN');await c.query(`INSERT INTO opportunity_catalog.opportunity(organization_id,opportunity_id,current_revision_id,revision_number,row_version,lifecycle_state,validation_state,title,funder_name,quality_score,quality_bucket,content_digest,normalization_version,quality_rule_version)
 VALUES($1,$2,$3,1,1,'ACTIVE','VALIDATED_MANUAL','Synthetic opportunity','Synthetic funder',0,'LOW',$4,'opportunity-normalization-v1','opportunity-quality-v1')`,[a.org,opportunityId,revisionId,'a'.repeat(64)]);
 await c.query("INSERT INTO opportunity_catalog.revision(organization_id,revision_id,opportunity_id,revision_number,row_version,snapshot,normalized_projection,quality_projection,content_digest) VALUES($1,$2,$3,1,1,'{}','{}','{}',$4)",[a.org,revisionId,opportunityId,'a'.repeat(64)]);await c.query('COMMIT');}finally{await c.query('ROLLBACK');c.release();}
 const material=(await a.pool.query('SELECT pq1_content FROM organization_profile.pq1_candidate WHERE organization_id=$1 ORDER BY created_at DESC LIMIT 1',[a.org])).rows[0].pq1_content;
 const ref=material.items.find(i=>i.conceptRef).conceptRef,sourceId=randomUUID();
 const saved=await a.criteria.execute('save',opportunityId,{requestId:randomUUID(),expectedHeadRevision:0,opportunityRevisionId:revisionId,
 sources:[{sourceId,label:'Synthetic',sourceKind:'SYNTHETIC',reference:'fixture:opportunity',versionLabel:'v1',capturedText:'Theme'}],
 criteria:[{criterionId:randomUUID(),kind:'THEMATIC_AFFINITY',interpretationText:'Theme',conceptRef:{conceptId:ref.conceptId,schemeId:ref.schemeId,releaseId:ref.releaseId},temporalBasis:null,evidence:{sourceId,locator:'1',excerpt:'Theme',justification:'Synthetic'}}]},null,a.maker.request);
 await a.criteria.execute('confirm',opportunityId,{requestId:randomUUID(),expectedHeadRevision:1,opportunityRevisionId:revisionId},saved.revisionId,a.checker.request);
 const input={opportunityId,opportunityRevisionId:revisionId,criteriaRevisionId:saved.revisionId,activationId:active.activationId,generation:1,idempotencyKey:randomUUID()};
 const evaluated=await call(a,'evaluate',input);console.log('PQ1_EVALUATED');assert.equal(evaluated.globalResult,'INDETERMINATE');
 assert.deepEqual(await call(a,'evaluate',input),evaluated);
 const view=await call(a,'read',{evaluationId:evaluated.evaluationId});assert.equal(view.freshness,'CURRENT');assert.equal(view.result.lines[0].result,'AFFINITY_OBSERVED');
 await assert.rejects(call(b,'read',{evaluationId:evaluated.evaluationId}));
 const counts=async()=> (await a.pool.query("SELECT (SELECT count(*) FROM organization_profile.pq1_effective_snapshot) AS snapshots,(SELECT count(*) FROM organization_profile.pq1_activation) AS activations,(SELECT count(*) FROM organization_profile.pq1_evaluation) AS evaluations,(SELECT count(*) FROM organization_profile.pq1_effective_receipt) AS receipts,(SELECT generation FROM organization_profile.profile_active_baseline) AS generation")).rows[0];
 const beforeEffects=await counts();
 a.controls.failEffectiveAudit=true;await assert.rejects(call(a,'evaluate',{...input,idempotencyKey:randomUUID()}));a.controls.failEffectiveAudit=false;
 assert.deepEqual(await counts(),beforeEffects);
 const before=(await a.pool.query('SELECT count(*)::int AS n FROM organization_profile.pq1_effective_snapshot')).rows[0].n;
 // A late F7 failure must roll back materialization, activation, pointer and receipt.
 a.controls.failEffectiveAudit=true;await assert.rejects(call(a,'activate',{...activate,expectedActivationId:active.activationId,expectedGeneration:1,idempotencyKey:randomUUID()}));a.controls.failEffectiveAudit=false;
 assert.equal((await a.pool.query('SELECT count(*)::int AS n FROM organization_profile.pq1_effective_snapshot')).rows[0].n,before);
 assert.deepEqual(await counts(),beforeEffects);
 const replace={...activate,expectedActivationId:active.activationId,expectedGeneration:1,idempotencyKey:randomUUID()};
 a.controls.loseCommit=1;const replaced=await call(a,'activate',replace);assert.equal(replaced.generation,2);assert.deepEqual(await call(a,'activate',replace),replaced);
 assert.equal((await call(a,'read',{evaluationId:evaluated.evaluationId})).freshness,'REVIEW_REQUIRED');
 assert.equal((await a.pool.query('SELECT count(*)::int AS n FROM organization_profile.pq1_activation')).rows[0].n,2);
 // Renew synthetic MFA for both independent sessions before the timed race.
 for(const actor of [a.checker,a.submitter]){
  const sess=(await central.pool.query('SELECT sess FROM public.application_session_store WHERE sid=$1',[actor.sid])).rows[0].sess;
  sess.auth.evidence.authTime=Math.floor(Date.now()/1000);
  await central.coordinator.write([central.coordinator.sessionKey(actor.sid)],()=>central.coordinator.pool.query('INSERT INTO "public"."application_session_store" (sess, expire, sid) SELECT $1, to_timestamp($2), $3 ON CONFLICT (sid) DO UPDATE SET sess=$1, expire=to_timestamp($2) RETURNING sid',[sess,sess.auth.absoluteExpiresAt/1000,actor.sid]));
 }
 const racing={...replace,expectedActivationId:replaced.activationId,expectedGeneration:2};
 const raced=await Promise.allSettled([call(a,'activate',{...racing,idempotencyKey:randomUUID()}),call(a,'activate',{...racing,idempotencyKey:randomUUID()},a.submitter)]);
 assert.equal(raced.filter(r=>r.status==='fulfilled').length,1);
 assert.equal(raced.find(r=>r.status==='rejected').reason.code,'STALE_ACTIVATION');
 assert.equal((await call(a,'active',{})).active.generation,3);
 assert.equal((await a.pool.query('SELECT count(*)::int AS n FROM organization_profile.pq1_activation')).rows[0].n,3);
 // Runtime cannot rewrite history and downgrade is refused when occupied.
 const check=await a.pool.connect();try{await check.query('BEGIN');await check.query('SET LOCAL ROLE c4g_organization_profile_runtime');await check.query("SELECT set_config('app.organization_id',$1,true)",[a.org]);await assert.rejects(check.query('UPDATE organization_profile.pq1_effective_snapshot SET content=content'));await check.query('ROLLBACK');
 await check.query('BEGIN');await assert.rejects(check.query(require('node:fs').readFileSync(require('node:path').resolve(__dirname,'../../../backend/database/tenant/migrations/019_f13_pq1_activation.down.sql'),'utf8')),/PQ1_ACTIVATION_DOWNGRADE_REQUIRES_EMPTY_DATA/);await check.query('ROLLBACK');}finally{check.release();}
 console.log('PQ1_TRANSACTIONAL_COMPOSITION_AB: PASS (author denied, A/B, activation/evaluation, CAS including concurrent sessions, replay, activation/evaluation F7 rollback, lost commit recovery, immutable history, occupied down)');
}
module.exports={run};
