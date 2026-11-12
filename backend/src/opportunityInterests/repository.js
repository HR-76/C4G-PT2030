'use strict';
const {randomUUID,createHash}=require('node:crypto');
const {canonicalize}=require('../organizationalProfile/canonicalization');
const {fail,uuid}=require('./contracts');
const {describeFrozenOpportunity,centralLifecycle}=require('../applications/opportunitySnapshot');
const {assertDetailSize}=require('../opportunities/v2/readModel');
const READ='OPPORTUNITY_INTEREST_READ',REGISTER='OPPORTUNITY_INTEREST_REGISTER',MANAGE='OPPORTUNITY_INTEREST_MANAGE';
const digest=value=>createHash('sha256').update(canonicalize(value)).digest('hex');
function resource(organizationId,id=organizationId,resourceType='OPPORTUNITY_INTEREST'){
 return {id,organizationId,resourceType,status:'ACTIVE',scopeType:id===organizationId?'ORGANIZATION':'RESOURCE',scopeId:id,unitId:null,teamIds:[],ancestorUnitIds:[],distinctFromActorIds:[]};
}
async function acquireUnitTreeLock(client,organizationId){
 await client.query("SELECT pg_advisory_xact_lock(hashtextextended('F13-P1:' || $1::text,43001301))",[organizationId]);
}
async function unitDirectory(client,organizationId){
 const rows=(await client.query(`SELECT scope_id,label,parent_scope_id,lifecycle FROM organizational_scope.scope
  WHERE organization_id=$1 AND scope_type='UNIT' ORDER BY scope_id LIMIT 1001`,[organizationId])).rows;
 if(rows.length>1000)fail('LIMIT_EXCEEDED');return rows;
}
function projectUnits(rows,ids){
 const directory=new Map(rows.map(row=>[row.scope_id,row]));
 return ids.map(id=>{
  const row=directory.get(id);if(!row)fail('UNIT_UNAVAILABLE');
  const path=[],seen=new Set();let parent=row;
  while(parent){if(seen.has(parent.scope_id))fail('SERVICE_UNAVAILABLE');seen.add(parent.scope_id);path.unshift(parent.label);parent=directory.get(parent.parent_scope_id);}
  return {unitId:id,label:row.label,parentUnitId:row.parent_scope_id||null,lifecycle:row.lifecycle,path:path.join(' / ')};
 });
}
async function unitsForIds(client,organizationId,ids){return ids.length?projectUnits(await unitDirectory(client,organizationId),ids):[];}
async function validateUnitIds(client,organizationId,ids,{existingIds=[]}={}){
 if(!ids.length)return [];
 const units=await unitsForIds(client,organizationId,ids),existing=new Set(existingIds);
 if(units.some(unit=>unit.lifecycle!=='ACTIVE'&&!existing.has(unit.unitId)))fail('UNIT_UNAVAILABLE');
 return units;
}
async function loadInterestForConversion(client,{organizationId,interestId,expectedRevision,opportunityId}){
 // The caller must protect READ+MANAGE and hold the unit-tree lock in its own
 // transaction. This helper deliberately never opens another lease/transaction.
 const row=(await client.query('SELECT * FROM opportunity_catalog.opportunity_interest WHERE organization_id=$1 AND interest_id=$2 FOR UPDATE',[organizationId,interestId])).rows[0];
 if(!row||row.organization_id!==organizationId||row.central_opportunity_id!==opportunityId)fail('RESOURCE_NOT_AVAILABLE');
 if(Number(row.revision)!==expectedRevision)fail('STALE_REVISION');
 if(row.status!=='ACTIVE')fail('STATE_CONFLICT');
 // The observation on the interest is historical. The application caller
 // separately validates the current central revision explicitly confirmed by
 // the user; a source update must not make an existing interest unusable.
 return row;
}
// Receipts preserve the explicit scope of each revision; historical empty unit lists
// have no such declaration. Read only the flag, never the stored private snapshot.
const transversalAt = alias => `EXISTS (SELECT 1 FROM opportunity_catalog.interest_receipt rc
 WHERE rc.organization_id=${alias}.organization_id AND rc.resource_id=${alias}.interest_id
 AND rc.result_projection @> jsonb_build_object('revision',${alias}.revision,'transversal',true))`;
function project(row,units=[],includeReadModel=true){
 const frozen=includeReadModel?describeFrozenOpportunity(row.central_snapshot,{revisionId:row.central_revision_id}):null;
 return {interestId:row.interest_id,opportunityId:row.central_opportunity_id,centralRevisionId:row.central_revision_id,snapshot:row.central_snapshot,
  ...(frozen?.readModel?{readModel:frozen.readModel}:{}),
  title:row.title,notes:row.notes??null,transversal:row.transversal===true && !units.length,status:row.status,revision:Number(row.revision),unitIds:units.map(unit=>unit.unitId),units,
  createdBy:row.created_by,createdMembershipId:row.created_membership_id,createdAt:new Date(row.created_at).toISOString(),updatedAt:new Date(row.updated_at).toISOString()};
}
function createOpportunityInterestRepository({organizationId:org,actor,protect,authorize,audit,cursor,centralOrigin,centralCurrent}){
 const root=resource(org);
 async function capabilities(id=org,status='ACTIVE'){
  const canRegister=await authorize(REGISTER,root),canManage=status==='ACTIVE'&&await authorize(MANAGE,resource(org,id));
  const canCreateApplication=canManage&&await authorize('APPLICATION_CREATE',resource(org,org,'APPLICATION'))&&await authorize('OPPORTUNITY_READ',resource(org,org,'OPPORTUNITY'));
  return {canRegister,canManage,canCreateApplication,canIncludeResponsibleInTeam:canCreateApplication&&await authorize('APPLICATION_WORK_EDIT',resource(org,org,'APPLICATION'))};
 }
 async function guarded(operation,id=org,input=null,method=null){
  return protect({operationCode:operation,resource:resource(org,id),additionalAuthorizations:operation===READ?[]:[{operationCode:READ,resource:resource(org,id)}],
   ...(input?{intention:{operation,key:input.idempotencyKey,digest:intention(method,input,id)}}:{})});
 }
 function intention(method,input,id){return digest({method,input,resourceId:id,organizationId:org,subjectId:actor.id});}
 async function receipt(client,method,input,id){
  const row=(await client.query('SELECT * FROM opportunity_catalog.interest_receipt WHERE organization_id=$1 AND idempotency_key=$2',[org,input.idempotencyKey])).rows[0];
  const intentionDigest=intention(method,input,id);
  if(row&&(row.operation!==method||row.subject_id!==actor.id||row.intention_digest!==intentionDigest||(method!=='REGISTER'&&row.resource_id!==id)))fail('IDEMPOTENCY_CONFLICT');
  return {previous:row?.result_projection||null,intentionDigest};
 }
 async function finish(client,method,input,intentionDigest,result){
  const response=await withCapabilities(result);
  await client.query('INSERT INTO opportunity_catalog.interest_receipt(organization_id,idempotency_key,operation,subject_id,resource_id,intention_digest,result_projection) VALUES($1,$2,$3,$4,$5,$6,$7)',[org,input.idempotencyKey,method,actor.id,result.interestId,intentionDigest,result]);
  return response;
 }
 async function withCapabilities(result){return assertDetailSize({...result,capabilities:await capabilities(result.interestId,result.status)});}
 async function activeUnitIds(client,id){return (await client.query('SELECT scope_id FROM opportunity_catalog.interest_unit WHERE organization_id=$1 AND interest_id=$2 AND active ORDER BY scope_id',[org,id])).rows.map(row=>row.scope_id);}
 async function projection(client,row){return project(row,await unitsForIds(client,org,await activeUnitIds(client,row.interest_id)));}
 async function readRow(client,id,lock=false){
  const row=(await client.query(`SELECT i.*,${transversalAt('i')} AS transversal FROM opportunity_catalog.opportunity_interest i WHERE i.organization_id=$1 AND i.interest_id=$2${lock?' FOR UPDATE':''}`,[org,id])).rows[0];
  if(!row)fail('RESOURCE_NOT_AVAILABLE');return row;
 }
 async function change(client,row,kind,units,reason=null){
  await client.query(`INSERT INTO opportunity_catalog.interest_change(organization_id,interest_id,revision,kind,title,notes,status,unit_ids,unit_snapshot,reason,actor_subject_id,actor_membership_id)
   VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,[org,row.interest_id,Number(row.revision),kind,row.title,row.notes??null,row.status,units.map(unit=>unit.unitId),JSON.stringify(units),reason,actor.id,actor.membershipId]);
 }
 async function setUnits(client,id,ids){
  await client.query('UPDATE opportunity_catalog.interest_unit SET active=false WHERE organization_id=$1 AND interest_id=$2 AND active AND NOT(scope_id=ANY($3::uuid[]))',[org,id,ids]);
  for(const unitId of ids)await client.query(`INSERT INTO opportunity_catalog.interest_unit(organization_id,interest_id,scope_id,active) SELECT $1,$2,$3,true WHERE NOT EXISTS(SELECT 1 FROM opportunity_catalog.interest_unit WHERE organization_id=$1 AND interest_id=$2 AND scope_id=$3 AND active)
   ON CONFLICT(organization_id,interest_id,scope_id) DO UPDATE SET active=true`,[org,id,unitId]);
 }
 async function context(){await guarded(READ);return {available:true,capabilities:await capabilities()};}
 async function register(client,input){
  await guarded(REGISTER,org,input,'REGISTER');await acquireUnitTreeLock(client,org);
  const prior=await receipt(client,'REGISTER',input,org);if(prior.previous)return withCapabilities(prior.previous);
  if(!input.unitIds.length && input.transversal!==true)fail();
  const existing=(await client.query(`SELECT i.*,${transversalAt('i')} AS transversal FROM opportunity_catalog.opportunity_interest i WHERE i.organization_id=$1 AND i.central_opportunity_id=$2 FOR UPDATE`,[org,input.opportunityId])).rows[0];
  if(existing){
   if(!await authorize(READ,resource(org,existing.interest_id)))fail('RESOURCE_NOT_AVAILABLE');
   return finish(client,'REGISTER',input,prior.intentionDigest,await projection(client,existing));
  }
  if(typeof centralCurrent!=='function'||typeof centralOrigin!=='function')fail('SERVICE_UNAVAILABLE');
  const current=await centralCurrent(input.opportunityId);
  if(!current||current.snapshot?.lifecycleState==='ARCHIVED')fail('RESOURCE_NOT_AVAILABLE');
  if(current.revisionId!==input.centralRevisionId)fail('STALE_OPPORTUNITY_REVISION');
  const snapshot=await centralOrigin(input.opportunityId,input.centralRevisionId);
  if(!snapshot||centralLifecycle(snapshot,current)==='ARCHIVED')fail('RESOURCE_NOT_AVAILABLE');
  const sourceTitle=describeFrozenOpportunity(snapshot,{revisionId:input.centralRevisionId}).title;
  const units=await validateUnitIds(client,org,input.unitIds),id=randomUUID();
  // Validate the complete response before storing a source or receipt that the
  // API could never return. The final persisted projection is checked again.
  const proposed={interest_id:id,central_opportunity_id:input.opportunityId,central_revision_id:input.centralRevisionId,
   central_snapshot:snapshot,title:sourceTitle,notes:input.notes??null,transversal:input.transversal===true,status:'ACTIVE',revision:1,created_by:actor.id,
   created_membership_id:actor.membershipId,created_at:new Date(),updated_at:new Date()};
  await withCapabilities(project(proposed,units));
  const row=(await client.query(`INSERT INTO opportunity_catalog.opportunity_interest(organization_id,interest_id,central_opportunity_id,central_revision_id,central_snapshot,title,created_by,created_membership_id,notes)
   VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,[org,id,input.opportunityId,input.centralRevisionId,snapshot,sourceTitle,actor.id,actor.membershipId,input.notes??null])).rows[0];
  await setUnits(client,id,input.unitIds);await change(client,row,'REGISTER',units);
  await audit(client,{eventCode:'OPPORTUNITY_INTEREST_REGISTERED',operationCode:REGISTER,resourceId:id,idempotencyKey:input.idempotencyKey});
  return finish(client,'REGISTER',input,prior.intentionDigest,project({...row,transversal:input.transversal===true},units));
 }
 async function get(client,_input,id){await guarded(READ,id);return withCapabilities(await projection(client,await readRow(client,id)));}
 async function mutate(client,input,id,method){
  await guarded(MANAGE,id,input,method);await acquireUnitTreeLock(client,org);
  const prior=await receipt(client,method,input,id);if(prior.previous)return withCapabilities(prior.previous);
  const row=await readRow(client,id,true);if(Number(row.revision)!==input.expectedRevision)fail('STALE_REVISION');if(row.status!=='ACTIVE')fail('STATE_CONFLICT');
  const previousIds=await activeUnitIds(client,id),ids=method==='EDIT'?input.unitIds:previousIds;
  const units=method==='EDIT'?await validateUnitIds(client,org,ids,{existingIds:previousIds}):await unitsForIds(client,org,ids);
  await withCapabilities(project({...row,notes:method==='EDIT'?input.notes:row.notes,status:method==='ARCHIVE'?'ARCHIVED':'ACTIVE',
   revision:Number(row.revision)+1,updated_at:new Date()},units));
  const updated=(await client.query(`UPDATE opportunity_catalog.opportunity_interest SET notes=$3,status=$4,revision=revision+1,updated_at=transaction_timestamp()
   WHERE organization_id=$1 AND interest_id=$2 AND revision=$5 RETURNING *`,[org,id,method==='EDIT'?input.notes:row.notes,method==='ARCHIVE'?'ARCHIVED':'ACTIVE',input.expectedRevision])).rows[0];
  if(!updated)fail('STALE_REVISION');if(method==='EDIT')await setUnits(client,id,ids);
  await change(client,updated,method,units,input.reason||null);
  await audit(client,{eventCode:method==='EDIT'?'OPPORTUNITY_INTEREST_CHANGED':'OPPORTUNITY_INTEREST_ARCHIVED',operationCode:MANAGE,resourceId:id,idempotencyKey:input.idempotencyKey});
  return finish(client,method,input,prior.intentionDigest,project({...updated,transversal:row.transversal},units));
 }
 async function history(client,input,id){
  await guarded(READ,id);await readRow(client,id);
  const bind={organizationId:org,subjectId:actor.id,route:'interest-history',interestId:id};
  const position=input.cursor?cursor.openCursor(input.cursor,bind):null;
  if(position!==null&&(!Number.isSafeInteger(position)||position<1))fail('INVALID_CURSOR');
  const rows=(await client.query(`SELECT c.*,${transversalAt('c')} AS transversal FROM opportunity_catalog.interest_change c WHERE organization_id=$1 AND interest_id=$2
   AND ($3::bigint IS NULL OR revision<$3) ORDER BY revision DESC LIMIT 26`,[org,id,position])).rows;
  const page=rows.slice(0,25);
  return {items:page.map(row=>({revision:Number(row.revision),action:row.kind,kind:row.kind,title:row.title,status:row.status,notes:row.notes,transversal:row.transversal===true,
   unitIds:row.unit_ids,units:row.unit_snapshot,reason:row.reason,createdBy:row.actor_subject_id,actorSubjectId:row.actor_subject_id,
   actorMembershipId:row.actor_membership_id,recordedAt:new Date(row.recorded_at).toISOString()})),nextCursor:rows.length>25?cursor.cursor(Number(page.at(-1).revision),bind):null};
 }
 async function list(client,input){
  await guarded(READ);
  const bind={organizationId:org,subjectId:actor.id,route:'interest-list',q:input.q,unitId:input.unitId,status:input.status};
  let position=input.cursor?uuid(cursor.openCursor(input.cursor,bind)):null,lastIncluded=null,exhausted=false,more=false;const selected=[];
  for(let scanned=0;scanned<10000&&!more;scanned+=100){
   const rows=(await client.query(`SELECT i.*,${transversalAt('i')} AS transversal FROM opportunity_catalog.opportunity_interest i
    WHERE i.organization_id=$1 AND ($2::uuid IS NULL OR i.interest_id>$2) AND ($3='ALL' OR i.status=$3)
    AND ($4='' OR strpos(lower(i.title),lower($4))>0 OR strpos(lower(COALESCE(i.notes,'')),lower($4))>0)
    AND ($5::text IS NULL OR ($5='NONE' AND NOT EXISTS(SELECT 1 FROM opportunity_catalog.interest_unit u WHERE u.organization_id=i.organization_id AND u.interest_id=i.interest_id AND u.active))
     OR EXISTS(SELECT 1 FROM opportunity_catalog.interest_unit u WHERE u.organization_id=i.organization_id AND u.interest_id=i.interest_id AND u.active AND u.scope_id::text=$5))
    ORDER BY i.interest_id LIMIT 100`,[org,position,input.status,input.q,input.unitId])).rows;
   for(const row of rows){position=row.interest_id;if(!await authorize(READ,resource(org,row.interest_id)))continue;
    if(selected.length===25){more=true;break;}selected.push(row);lastIncluded=row.interest_id;
   }
   if(rows.length<100){exhausted=true;break;}
  }
  if(!more&&!exhausted)fail('LIMIT_EXCEEDED');
  const links=selected.length?(await client.query(`SELECT interest_id,scope_id FROM opportunity_catalog.interest_unit
   WHERE organization_id=$1 AND interest_id=ANY($2::uuid[]) AND active ORDER BY interest_id,scope_id`,[org,selected.map(row=>row.interest_id)])).rows:[];
  const directory=links.length?await unitDirectory(client,org):[],byInterest=new Map();
  for(const link of links){if(!byInterest.has(link.interest_id))byInterest.set(link.interest_id,[]);byInterest.get(link.interest_id).push(link.scope_id);}
  const items=[];for(const row of selected){
   const {snapshot,notes,...item}=project(row,projectUnits(directory,byInterest.get(row.interest_id)||[]),false);
   items.push(await withCapabilities({...item,notesExcerpt:notes?.slice(0,180)||null}));
  }
  return {items,nextCursor:more?cursor.cursor(lastIncluded,bind):null,capabilities:await capabilities()};
 }
 async function summaries(client,input){
  await guarded(READ);
  const rows=(await client.query(`SELECT i.interest_id,i.central_opportunity_id,i.status FROM opportunity_catalog.opportunity_interest i
   WHERE i.organization_id=$1 AND i.central_opportunity_id=ANY($2::uuid[]) ORDER BY i.interest_id LIMIT 26`,[org,input.opportunityIds])).rows;
  if(rows.length>25)fail('LIMIT_EXCEEDED');
  const allowed=[];for(const row of rows){if(await authorize(READ,resource(org,row.interest_id)))allowed.push(row);}
  const unitRows=allowed.length?(await client.query('SELECT interest_id,scope_id FROM opportunity_catalog.interest_unit WHERE organization_id=$1 AND interest_id=ANY($2::uuid[]) AND active ORDER BY scope_id',[org,allowed.map(row=>row.interest_id)])).rows:[];
  const units=new Map();for(const row of unitRows){if(!units.has(row.interest_id))units.set(row.interest_id,[]);units.get(row.interest_id).push(row.scope_id);}
  const found=new Map();for(const row of allowed){
   found.set(row.central_opportunity_id,{opportunityId:row.central_opportunity_id,interestId:row.interest_id,status:row.status,unitIds:units.get(row.interest_id)||[]});
  }
  return {capabilities:await capabilities(),items:input.opportunityIds.map(opportunityId=>found.get(opportunityId)||{opportunityId,interestId:null,status:null,unitIds:[]})};
 }
 async function units(client,input){
  if(input.purpose==='ASSIGN'){
   const operation=await authorize(REGISTER,root)?REGISTER:await authorize(MANAGE,root)?MANAGE:null;if(!operation)fail('NOT_AUTHORIZED');
   await protect({operationCode:READ,resource:root,intention:{operation:'INTEREST_UNIT_ASSIGN'},
    additionalAuthorizations:[{operationCode:operation,resource:root}]});
  }else await guarded(READ);
  const rows=await unitDirectory(client,org);
  let selected=rows.filter(row=>row.lifecycle==='ACTIVE');
  if(input.purpose==='FILTER'){
   const links=(await client.query(`SELECT DISTINCT u.scope_id,u.interest_id FROM opportunity_catalog.interest_unit u
    JOIN opportunity_catalog.opportunity_interest i ON i.organization_id=u.organization_id AND i.interest_id=u.interest_id
    WHERE u.organization_id=$1 AND u.active ORDER BY u.interest_id,u.scope_id LIMIT 10001`,[org])).rows;
   if(links.length>10000)fail('LIMIT_EXCEEDED');
   const allowed=new Map(),referenced=new Set();for(const link of links){
    if(!allowed.has(link.interest_id))allowed.set(link.interest_id,await authorize(READ,resource(org,link.interest_id)));
    if(allowed.get(link.interest_id))referenced.add(link.scope_id);
   }
   selected=rows.filter(row=>row.lifecycle==='ACTIVE'||referenced.has(row.scope_id));
  }
  return {items:projectUnits(rows,selected.map(row=>row.scope_id))};
 }
 return {context,register,get,list,summaries,history,units,edit:(client,input,id)=>mutate(client,input,id,'EDIT'),archive:(client,input,id)=>mutate(client,input,id,'ARCHIVE')};
}
module.exports={createOpportunityInterestRepository,resource,project,acquireUnitTreeLock,validateUnitIds,unitsForIds,loadInterestForConversion};
