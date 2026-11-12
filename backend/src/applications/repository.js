'use strict';
const {randomUUID,createHash}=require('node:crypto');
const {canonicalize}=require('../organizationalProfile/canonicalization');
const {NEXT,BASIC_NEXT,OPTIONAL_FIELDS,fail,uuid,currentStatus}=require('./contracts');
const interestLink=require('./interestLink');
const {describeFrozenOpportunity,centralLifecycle,assertApplicationSnapshotFits}=require('./opportunitySnapshot');
function digest(value){return createHash('sha256').update(canonicalize(value)).digest('hex')}
// pg parses DATE at local midnight; converting it to UTC can change the civil day.
function day(value){return value instanceof Date?`${value.getFullYear()}-${String(value.getMonth()+1).padStart(2,'0')}-${String(value.getDate()).padStart(2,'0')}`:value}
function project(row){return {applicationId:row.application_id,opportunityId:row.opportunity_id||row.central_opportunity_id,origin:row.central_opportunity_id?'CENTRAL':'PRIVATE',centralRevisionId:row.central_revision_id||null,evaluationId:row.evaluation_id,
 title:row.title,responsibleMembershipId:row.responsible_membership_id,deadline:day(row.deadline),
 notes:row.notes??null,totalBudget:row.total_budget===undefined||row.total_budget===null?null:String(row.total_budget),organizationBudget:row.organization_budget===undefined||row.organization_budget===null?null:String(row.organization_budget),
 statusChangedAt:row.status_changed_at?new Date(row.status_changed_at).toISOString():null,lastSubmittedAt:row.last_submitted_at?new Date(row.last_submitted_at).toISOString():null,
  ...(Object.hasOwn(row,'source_interest_id')?{sourceInterestId:row.source_interest_id,sourceInterestRevision:row.source_interest_revision===null?null:Number(row.source_interest_revision)}:{}),
  ...(Object.hasOwn(row,'unit_ids')&&Object.hasOwn(row,'units')?{unitIds:row.unit_ids,units:row.units}:{}),
 lifecycleExtended:Object.hasOwn(row,'notes'),status:currentStatus(row.status),revision:Number(row.revision),createdAt:new Date(row.created_at).toISOString(),updatedAt:new Date(row.updated_at).toISOString()}}
function resource(id,org,type='APPLICATION'){return {id,organizationId:org,resourceType:type,status:'ACTIVE',scopeType:id===org?'ORGANIZATION':'RESOURCE',scopeId:id,
 distinctFromActorIds:[],unitId:null,teamIds:[],ancestorUnitIds:[]}}
function createApplicationRepository({organizationId,organizationName,actor,protect,authorize,verifyResponsible,cursor,audit,centralOrigin=null,centralCurrent=null,notify=async()=>{},recordStatusEmail=async()=>{},responsibleNames=async()=>new Map(),reportDirectory=async()=>null,readAuthority,responsibleDirectory,creatorJoinsTeam=async()=>false,transitionCapability,taskDetailsAvailable=false,canReadStrategyAlignment}){
 const org=organizationId;
 async function existing(client,id,lock=false){return (await client.query(`SELECT a.*,(SELECT recorded_at FROM opportunity_catalog.application_change h WHERE h.organization_id=a.organization_id AND h.application_id=a.application_id AND h.kind IN ('CREATE','TRANSITION') ORDER BY h.revision DESC LIMIT 1) AS status_changed_at,(SELECT recorded_at FROM opportunity_catalog.application_change h WHERE h.organization_id=a.organization_id AND h.application_id=a.application_id AND h.kind='TRANSITION' AND h.to_status='SUBMITTED' ORDER BY h.revision DESC LIMIT 1) AS last_submitted_at FROM opportunity_catalog.application a WHERE organization_id=$1 AND application_id=$2${lock?' FOR UPDATE':''}`,[org,id])).rows[0]||null}
 async function origin(client,id){const row=(await client.query('SELECT opportunity_id,title,closing_date::text AS closing_date,lifecycle_state FROM opportunity_catalog.opportunity WHERE organization_id=$1 AND opportunity_id=$2',[org,id])).rows[0];if(!row)fail('RESOURCE_NOT_AVAILABLE');return row}
 async function evaluation(client,id,opportunityId){if(id===null)return;const row=(await client.query('SELECT evaluation_id FROM organization_profile.pq1_evaluation WHERE organization_id=$1 AND evaluation_id=$2 AND opportunity_id=$3',[org,id,opportunityId])).rows[0];if(!row)fail('RESOURCE_NOT_AVAILABLE')}
 function sourceRead(opportunityId,evaluationId=null){return [{operationCode:'OPPORTUNITY_READ',resource:resource(opportunityId||org,org,'OPPORTUNITY')},...(evaluationId?[{operationCode:'F14_PREQUALIFICATION_READ',resource:resource(evaluationId,org,'PREQUALIFICATION_EVALUATION')}]:[])]}
 async function guarded(client,operation,id,extra=[],intention=null){return protect({operationCode:operation,resource:resource(id,org),additionalAuthorizations:extra,intention})}
 async function receipt(client,input,operation,resourceId){const previous=(await client.query('SELECT * FROM opportunity_catalog.application_receipt WHERE organization_id=$1 AND idempotency_key=$2',[org,input.idempotencyKey])).rows[0];
  const intentionDigest=digest({operation,resourceId,input,organizationId:org,subjectId:actor.id});
  if(previous){if(previous.operation!==operation||previous.subject_id!==actor.id||previous.resource_id!==resourceId||previous.intention_digest!==intentionDigest)fail('IDEMPOTENCY_CONFLICT');return {previous:previous.result_projection,intentionDigest}}
  return {previous:null,intentionDigest};
 }
 async function finish(client,input,operation,resourceId,intentionDigest,result){await client.query('INSERT INTO opportunity_catalog.application_receipt(organization_id,idempotency_key,operation,subject_id,resource_id,intention_digest,result_projection) VALUES($1,$2,$3,$4,$5,$6,$7)',[org,input.idempotencyKey,operation,actor.id,resourceId,intentionDigest,result]);return result}
 async function create(client,input){
  await guarded(client,'APPLICATION_CREATE',org,[...sourceRead(input.origin==='CENTRAL'?null:input.opportunityId,input.evaluationId),...(input.sourceInterestId?['READ','MANAGE'].map(action=>({operationCode:'OPPORTUNITY_INTEREST_'+action,resource:resource(input.sourceInterestId,org,'OPPORTUNITY_INTEREST')})):[]),...(input.includeResponsibleInTeam?[{operationCode:'APPLICATION_WORK_EDIT',resource:resource(org,org)}]:[])],{operation:'APPLICATION_CREATE',key:input.idempotencyKey,
   digest:digest({operation:'CREATE',resourceId:input.opportunityId,input,organizationId:org,subjectId:actor.id})});
  const prior=await receipt(client,input,'CREATE',input.opportunityId);if(prior.previous)return prior.previous;
  const publicSnapshot=input.origin==='CENTRAL'?(centralOrigin?await centralOrigin(input.opportunityId,input.centralRevisionId):fail('RESOURCE_NOT_AVAILABLE')):null;
  const current=publicSnapshot?.schemaVersion===2?(centralCurrent?await centralCurrent(input.opportunityId):fail('RESOURCE_NOT_AVAILABLE')):null;
  if(publicSnapshot?.schemaVersion===2){
   if(current?.opportunityId!==input.opportunityId)fail('RESOURCE_NOT_AVAILABLE');
   if(current.revisionId!==input.centralRevisionId)fail('STALE_OPPORTUNITY_REVISION');
  }
  const opp=publicSnapshot?{title:describeFrozenOpportunity(publicSnapshot,{revisionId:input.centralRevisionId}).title,lifecycle_state:centralLifecycle(publicSnapshot,current)}:await origin(client,input.opportunityId);if(opp.lifecycle_state==='ARCHIVED')fail('RESOURCE_NOT_AVAILABLE');
  await evaluation(client,input.evaluationId,input.opportunityId);
  if(!await verifyResponsible(input.responsibleMembershipId))fail('RESPONSIBLE_UNAVAILABLE');
  const schema=(await client.query("SELECT EXISTS (SELECT 1 FROM pg_catalog.pg_attribute WHERE attrelid='opportunity_catalog.application'::regclass AND attname='notes' AND NOT attisdropped) AS extended, EXISTS (SELECT 1 FROM pg_catalog.pg_attribute WHERE attrelid='opportunity_catalog.application'::regclass AND attname='source_interest_id' AND NOT attisdropped) AS interest_units, EXISTS (SELECT 1 FROM pg_catalog.pg_constraint WHERE conrelid='opportunity_catalog.application'::regclass AND conname='application_v2_snapshot_capacity' AND contype='c' AND convalidated) AS v2_snapshot")).rows[0];
  if(publicSnapshot)assertApplicationSnapshotFits(publicSnapshot,{v2:schema.v2_snapshot===true});
  const extended=schema.extended,interestUnits=schema.interest_units===true;
  if(interestLink.requested(input)&&!interestUnits)fail('SCHEMA_UPGRADE_REQUIRED');
  const segmentation=interestUnits?(await interestLink.prepare(client,org,input,{centralCurrent})||{unitIds:[],units:[]}):null;
  if(!extended&&OPTIONAL_FIELDS.some(key=>Object.hasOwn(input,key)))fail('SCHEMA_UPGRADE_REQUIRED');
  const initial=extended?'IDENTIFIED':'INTENTION',id=randomUUID();
  const row=publicSnapshot?(await client.query(`INSERT INTO opportunity_catalog.application(organization_id,application_id,opportunity_id,evaluation_id,title,responsible_membership_id,deadline,status,created_by,central_opportunity_id,central_revision_id,central_snapshot${extended?',notes,total_budget,organization_budget':''}${interestUnits?',source_interest_id,source_interest_revision':''}) VALUES($1,$2,NULL,NULL,$3,$4,$5,'${initial}',$6,$7,$8,$9${extended?',$10,$11,$12':''}${interestUnits?',$13,$14':''}) RETURNING *`,[org,id,input.title,input.responsibleMembershipId,input.deadline,actor.id,input.opportunityId,input.centralRevisionId,publicSnapshot,...(extended?[input.notes??null,input.totalBudget??null,input.organizationBudget??null]:[]),...(interestUnits?[input.sourceInterestId||null,input.sourceInterestRevision||null]:[])])).rows[0]:(await client.query(`INSERT INTO opportunity_catalog.application(organization_id,application_id,opportunity_id,evaluation_id,title,responsible_membership_id,deadline,status,created_by${extended?',notes,total_budget,organization_budget':''})
   VALUES($1,$2,$3,$4,$5,$6,$7,'${initial}',$8${extended?',$9,$10,$11':''}) RETURNING *`,[org,id,input.opportunityId,input.evaluationId,input.title,input.responsibleMembershipId,input.deadline,actor.id,...(extended?[input.notes??null,input.totalBudget??null,input.organizationBudget??null]:[])])).rows[0];
  if(segmentation)await interestLink.storeUnits(client,org,id,segmentation.unitIds);
  const team=[...(input.includeResponsibleInTeam?[input.responsibleMembershipId]:[]),...(actor.membershipId&&await creatorJoinsTeam()?[actor.membershipId]:[])];
  await interestLink.addTeam(client,org,id,team,actor);
  if(input.includeResponsibleInTeam){await audit(client,{eventCode:'APPLICATION_CHANGED',operationCode:'APPLICATION_WORK_EDIT',resourceId:id,idempotencyKey:input.idempotencyKey})}
  await client.query(`INSERT INTO opportunity_catalog.application_change(organization_id,application_id,revision,kind,from_status,to_status,title,responsible_membership_id,deadline,actor_subject_id${extended?',notes,total_budget,organization_budget':''}${interestUnits?',source_interest_id,source_interest_revision,unit_ids,unit_snapshot':''})
   VALUES($1,$2,1,'CREATE',NULL,'${initial}',$3,$4,$5,$6${extended?',$7,$8,$9':''}${interestUnits?',$10,$11,$12,$13':''})`,[org,id,input.title,input.responsibleMembershipId,input.deadline,actor.id,...(extended?[input.notes??null,input.totalBudget??null,input.organizationBudget??null]:[]),...(interestUnits?[input.sourceInterestId||null,input.sourceInterestRevision||null,segmentation.unitIds,JSON.stringify(segmentation.units)]:[])]);
  await audit(client,{eventCode:'APPLICATION_CREATED',operationCode:'APPLICATION_CREATE',resourceId:id,idempotencyKey:input.idempotencyKey});
  return finish(client,input,'CREATE',input.opportunityId,prior.intentionDigest,project({...row,status_changed_at:row.created_at,...(segmentation?{unit_ids:segmentation.unitIds,units:segmentation.units}:{})}));
 }
 async function mutate(client,method,id,input){
  const row=await existing(client,id,true);if(!row)fail('RESOURCE_NOT_AVAILABLE');
  const operation=method==='edit'?'EDIT':'TRANSITION';
  await guarded(client,method==='edit'?'APPLICATION_EDIT':'APPLICATION_TRANSITION',id,sourceRead(row.opportunity_id,row.evaluation_id),{operation:method==='edit'?'APPLICATION_EDIT':'APPLICATION_TRANSITION',key:input.idempotencyKey,
   digest:digest({operation,resourceId:id,input,organizationId:org,subjectId:actor.id})});
  const prior=await receipt(client,input,operation,id);if(prior.previous)return prior.previous;
  if(Number(row.revision)!==input.expectedRevision)fail('STALE_REVISION');
  if(['CANCELLED','ARCHIVED'].includes(row.status))fail('STATE_CONFLICT');
  const extended=Object.hasOwn(row,'notes'),interestUnits=Object.hasOwn(row,'source_interest_id');
  if(interestLink.requested(input)&&!interestUnits)fail('SCHEMA_UPGRADE_REQUIRED');
  const segmentation=interestUnits?await interestLink.prepare(client,org,input,{current:row}):null;
  if(!extended&&OPTIONAL_FIELDS.some(key=>Object.hasOwn(input,key)))fail('SCHEMA_UPGRADE_REQUIRED');
  let next;
  if(method==='edit'){
   if(!await verifyResponsible(input.responsibleMembershipId))fail('RESPONSIBLE_UNAVAILABLE');
   next={title:input.title,responsibleMembershipId:input.responsibleMembershipId,deadline:input.deadline,status:row.status,reason:null};
  }else{
   if(!(extended?NEXT:BASIC_NEXT)[currentStatus(row.status)]?.includes(input.status))fail('STATE_CONFLICT');
   next={title:row.title,responsibleMembershipId:row.responsible_membership_id,deadline:row.deadline,status:input.status,reason:input.reason};
  }
  for(const [key,column] of [['notes','notes'],['totalBudget','total_budget'],['organizationBudget','organization_budget']])next[key]=method==='edit'&&Object.hasOwn(input,key)?input[key]:row[column]??null;
  const updated=(await client.query(`UPDATE opportunity_catalog.application SET title=$3,responsible_membership_id=$4,deadline=$5,status=$6,revision=revision+1,updated_at=transaction_timestamp()${extended?',notes=$8,total_budget=$9,organization_budget=$10':''}
   WHERE organization_id=$1 AND application_id=$2 AND revision=$7 RETURNING *`,[org,id,next.title,next.responsibleMembershipId,next.deadline,next.status,input.expectedRevision,...(extended?[next.notes,next.totalBudget,next.organizationBudget]:[])])).rows[0];
  if(!updated)fail('STALE_REVISION');
  if(Object.hasOwn(input,'unitIds'))await interestLink.storeUnits(client,org,id,segmentation.unitIds);
  await client.query(`INSERT INTO opportunity_catalog.application_change(organization_id,application_id,revision,kind,from_status,to_status,title,responsible_membership_id,deadline,reason,actor_subject_id${extended?',notes,total_budget,organization_budget':''}${interestUnits?',source_interest_id,source_interest_revision,unit_ids,unit_snapshot':''})
   VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11${extended?',$12,$13,$14':''}${interestUnits?',$15,$16,$17,$18':''})`,[org,id,updated.revision,operation,row.status,next.status,next.title,next.responsibleMembershipId,next.deadline,next.reason,actor.id,...(extended?[next.notes,next.totalBudget,next.organizationBudget]:[]),...(interestUnits?[row.source_interest_id,row.source_interest_revision,segmentation.unitIds,JSON.stringify(segmentation.units)]:[])]);
  await audit(client,{eventCode:method==='edit'?'APPLICATION_CHANGED':'APPLICATION_STAGE_CHANGED',operationCode:method==='edit'?'APPLICATION_EDIT':'APPLICATION_TRANSITION',resourceId:id,idempotencyKey:input.idempotencyKey});
  if(method==='transition'){
   const change={kind:'TRANSITION',application:updated,fromStatus:row.status,revision:Number(updated.revision)};
   await notify(client,change);
   await recordStatusEmail(client,change);
  }
  return finish(client,input,operation,id,prior.intentionDigest,project({...updated,...(segmentation?{unit_ids:segmentation.unitIds,units:segmentation.units}:{}),status_changed_at:method==='transition'?updated.updated_at:row.status_changed_at,last_submitted_at:method==='transition'&&next.status==='SUBMITTED'?updated.updated_at:row.last_submitted_at}));
 }
 async function get(client,id){const row=await existing(client,id);if(!row)fail('RESOURCE_NOT_AVAILABLE');
  await guarded(client,'APPLICATION_READ',id,sourceRead(row.opportunity_id,row.evaluation_id));
  const names=await responsibleNames([row.responsible_membership_id]);
  const frozen=row.central_opportunity_id?describeFrozenOpportunity(row.central_snapshot,{revisionId:row.central_revision_id}):null;
  const opp=frozen?{title:frozen.title,closing_date:frozen.closingDate}:await origin(client,row.opportunity_id);
  const segmentation=Object.hasOwn(row,'source_interest_id')?await interestLink.currentUnits(client,org,id):null;
  return {...project({...row,...(segmentation?{unit_ids:segmentation.unitIds,units:segmentation.units}:{})}),responsibleName:names.get(row.responsible_membership_id)||null,opportunityTitle:opp.title,opportunityClosingDate:opp.closing_date||null,
   ...(frozen?.readModel?{opportunityReadModel:frozen.readModel}:{}),
   canEdit:await authorize('APPLICATION_EDIT',resource(id,org)),
   allowedTransitions:await authorize('APPLICATION_TRANSITION',resource(id,org))?[...(Object.hasOwn(row,'notes')?NEXT:BASIC_NEXT)[currentStatus(row.status)]||[]]:[]};
 }
 async function history(client,id,input){const row=await existing(client,id);if(!row)fail('RESOURCE_NOT_AVAILABLE');await guarded(client,'APPLICATION_READ',id,sourceRead(row.opportunity_id,row.evaluation_id));
  const bind={organizationId:org,subjectId:actor.id,route:'history',applicationId:id};const position=input.cursor?cursor.openCursor(input.cursor,bind):null;
  if(position!==null&&(!Number.isSafeInteger(position)||position<1))fail('INVALID_CURSOR');
  const rows=(await client.query(`SELECT *
   FROM opportunity_catalog.application_change WHERE organization_id=$1 AND application_id=$2 AND ($3::bigint IS NULL OR revision<$3) ORDER BY revision DESC LIMIT 26`,[org,id,position])).rows;
  const page=rows.slice(0,25);const names=await responsibleNames([...new Set(page.map(r=>r.responsible_membership_id).filter(Boolean))]);return {items:page.map(r=>({responsibleName:names.get(r.responsible_membership_id)||null,revision:Number(r.revision),kind:r.kind,fromStatus:r.from_status,toStatus:r.to_status,title:r.title,responsibleMembershipId:r.responsible_membership_id,deadline:day(r.deadline),notes:r.notes??null,totalBudget:r.total_budget===null||r.total_budget===undefined?null:String(r.total_budget),organizationBudget:r.organization_budget===null||r.organization_budget===undefined?null:String(r.organization_budget),reason:r.reason,actorSubjectId:r.actor_subject_id,recordedAt:new Date(r.recorded_at).toISOString(),...(Object.hasOwn(r,'unit_ids')?{unitIds:r.unit_ids,units:r.unit_snapshot,sourceInterestId:r.source_interest_id,sourceInterestRevision:r.source_interest_revision===null?null:Number(r.source_interest_revision)}:{})})),nextCursor:rows.length>25?cursor.cursor(Number(page.at(-1).revision),bind):null};
 }
 async function unitOptions(client){
  await guarded(client,'APPLICATION_READ',org);return protectedUnitOptions(client);
 }
 async function protectedUnitOptions(client){
  const available=(await client.query("SELECT to_regclass('opportunity_catalog.application_unit') IS NOT NULL AS available")).rows[0]?.available;
  if(!available)fail('SCHEMA_UPGRADE_REQUIRED');
  const authority=await readAuthority(),{sql,params}=require('./browseSql').selection(org,authority,new Map(),{});
  const rows=(await client.query(`${sql} SELECT s.scope_id,s.label,s.parent_scope_id,s.lifecycle FROM organizational_scope.scope s
   WHERE s.organization_id=$1 AND s.scope_type='UNIT' AND (s.lifecycle='ACTIVE' OR EXISTS(
    SELECT 1 FROM opportunity_catalog.application_unit u JOIN visible a ON a.organization_id=u.organization_id AND a.application_id=u.application_id
    WHERE u.organization_id=s.organization_id AND u.scope_id=s.scope_id AND u.active)) ORDER BY s.label,s.scope_id LIMIT 1001`,params)).rows;
  if(rows.length>1000)fail('LIMIT_EXCEEDED');
  return {items:rows.map(row=>({unitId:row.scope_id,label:row.label,parentUnitId:row.parent_scope_id,lifecycle:row.lifecycle}))};
 }
 async function canRead(row){return await authorize('APPLICATION_READ',resource(row.application_id,org))&&await authorize('OPPORTUNITY_READ',resource(row.opportunity_id||org,org,'OPPORTUNITY'));}
 async function opportunitySummaries(client,input){
  // Collection access does not require access to every requested origin. Each
  // counted application still passes canRead, including its own source guard.
  await guarded(client,'APPLICATION_READ',org);
  const summaries=new Map(input.opportunityIds.map(opportunityId=>[opportunityId,{opportunityId,count:0,statuses:{},applicationId:null}]));
  let position=null;
  // Count only authorized resources; the same tenant predicate, keyset and hard
  // scan limit as list apply. Never return partial counts as complete results.
  for(let scanned=0;scanned<10000;scanned+=100){
   const batch=(await client.query(`SELECT application_id,opportunity_id,status${centralOrigin?',central_opportunity_id':''} FROM opportunity_catalog.application WHERE organization_id=$1 AND ($2::uuid IS NULL OR application_id>$2)
    AND (opportunity_id=ANY($3::uuid[]) ${centralOrigin?'OR central_opportunity_id=ANY($3::uuid[])':''}) ORDER BY application_id LIMIT 100`,[org,position,input.opportunityIds])).rows;
   for(const row of batch){
    position=row.application_id;
    if(!await canRead(row))continue;
    const summary=summaries.get(row.opportunity_id||row.central_opportunity_id);
    const status=currentStatus(row.status);
    if(!summary||!Object.hasOwn(NEXT,status))fail('SERVICE_UNAVAILABLE');
    summary.count++;summary.statuses[status]=(summary.statuses[status]||0)+1;
    summary.applicationId=summary.count===1?row.application_id:null;
   }
   if(batch.length<100)return {items:[...summaries.values()]};
  }
  fail('LIMIT_EXCEEDED');
 }
 async function list(client,input){await guarded(client,'APPLICATION_READ',org);
  const bind={organizationId:org,subjectId:actor.id,route:'list',opportunityId:input.opportunityId};let position=input.cursor?cursor.openCursor(input.cursor,bind):null;
  if(position!==null)uuid(position);
  const items=[];let more=false,lastIncluded=null,exhausted=false;
  for(let scanned=0;scanned<10000 && !more;scanned+=100){
   const batch=(await client.query(`SELECT a.*,(SELECT recorded_at FROM opportunity_catalog.application_change h WHERE h.organization_id=a.organization_id AND h.application_id=a.application_id AND h.kind IN ('CREATE','TRANSITION') ORDER BY h.revision DESC LIMIT 1) AS status_changed_at,(SELECT recorded_at FROM opportunity_catalog.application_change h WHERE h.organization_id=a.organization_id AND h.application_id=a.application_id AND h.kind='TRANSITION' AND h.to_status='SUBMITTED' ORDER BY h.revision DESC LIMIT 1) AS last_submitted_at FROM opportunity_catalog.application a WHERE organization_id=$1 AND ($2::uuid IS NULL OR application_id>$2)
    AND ($3::uuid IS NULL OR opportunity_id=$3 ${centralOrigin?'OR central_opportunity_id=$3':''}) ORDER BY application_id LIMIT 100`,[org,position,input.opportunityId])).rows;
   if(!batch.length){exhausted=true;break}
   for(const row of batch){position=row.application_id;
    const allowed=await canRead(row);
    if(allowed){if(items.length===25){more=true;break}items.push(row);lastIncluded=row.application_id}
   }
   if(batch.length<100){exhausted=true;break}
  }
  if(!more&&!exhausted)fail('LIMIT_EXCEEDED');
  return {items:(await interestLink.hydratePageUnits(client,org,items)).map(project),nextCursor:more?cursor.cursor(lastIncluded,bind):null};
 }
 const browse=require('./browseSql').createSqlBrowse({org,actor,cursor,guarded,project,readAuthority,responsibleDirectory,transitionCapability});
 const report=require('./reportSql').createSqlReport({org,organizationName,actor,guarded,readAuthority,responsibleDirectory,directory:reportDirectory,project,cursor,audit,canReadStrategyAlignment});
 async function browsePage(client,input){
  const page=await browse(client,input);
  const units=await protectedUnitOptions(client);
  const items=await require('./listPriorities').hydratePriorities(client,{org,items:page.items,authorize,taskDetailsAvailable});
  return {...page,items,units:units.items};
 }
 return {unitOptions,browse,browsePage,report,reportExport:(c,input)=>report(c,input,true),create,edit:(c,id,input)=>mutate(c,'edit',id,input),transition:(c,id,input)=>mutate(c,'transition',id,input),get,history,list,opportunitySummaries};
}
module.exports={createApplicationRepository,resource,project};
