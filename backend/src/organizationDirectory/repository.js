'use strict';
const {randomUUID}=require('node:crypto');
const {intentDigest}=require('../security/tenantRepositorySupport');
const {createRepository:createScopeRepository}=require('../organizationalScopes/repository');
const {createPreparedOrganizationalScopeService}=require('../organizationalScopes/service');
const {fail,uuid}=require('./contracts');
const {areas}=require('./thematicAreas');
const emptyStrategy=()=>({areaIds:[],interests:[],objectives:[]});
function resource(org,id=org,type='ORGANIZATION',scopeType='ORGANIZATION'){
 return {id,organizationId:org,resourceType:type,scopeType,scopeId:id,status:'ACTIVE',unitId:scopeType==='UNIT'?id:null,
  teamIds:[],ancestorUnitIds:[],distinctFromActorIds:[]};
}
const personProjection=r=>({personId:r.person_id,name:r.name,email:r.email,functionLabel:r.function_label,active:r.active,
 revision:Number(r.revision),unitIds:r.unit_ids||[],primaryUnitId:r.primary_unit_id||null});
const cardProjection=r=>({description:r?.description||'',email:r?.email||'',website:r?.website||'',revision:Number(r?.revision||0)});
function createDirectoryRepository({organizationId:org,actor,authorize,protect,audit,tokens,organization,memberships,clock,registration=null,supportsStrategy=false}){
 const root=resource(org),scopeRoot=resource(org,org,'ORGANIZATIONAL_SCOPE');
 const readScope={operationCode:'ORGANIZATIONAL_SCOPE_READ',resource:scopeRoot};
 const intention=(method,input,id)=>({operation:`DIRECTORY_${method.toUpperCase()}`,key:input.idempotencyKey,
  digest:intentDigest({organizationId:org,subjectId:actor.id,method,input,id})});
 const guarded=(method,input,id,extras=[],exactIntention=null,operationCode=null)=>protect({operationCode:operationCode||(input?.idempotencyKey?'ORGANIZATION_DIRECTORY_EDIT':'ORGANIZATION_DIRECTORY_READ'),
  resource:root,additionalAuthorizations:extras,intention:exactIntention||(input?.idempotencyKey?intention(method,input,id):{operation:'DIRECTORY_READ'})});
 async function receipt(client,method,input,id){
  const digest=intention(method,input,id).digest;
  const row=(await client.query('SELECT subject_id,intention_digest,result_projection FROM organizational_scope.directory_receipt WHERE organization_id=$1 AND idempotency_key=$2',[org,input.idempotencyKey])).rows[0];
  if(row&&(row.subject_id!==actor.id||row.intention_digest!==digest))fail('IDEMPOTENCY_CONFLICT');
  return {digest,previous:row?.result_projection};
 }
 async function finish(client,method,input,id,digest,result){
  const cardChanged=method==='profileEdit'||method==='strategyEdit';
  await audit(client,{eventCode:cardChanged?'ORGANIZATION_CARD_CHANGED':method==='personCreate'?'ORGANIZATION_PERSON_CREATED':'ORGANIZATION_PERSON_CHANGED',
   resourceId:result.personId||id,resourceType:cardChanged?'ORGANIZATION':'ORGANIZATION_PERSON',idempotencyKey:input.idempotencyKey});
  await client.query(`INSERT INTO organizational_scope.directory_receipt(organization_id,idempotency_key,subject_id,operation,resource_id,intention_digest,result_projection)
   VALUES($1,$2,$3,$4,$5,$6,$7)`,[org,input.idempotencyKey,actor.id,{profileEdit:'PROFILE_EDIT',strategyEdit:'PROFILE_EDIT',personCreate:'PERSON_CREATE',personEdit:'PERSON_EDIT',personProfileEdit:'PERSON_PROFILE_EDIT',personLinkEdit:'PERSON_LINK_EDIT',selfEdit:'SELF_EDIT'}[method],id,digest,result]);
  return result;
 }
 async function context(client){
  await guarded('context',null,org);
  const card=(await client.query('SELECT * FROM organizational_scope.organization_card WHERE organization_id=$1',[org])).rows[0];
  const permissions={};
  for(const [key,operationCode,target] of [['edit','ORGANIZATION_DIRECTORY_EDIT',root],['units','ORGANIZATIONAL_SCOPE_READ',scopeRoot],
   ['createUnit','ORGANIZATIONAL_SCOPE_CREATE',root],['renameUnit','ORGANIZATIONAL_SCOPE_RENAME',scopeRoot],['moveUnit','ORGANIZATIONAL_SCOPE_REPARENT',scopeRoot]])permissions[key]=await authorize(operationCode,target);
  const registered=registration?await registration():null,profile=cardProjection(card);
  if(registered){profile.email=registered.fields.institutionalEmail||'';profile.website=registered.fields.website||'';}
  if(supportsStrategy){profile.strategy=card?.strategy||emptyStrategy();profile.strategyAreas=areas.map(({id,name})=>({id,name}));}
  return {organization:await organization(org),profile,permissions,...(registration?{registration:registered,contactSource:registered?'CENTRAL':'TENANT'}:{})};
 }
 async function units(client){
  await guarded('units',null,org,[readScope]);
  const rows=(await client.query(`SELECT scope_id,label,stable_code,parent_scope_id,lifecycle,revision FROM organizational_scope.scope
   WHERE organization_id=$1 AND scope_type='UNIT' ORDER BY label,scope_id LIMIT 1001`,[org])).rows;
  if(rows.length>1000)fail('LIMIT_EXCEEDED');
  return {items:rows.map(r=>({scopeId:r.scope_id,label:r.label,stableCode:r.stable_code,parentScopeId:r.parent_scope_id,lifecycle:r.lifecycle,revision:Number(r.revision)}))};
 }
 async function profileEdit(client,input,descriptionOnly=false){
  await guarded('profileEdit',input,org);const prior=await receipt(client,'profileEdit',input,org);if(prior.previous)return prior.previous;
  const registered=registration?await registration():null;
  if(registered&&!descriptionOnly&&(input.email!==(registered.fields.institutionalEmail||'')||input.website!==(registered.fields.website||'')))fail('CONTACTS_CENTRAL');
  const current=(await client.query('SELECT revision,email,website FROM organizational_scope.organization_card WHERE organization_id=$1 FOR UPDATE',[org])).rows[0];
  if(Number(current?.revision||0)!==input.expectedRevision)fail('STALE_REVISION');
  const row=(await client.query(`INSERT INTO organizational_scope.organization_card(organization_id,description,email,website,revision,updated_by)
   VALUES($1,$2,$3,$4,1,$5) ON CONFLICT(organization_id) DO UPDATE SET description=$2,email=$3,website=$4,
   revision=organization_card.revision+1,updated_by=$5,updated_at=transaction_timestamp() RETURNING *`,[org,input.description,registered||descriptionOnly?(current?.email||''):input.email,registered||descriptionOnly?(current?.website||''):input.website,actor.id])).rows[0];
  const result=cardProjection(row);if(registered){result.email=registered.fields.institutionalEmail||'';result.website=registered.fields.website||'';}
  return finish(client,'profileEdit',input,org,prior.digest,result);
 }
 async function strategyEdit(client,input){
  await guarded('strategyEdit',input,org);
  if(!supportsStrategy)fail('RESOURCE_NOT_AVAILABLE');
  const prior=await receipt(client,'strategyEdit',input,org);
  if(prior.previous)return prior.previous;
  const current=(await client.query('SELECT revision FROM organizational_scope.organization_card WHERE organization_id=$1 FOR UPDATE',[org])).rows[0];
  if(Number(current?.revision||0)!==input.expectedRevision)fail('STALE_REVISION');
  const {areaIds,interests,objectives}=input;
  const row=(await client.query(`INSERT INTO organizational_scope.organization_card(organization_id,strategy,revision,updated_by)
   VALUES($1,$2,1,$3) ON CONFLICT(organization_id) DO UPDATE SET strategy=$2,revision=organization_card.revision+1,
   updated_by=$3,updated_at=transaction_timestamp() RETURNING strategy,revision`,[org,{areaIds,interests,objectives},actor.id])).rows[0];
  return finish(client,'strategyEdit',input,org,prior.digest,{strategy:row.strategy,revision:Number(row.revision)});
 }
 async function people(client,input,withResearchAreas=false){
  await guarded('people',null,org);
  const withInterests=supportsStrategy&&!withResearchAreas;
  if(input.interestAreaId&&!withInterests)fail('RESOURCE_NOT_AVAILABLE');
  const bind={organizationId:org,subjectId:actor.id,route:'organization-people',...(input.areaId?{areaId:input.areaId}:{}),
   ...(input.interestAreaId?{interestAreaId:input.interestAreaId}:{}),search:input.search,unitId:input.unitId,status:input.status};
  const position=input.cursor?uuid(tokens.openCursor(input.cursor,bind)):null;
  const pattern='%'+input.search.replace(/[\\%_]/g,'\\$&')+'%';
  const rows=(await client.query(`SELECT p.*,COALESCE(pp.area_ids,'{}'::uuid[]) AS area_ids
   ${withInterests?",COALESCE(pp.interest_area_ids,'{}'::uuid[]) AS interest_area_ids":''},
   ARRAY(SELECT u.scope_id FROM organizational_scope.person_unit u WHERE u.organization_id=p.organization_id AND u.person_id=p.person_id ORDER BY u.scope_id) AS unit_ids,
   (SELECT u.scope_id FROM organizational_scope.person_unit u WHERE u.organization_id=p.organization_id AND u.person_id=p.person_id AND u.is_primary) AS primary_unit_id
   FROM organizational_scope.person p LEFT JOIN organizational_scope.person_profile pp ON pp.organization_id=p.organization_id AND pp.person_id=p.person_id
   WHERE p.organization_id=$1 AND ($2::uuid IS NULL OR p.person_id>$2)
   AND (p.name ILIKE $3 OR p.email ILIKE $3 OR p.function_label ILIKE $3)
   AND ($4::uuid IS NULL OR EXISTS(SELECT 1 FROM organizational_scope.person_unit u WHERE u.organization_id=$1 AND u.person_id=p.person_id AND u.scope_id=$4))
   AND ($5='ALL' OR p.active=($5='ACTIVE'))
   AND ($6::uuid IS NULL OR $6::uuid=ANY(pp.area_ids))
   ${withInterests?'AND ($7::uuid IS NULL OR $7::uuid=ANY(pp.interest_area_ids))':''}
   ORDER BY p.person_id LIMIT 26`,[org,position,pattern,input.unitId,input.status,input.areaId||null,...(withInterests?[input.interestAreaId||null]:[])])).rows;
  const page=rows.slice(0,25);
  return {areas,items:page.map(row=>({...personProjection(row),areaIds:row.area_ids||[],
   ...(withInterests?{interestAreaIds:row.interest_area_ids||[]}: {})})),nextCursor:rows.length>25?tokens.cursor(page.at(-1).person_id,bind):null};
 }
 async function personWrite(client,method,input,id){
  // The create resource is the organization so a replay retains the same digest.
  const target=id||org;await guarded(method,input,target,[readScope]);
  const prior=await receipt(client,method,input,target);if(prior.previous)return prior.previous;
  let row;
  if(id){row=(await client.query('SELECT * FROM organizational_scope.person WHERE organization_id=$1 AND person_id=$2 FOR UPDATE',[org,id])).rows[0];
   if(!row)fail('RESOURCE_NOT_AVAILABLE');if(Number(row.revision)!==input.expectedRevision)fail('STALE_REVISION');}
  const selected=(await client.query(`SELECT scope_id FROM organizational_scope.scope WHERE organization_id=$1 AND scope_id=ANY($2::uuid[])
   AND scope_type='UNIT' AND lifecycle='ACTIVE' ORDER BY scope_id FOR SHARE`,[org,input.unitIds])).rows;
  if(selected.length!==input.unitIds.length)fail('UNIT_UNAVAILABLE');
  const personId=id||randomUUID();
  row=id?(await client.query(`UPDATE organizational_scope.person SET name=$3,email=$4,function_label=$5,active=$6,revision=revision+1,
   updated_by=$7,updated_at=transaction_timestamp() WHERE organization_id=$1 AND person_id=$2 RETURNING *`,[org,id,input.name,input.email,input.functionLabel,input.active,actor.id])).rows[0]
   :(await client.query(`INSERT INTO organizational_scope.person(organization_id,person_id,name,email,function_label,active,created_by,updated_by)
    VALUES($1,$2,$3,$4,$5,$6,$7,$7) RETURNING *`,[org,personId,input.name,input.email,input.functionLabel,input.active,actor.id])).rows[0];
  await client.query('DELETE FROM organizational_scope.person_unit WHERE organization_id=$1 AND person_id=$2',[org,personId]);
  for(const unitId of input.unitIds)await client.query('INSERT INTO organizational_scope.person_unit(organization_id,person_id,scope_id,is_primary) VALUES($1,$2,$3,$4)',[org,personId,unitId,unitId===input.primaryUnitId]);
  const result={...personProjection(row),unitIds:input.unitIds,primaryUnitId:input.primaryUnitId};
  return finish(client,method,input,target,prior.digest,result);
 }
 async function unitWrite(client,method,input,id,context){
  const dependencies=[readScope];
  const original=createScopeRepository({organizationId:org,identityFactory:{next:randomUUID},participantRegistry:{async beforeArchive(){fail('NOT_AUTHORIZED')}},
   auditWriter:{async append(c,e){await audit(c,{...e,resourceId:e.scopeId,resourceType:'ORGANIZATIONAL_SCOPE'});return {status:'APPENDED'}}}});
  const repository={...original};
  for(const name of ['createScope','renameLabel','reparentScope'])repository[name]=async(c,command)=>{
   const common={organizationId:org,actor:command.actor,provenance:command.provenance};
   const intent=name==='createScope'?{...common,operation:'CREATE',scopeType:command.scopeType,label:command.label,stableCode:command.stableCode,parentScopeId:command.parentScopeId}
    :{...common,operation:name==='renameLabel'?'RENAME_LABEL':'REPARENT',scopeId:command.scopeId,expectedRevision:command.expectedRevision,
      ...(name==='renameLabel'?{label:command.label}:{parentScopeId:command.parentScopeId})};
   await guarded(method,input,id||org,dependencies,{operation:`DIRECTORY_${method.toUpperCase()}`,key:input.idempotencyKey,digest:intentDigest(intent)});return original[name](c,command);
  };
  const service=createPreparedOrganizationalScopeService({organizationId:org,repository,authorization:{async authorize(request,c,target){
   const value=await original.loadAuthorizationResource(c,{resourceType:target.resourceType,resourceId:request.resourceId});
   if(!value||value.status!=='ACTIVE'||value.scopeType==='TEAM')fail('RESOURCE_NOT_AVAILABLE');
   const type=request.operationCode==='ORGANIZATIONAL_SCOPE_CREATE'?'ORGANIZATION':'ORGANIZATIONAL_SCOPE';
   const r={...resource(org,value.id,type,value.scopeType),status:value.status};
   dependencies.push({operationCode:request.operationCode,resource:r});
   return {allowed:await authorize(request.operationCode,r)};
  }}});
  const operation={unitCreate:'CREATE',unitRename:'RENAME_LABEL',unitMove:'REPARENT'}[method];
  const prior=(await client.query('SELECT result_projection FROM organizational_scope.idempotency_record WHERE organization_id=$1 AND operation=$2 AND idempotency_key=$3',[org,operation,input.idempotencyKey])).rows[0];
  const {type,id:actorId,membershipId,membershipVersion,authorizationVersion}=actor;
  const command={...input,correlationId:context.correlationId,actor:{type,id:actorId,membershipId,membershipVersion,authorizationVersion},
   assuranceEvidence:context.assuranceEvidence,provenance:{sourceType:'C4G_DIRECTORY',sourceReference:input.idempotencyKey,observedAt:prior?.result_projection?.provenance?.observedAt||clock.now().toISOString()}};
  if(method==='unitCreate')command.scopeType='UNIT';else command.scopeId=id;
  const result=await service[{unitCreate:'create',unitRename:'renameLabel',unitMove:'reparent'}[method]](client,command);
  return {scopeId:result.scopeId,label:result.label,parentScopeId:result.parentScopeId,stableCode:result.stableCode,lifecycle:result.lifecycle,revision:Number(result.revision)};
 }
 const personal=require('./personalRepository').createPersonalRepository({org,actor,guarded,receipt,finish,memberships,authorize,root,supportsStrategy});
 return {context,units,profileEdit,strategyEdit,descriptionEdit:(c,i)=>profileEdit(c,i,true),people,peopleWithResearchAreas:(c,i)=>people(c,i,true),personWrite,unitWrite,person:(c,i,id)=>personal.read(c,id),self:c=>personal.read(c,null,true),
 personProfileEdit:(c,i,id)=>personal.write(c,'personProfileEdit',i,id),personLinkEdit:(c,i,id)=>personal.write(c,'personLinkEdit',i,id),
 selfEdit:(c,i)=>personal.write(c,'selfEdit',i),memberships:personal.members};
}
module.exports={createDirectoryRepository,resource};
