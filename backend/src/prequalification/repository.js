'use strict';
const {randomUUID,createHash}=require('node:crypto');
const {canonicalize}=require('../organizationalProfile/canonicalization');
const {digest}=require('../organizationalProfile/pq1Material');
const {tuple,limits,bounded,boundedEnvelope,fail}=require('./release');
const {materialize,assertSnapshot}=require('./materializer');
const {readPublication}=require('./publicationReader');
const {observeVerifications}=require('./admissibility');
const {validateReferences}=require('./references');
const {evaluate,freshness}=require('./evaluator');
const {createCriteriaRepository}=require('../opportunityCriteria/repository');
const {operations,validate}=require('./contracts');
const definition={tuple,limits};
function target(id,org,resourceType,authors=[]){return {id,organizationId:org,resourceType,status:'ACTIVE',scopeType:'ORGANIZATION',scopeId:null,unitId:null,ancestorUnitIds:[],teamIds:[],distinctFromActorIds:authors};}
function publicProjection(value){if(Array.isArray(value))return value.map(publicProjection);if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).filter(([k])=>!/digest/i.test(k)).map(([k,v])=>[k,publicProjection(v)]));return value;}
function createRepository({organizationId:org,actor,protect,audit,ui=null,clock=()=>new Date()}){
 if(typeof protect!=='function'||typeof audit!=='function')throw TypeError('Guard and audit required');
 async function baseline(client){return (await client.query('SELECT * FROM organization_profile.profile_active_baseline WHERE organization_id=$1 FOR UPDATE',[org])).rows[0]||null;}
 async function snapshot(client,activationId){const r=(await client.query(`SELECT a.*,s.content,s.snapshot_digest FROM organization_profile.pq1_activation a JOIN organization_profile.pq1_effective_snapshot s USING(organization_id,snapshot_id) WHERE a.organization_id=$1 AND a.activation_id=$2`,[org,activationId])).rows[0];if(!r)fail('RESOURCE_NOT_AVAILABLE');assertSnapshot(r.content,r.snapshot_digest,org);return r;}
 async function receipt(client,operation,input,resourceId,intention){
  if(operation==='PQ1_DECIDE'){const r=(await client.query('SELECT * FROM organization_profile.pq1_decision WHERE organization_id=$1 AND idempotency_key=$2',[org,input.idempotencyKey])).rows[0];
   if(!r)return null;if(r.subject_id!==actor.id||r.evaluation_id!==resourceId||r.intention_digest!==intention)fail('IDEMPOTENCY_CONFLICT');return r.result_projection;}
  const r=(await client.query('SELECT * FROM organization_profile.pq1_effective_receipt WHERE organization_id=$1 AND operation=$2 AND idempotency_key=$3',[org,operation,input.idempotencyKey])).rows[0];
  if(!r)return null;if(r.subject_id!==actor.id||r.resource_id!==resourceId||r.intention_digest!==intention)fail('IDEMPOTENCY_CONFLICT');return r.result_projection;}
 async function finish(client,operation,input,resourceId,intention,result){bounded(result);await client.query('INSERT INTO organization_profile.pq1_effective_receipt(organization_id,operation,idempotency_key,subject_id,resource_id,intention_digest,result_projection) VALUES($1,$2,$3,$4,$5,$6,$7)',[org,operation,input.idempotencyKey,actor.id,resourceId,intention,result]);return result;}
 async function criteria(client,opportunityId){
  await client.query('SET LOCAL ROLE c4g_opportunity_tenant_runtime');
  try{const repo=createCriteriaRepository({organizationId:org,actor,tokens:null,audit:null});const loaded=await repo.load(client,opportunityId,true);
   if(!loaded.set)fail('CRITERIA_UNAVAILABLE');const row=await repo.revision(client,loaded.set.head_revision_id);
   const view=await repo.run(client,{method:'get',id:opportunityId,revisionId:row.revision_id,loaded,actions:{canConfirm:false}});
   return {loaded,row,view};
  }finally{await client.query('SET LOCAL ROLE c4g_organization_profile_runtime');}
 }
 async function run(client,method,raw,reconciliation=false){
  const input=validate(method,raw);await client.query('SET LOCAL ROLE c4g_organization_profile_runtime');await client.query("SELECT set_config('app.organization_id',$1,true)",[org]);
  const tx=(await client.query("SELECT pg_advisory_xact_lock(hashtextextended('F13-P1:' || $1::text,43001301)),pg_current_xact_id()::text AS id",[org])).rows[0].id;
  if((await client.query('SHOW transaction_isolation')).rows[0].transaction_isolation!=='read committed')fail('TRANSACTION_INCOMPATIBLE');
  const release=(await client.query('SELECT definition,definition_digest FROM organization_profile.pq1_effective_release WHERE release_code=$1',[tuple.manifest])).rows[0];
  if(!release||release.definition_digest!==digest(definition)||canonicalize(release.definition)!==canonicalize(definition))fail('TUPLE_INCOMPATIBLE');
  if((await client.query('SELECT pg_current_xact_id()::text AS id')).rows[0].id!==tx)fail('TRANSACTION_REQUIRED');
  const write=['activate','evaluate','decide'].includes(method),operation=method==='activate'?'PQ1_ACTIVATE':method==='decide'?'PQ1_DECIDE':'PQ1_EVALUATE';
  const resourceId=method==='activate'?org:method==='evaluate'?input.opportunityId:['read','decide','decisions'].includes(method)?input.evaluationId:org;
  const intention=write?digest({organizationId:org,subjectId:actor.id,operation,resourceId,input}):null;
  const envelope=write?{operation,key:input.idempotencyKey,digest:intention}:{operation:'PQ1_EFFECTIVE_READ'};
  const previous=write?await receipt(client,operation,input,resourceId,intention):null;
  if(reconciliation&&write&&!previous)fail('RESULT_UNKNOWN');
  let result;
    async function dispatchActivation() {
   const published=await readPublication(client,org,input.versionId);
   const additional=await validateReferences(client,org,published.content);
   const observed=await observeVerifications(client,org,published.content,clock);
   const activeBefore=await baseline(client);
   const previewDigest=digest({versionId:input.versionId,contentDigest:published.contentDigest,activationId:activeBefore?.activation_id||null,generation:Number(activeBefore?.generation||0),verifications:observed.verifications});
   if(method==='activate'&&!previous&&ui)ui.verify(input.versionId,previewDigest);
   additional.push({operationCode:'F13_PROFILE_READ',resource:target(input.versionId,org,'PROFILE_PROJECTION')});
   if(method==='preview'){
    await protect({operationCode:operations.preview,resource:target(input.versionId,org,'PROFILE_PROJECTION'),additionalAuthorizations:additional,intention:envelope});
    const built=materialize({organizationId:org,...published,materializedAt:clock().toISOString(),admittedTuple:tuple});
    const capability=await ui.capability(target(org,org,'PROFILE_ACTIVATION_COHORT',published.authors),operations.activate,published.approvalEvidence);
    await audit(client,{operationCode:operations.preview,eventCode:'PREQUALIFICATION_ACCESSED',resourceId:input.versionId,key:randomUUID(),digest:previewDigest});
    return {versionId:input.versionId,origin:publicProjection(built.snapshot.origin),coverage:built.snapshot.coverage,readiness:'READY',verifications:observed.verifications,expectedActivationId:activeBefore?.activation_id||null,expectedGeneration:Number(activeBefore?.generation||0),capability,...ui.issue(input.versionId,previewDigest)};
   }
   await protect({operationCode:operations.activate,resource:target(org,org,'PROFILE_ACTIVATION_COHORT',published.authors),additionalAuthorizations:additional,approvalEvidence:published.approvalEvidence,intention:envelope});
   if(previous)return previous;
   if(actor.type!=='HUMAN'||published.authors.includes(actor.id))fail('SOD_DENIED');
   const active=await baseline(client);
   if((active?.activation_id||null)!==input.expectedActivationId||Number(active?.generation||0)!==input.expectedGeneration)fail('STALE_ACTIVATION');
   if(active)await snapshot(client,active.activation_id); // exact tuple/coverage: no broader replacement
   const built=materialize({organizationId:org,...published,materializedAt:clock().toISOString(),admittedTuple:tuple});
   const snapshotId=randomUUID(),activationId=randomUUID(),generation=input.expectedGeneration+1;
   await client.query('INSERT INTO organization_profile.pq1_effective_snapshot(organization_id,snapshot_id,version_id,snapshot_digest,content) VALUES($1,$2,$3,$4,$5)',[org,snapshotId,input.versionId,built.snapshotDigest,built.snapshot]);
   await client.query('INSERT INTO organization_profile.pq1_activation(organization_id,activation_id,snapshot_id,generation,predecessor_id,actor_subject_id,reason) VALUES($1,$2,$3,$4,$5,$6,$7)',[org,activationId,snapshotId,generation,input.expectedActivationId,actor.id,input.reason]);
   if(active){const updated=await client.query('UPDATE organization_profile.profile_active_baseline SET activation_id=$4,generation=$5 WHERE organization_id=$1 AND activation_id=$2 AND generation=$3',[org,input.expectedActivationId,input.expectedGeneration,activationId,generation]);if(updated.rowCount!==1)fail('STALE_ACTIVATION');}
   else await client.query('INSERT INTO organization_profile.profile_active_baseline(organization_id,activation_id,generation) VALUES($1,$2,1)',[org,activationId]);
   await audit(client,{operationCode:operations.activate,eventCode:'PROFILE_COHORT_ACTIVATED',resourceId:activationId,key:input.idempotencyKey,digest:built.snapshotDigest});
   result=await finish(client,operation,input,resourceId,intention,{activationId,snapshotId,generation,versionId:input.versionId});
  
  }
  async function dispatchEvaluation() {
   const stored=method!=='evaluate'?(await client.query('SELECT * FROM organization_profile.pq1_evaluation WHERE organization_id=$1 AND evaluation_id=$2',[org,input.evaluationId])).rows[0]:null;
   if(method!=='evaluate'&&!stored)fail('RESOURCE_NOT_AVAILABLE');
   if(stored&&digest(stored.result)!==stored.result_digest)fail();
   const opportunityId=stored?.opportunity_id||input.opportunityId,c=await criteria(client,opportunityId),active=await baseline(client);
   if(!active)fail('ACTIVATION_REQUIRED');
   const snap=await snapshot(client,stored?.activation_id||input.activationId);
   const additional=await validateReferences(client,org,snap.content.material);
   additional.push({operationCode:'F13_PROFILE_READ',resource:target(snap.content.origin.versionId,org,'PROFILE_PROJECTION')},
    {operationCode:'OPPORTUNITY_READ',resource:target(opportunityId,org,'OPPORTUNITY')},
    {operationCode:'OPPORTUNITY_CRITERIA_READ',resource:target(opportunityId,org,'OPPORTUNITY_CRITERIA_SET')});
   if(c.view.freshness==='CURRENT')await validateReferences(client,org,{items:c.row.content.criteria.map(v=>({conceptRef:v.conceptRef,domain:require('../opportunityCriteria/contracts').kinds[v.kind]})),assertions:[],verifications:[],experiences:[],links:[]});
   const observation=await observeVerifications(client,org,snap.content.material,clock);
   const identity={opportunityId,opportunityRevisionId:c.loaded.opportunity.current_revision_id,criteriaRevisionId:c.row.revision_id,
    activationId:active.activation_id,generation:Number(active.generation),snapshotId:(await snapshot(client,active.activation_id)).snapshot_id};
   async function dispatchDecision() {
    additional.push({operationCode:operations.read,resource:target(input.evaluationId,org,'PREQUALIFICATION_EVALUATION')});
    const current=freshness({result:stored.result,currentIdentity:identity,observation,referencesAvailable:c.view.freshness!=='UNAVAILABLE'});
    const head=(await client.query('SELECT decision_id,generation FROM organization_profile.pq1_decision WHERE organization_id=$1 AND evaluation_id=$2 ORDER BY generation DESC LIMIT 1',[org,input.evaluationId])).rows[0];
    const used=new Set(stored.result.lines.filter(l=>l.result==='SATISFIED').flatMap(l=>l.verificationIds));
    const deadlines=observation.verifications.filter(v=>used.has(v.verificationId)&&v.validUntil!==null).map(v=>Date.parse(v.validUntil));
    await protect({operationCode:operations[method],resource:target(input.evaluationId,org,'PREQUALIFICATION_EVALUATION'),additionalAuthorizations:additional,referenceDeadline:method==='decide'&&!previous&&deadlines.length?Math.min(...deadlines):null,intention:envelope});
    if(previous)return previous;
    if(method==='decide'){
     if(actor.type!=='HUMAN')fail('NOT_AUTHORIZED');
     if(current!=='CURRENT'||c.loaded.opportunity.lifecycle_state==='ARCHIVED')fail('EVALUATION_NOT_CURRENT');
     if(input.expectedDecisionId!==(head?.decision_id||null)||input.expectedGeneration!==Number(head?.generation||0))fail('STALE_DECISION');
     if(input.criterionIds.some(id=>!stored.result.lines.some(l=>l.criterionId===id)))fail('INVALID_INPUT');
     if(deadlines.length&&clock().getTime()>=Math.min(...deadlines))fail('EVIDENCE_EXPIRED');
     const decisionId=randomUUID(),generation=input.expectedGeneration+1;
     result={decisionId,evaluationId:input.evaluationId,generation};
     await client.query('INSERT INTO organization_profile.pq1_decision(organization_id,decision_id,evaluation_id,generation,predecessor_id,decision,reason_code,justification,criterion_ids,subject_id,idempotency_key,intention_digest,result_projection,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)',[org,decisionId,input.evaluationId,generation,input.expectedDecisionId,input.decision,input.reasonCode,input.justification,JSON.stringify(input.criterionIds),actor.id,input.idempotencyKey,intention,result,clock().toISOString()]);
     await audit(client,{operationCode:operations.decide,eventCode:'PREQUALIFICATION_DECIDED',resourceId:input.evaluationId,key:input.idempotencyKey,digest:intention});
    }else{
     const cursor=input.cursor?ui.openCursor(input.cursor,'decisions:'+input.evaluationId):null;
     if(cursor!==null&&(!Number.isSafeInteger(cursor)||cursor<1))fail('INVALID_CURSOR');
     const rows=(await client.query('SELECT decision_id,evaluation_id,generation,predecessor_id,decision,reason_code,justification,criterion_ids,subject_id,created_at FROM organization_profile.pq1_decision WHERE organization_id=$1 AND evaluation_id=$2 AND ($3::bigint IS NULL OR generation<$3) ORDER BY generation DESC LIMIT 26',[org,input.evaluationId,cursor])).rows;
     result={evaluationId:input.evaluationId,freshness:current,head:head?{decisionId:head.decision_id,generation:Number(head.generation)}:null,items:rows.slice(0,25).map(r=>({decisionId:r.decision_id,evaluationId:r.evaluation_id,generation:Number(r.generation),predecessorId:r.predecessor_id,decision:r.decision,reasonCode:r.reason_code,justification:r.justification,criterionIds:r.criterion_ids,subjectId:r.subject_id,createdAt:new Date(r.created_at).toISOString()})),nextCursor:rows.length>25?ui.cursor(Number(rows[24].generation),'decisions:'+input.evaluationId):null,canDecide:current==='CURRENT'&&(await ui.capability(target(input.evaluationId,org,'PREQUALIFICATION_EVALUATION'),operations.decide)).allowed};
    }
   
   }
   if(method==='decide'||method==='decisions'){ return dispatchDecision(); }else if(method==='read'){
    await protect({operationCode:operations.read,resource:target(input.evaluationId,org,'PREQUALIFICATION_EVALUATION'),additionalAuthorizations:additional,intention:envelope});
    const current=freshness({result:stored.result,currentIdentity:identity,observation,referencesAvailable:c.view.freshness!=='UNAVAILABLE'});
    result={evaluationId:input.evaluationId,result:stored.result,freshness:current};
   }else{
    if(!previous&&(!c.row.confirmed_at||c.view.freshness!=='CURRENT'||c.loaded.opportunity.lifecycle_state==='ARCHIVED'))fail('CRITERIA_UNAVAILABLE');
    if(!previous&&(input.opportunityRevisionId!==identity.opportunityRevisionId||input.criteriaRevisionId!==identity.criteriaRevisionId||input.activationId!==identity.activationId||input.generation!==identity.generation))fail('STALE_INPUTS');
    const computed=previous?null:evaluate({organizationId:org,snapshot:snap.content,snapshotDigest:snap.snapshot_digest,criteria:{criteria:c.row.content.criteria,sources:c.row.content.sources},observation,identity});
    await protect({operationCode:operations.evaluate,resource:target(opportunityId,org,'OPPORTUNITY'),additionalAuthorizations:additional,referenceDeadline:computed?.evidenceDeadline||null,intention:envelope});
    if(previous)return previous;
    if(computed.evidenceDeadline!==null&&clock().getTime()>=computed.evidenceDeadline)fail('EVIDENCE_EXPIRED');
    const evaluationId=randomUUID();
    await client.query('INSERT INTO organization_profile.pq1_evaluation(organization_id,evaluation_id,opportunity_id,opportunity_revision_id,criteria_revision_id,activation_id,result,result_digest,actor_subject_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',[org,evaluationId,opportunityId,identity.opportunityRevisionId,identity.criteriaRevisionId,identity.activationId,computed.result,computed.resultDigest,actor.id]);
    await audit(client,{operationCode:operations.evaluate,eventCode:'PREQUALIFICATION_EVALUATED',resourceId:evaluationId,key:input.idempotencyKey,digest:computed.resultDigest});
    result=await finish(client,operation,input,resourceId,intention,{evaluationId,globalResult:'INDETERMINATE'});
   }
  
  }
  async function dispatchListing() {
   await protect({operationCode:operations[method],resource:target(org,org,'PROFILE_PROJECTION'),intention:envelope});
   const position=input.cursor?ui.openCursor(input.cursor,method):null;
   if(position!==null&&(method==='activations'?(!Number.isSafeInteger(position)||position<1):typeof position!=='string'))fail('INVALID_CURSOR');
   const table=method==='context'?'pq1_publication':'pq1_activation',key=method==='context'?'version_id':'activation_id';
   const rows=(await client.query(method==='activations'
    ? 'SELECT * FROM organization_profile.pq1_activation WHERE organization_id=$1 AND ($2::bigint IS NULL OR generation<$2) ORDER BY generation DESC LIMIT 26'
    : `SELECT * FROM organization_profile.${table} WHERE organization_id=$1 AND ($2::uuid IS NULL OR ${key}>$2) ORDER BY ${key} LIMIT 26`,[org,position])).rows;
   const page=rows.slice(0,25);
   result={items:page.map(r=>method==='context'?{versionId:r.version_id,publishedAt:new Date(r.published_at).toISOString()}:{activationId:r.activation_id,snapshotId:r.snapshot_id,generation:Number(r.generation),predecessorId:r.predecessor_id,reason:r.reason}),nextCursor:rows.length>25?ui.cursor(method==='activations'?Number(page.at(-1).generation):page.at(-1)[key],method):null};
   if(method==='context'){result.canEvaluate=(await ui.capability(target(org,org,'OPPORTUNITY'),operations.evaluate)).allowed;const active=await baseline(client);result.active=active?{activationId:active.activation_id,generation:Number(active.generation)}:null;}
  
  }
  async function dispatchSnapshot() {
   const row=(await client.query('SELECT activation_id FROM organization_profile.pq1_activation WHERE organization_id=$1 AND snapshot_id=$2',[org,input.snapshotId])).rows[0];
   if(!row)fail('RESOURCE_NOT_AVAILABLE');
   const snap=await snapshot(client,row.activation_id),additional=await validateReferences(client,org,snap.content.material);
   additional.push({operationCode:'F13_PROFILE_READ',resource:target(snap.content.origin.versionId,org,'PROFILE_PROJECTION')});
   const observation=await observeVerifications(client,org,snap.content.material,clock);
   await protect({operationCode:operations.snapshot,resource:target(input.snapshotId,org,'PROFILE_PROJECTION'),additionalAuthorizations:additional,intention:envelope});
   const active=await baseline(client);result={snapshotId:input.snapshotId,snapshot:publicProjection(snap.content),observation,isActive:active?.activation_id===row.activation_id};
  
  }
  async function dispatchActive() {
   const active=await baseline(client);
   const snap=active?await snapshot(client,active.activation_id):null;
   const additional=snap?await validateReferences(client,org,snap.content.material):[];
   await protect({operationCode:operations.active,resource:target(org,org,'PROFILE_PROJECTION'),additionalAuthorizations:additional,intention:envelope});
   result={active:active?{activationId:active.activation_id,snapshotId:snap.snapshot_id,generation:Number(active.generation),origin:publicProjection(snap.content.origin),coverage:snap.content.coverage}:null};
  
  }
  async function dispatchOperation() {
   if (method==='activate'||method==='preview') return dispatchActivation();
   if (['evaluate','read','decide','decisions'].includes(method)) return dispatchEvaluation();
   if (['context','activations'].includes(method)) return dispatchListing();
   if (method==='snapshot') return dispatchSnapshot();
   return dispatchActive();
  }
  const earlyResult = await dispatchOperation();
  if (earlyResult !== undefined) return earlyResult;
  if((await client.query('SELECT pg_current_xact_id()::text AS id')).rows[0].id!==tx)fail('TRANSACTION_REQUIRED');
  const encoded=write?bounded(result):boundedEnvelope(result);
  if(!write)await audit(client,{operationCode:operations[method],eventCode:'PREQUALIFICATION_ACCESSED',resourceId,key:randomUUID(),digest:createHash('sha256').update(encoded,'utf8').digest('hex')});
  return result;
 }
 return {run};
}
module.exports={createRepository,target,publicProjection};
