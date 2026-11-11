'use strict';
const {createHash}=require('node:crypto');
const {NEXT,BASIC_NEXT,fail}=require('./contracts');
const {hydratePageUnits}=require('./interestLink');
const {frozenSnapshotExpressions}=require('./opportunitySnapshot');
const ORDER=Object.freeze({title:'lower(title)',opportunityTitle:'lower(opportunity_title)',status:'current_status',statusChangedAt:'status_changed_at',responsibleName:'lower(responsible_name)',totalBudget:'total_budget',organizationBudget:'organization_budget',opportunityClosingDate:'opportunity_closing_date'});
function fingerprint(alias){
 return `encode(sha256(convert_to(COALESCE(string_agg(encode(sha256(convert_to(to_jsonb(${alias})::text,'UTF8')),'hex'),'' ORDER BY application_id),''),'UTF8')),'hex')`;
}

function selection(org,authority,names,input){
 const frozen=frozenSnapshotExpressions('a.central_snapshot');
 const params=[org,authority.teamOnly,authority.membershipId,authority.application.all,authority.application.ids,
  authority.opportunity.all,authority.opportunity.ids,authority.evaluation.all,authority.evaluation.ids,
  JSON.stringify([...names].map(([id,name])=>({id,name}))),input.opportunityId||null,input.q||''];
 const unitFilter=input.unitId?` AND ${input.unitId==='NONE'?'NOT ':''}EXISTS(SELECT 1 FROM opportunity_catalog.application_unit au WHERE au.organization_id=a.organization_id AND au.application_id=a.application_id AND au.active${input.unitId==='NONE'?'':' AND au.scope_id=$13::uuid'})`:'';
 if(input.unitId&&input.unitId!=='NONE')params.push(input.unitId);
 const sql=`WITH names AS (SELECT * FROM jsonb_to_recordset($10::jsonb) AS n(id uuid,name text)),
 visible AS (
 SELECT a.*,CASE WHEN a.status='INTENTION' THEN 'IDENTIFIED' ELSE a.status END AS current_status,n.name AS responsible_name,
 CASE WHEN a.central_opportunity_id IS NOT NULL THEN ${frozen.title} ELSE o.title END AS opportunity_title,
 CASE WHEN a.central_opportunity_id IS NOT NULL THEN ${frozen.deadline} ELSE o.closing_date::text END AS opportunity_closing_date,
 (SELECT recorded_at FROM opportunity_catalog.application_change h WHERE h.organization_id=a.organization_id AND h.application_id=a.application_id AND h.kind IN ('CREATE','TRANSITION') ORDER BY h.revision DESC LIMIT 1) AS status_changed_at,
 (SELECT recorded_at FROM opportunity_catalog.application_change h WHERE h.organization_id=a.organization_id AND h.application_id=a.application_id AND h.kind='TRANSITION' AND h.to_status='SUBMITTED' ORDER BY h.revision DESC LIMIT 1) AS last_submitted_at
 FROM opportunity_catalog.application a
 LEFT JOIN opportunity_catalog.opportunity o ON o.organization_id=a.organization_id AND o.opportunity_id=a.opportunity_id
 LEFT JOIN names n ON n.id=a.responsible_membership_id
 ${frozen.join}
 WHERE a.organization_id=$1
 AND (NOT $2::boolean OR EXISTS(SELECT 1 FROM opportunity_catalog.application_participant p WHERE p.organization_id=a.organization_id AND p.application_id=a.application_id AND p.membership_id=$3 AND p.active))
 AND ($4::boolean OR a.application_id=ANY($5::uuid[]))
 AND ($6::boolean OR COALESCE(a.opportunity_id,a.organization_id)=ANY($7::uuid[]))
 AND (a.evaluation_id IS NULL OR $8::boolean OR a.evaluation_id=ANY($9::uuid[]))
 AND ($11::uuid IS NULL OR a.opportunity_id=$11 OR a.central_opportunity_id=$11)${unitFilter}
 ), searched AS (SELECT * FROM visible WHERE $12='' OR strpos(lower(title),lower($12))>0 OR strpos(lower(opportunity_title),lower($12))>0 OR strpos(lower(responsible_name),lower($12))>0)`;
 return {sql,params};
}
function projectRow(row,project){return {...project(row),responsibleName:row.responsible_name||null,opportunityTitle:row.opportunity_title||null,opportunityClosingDate:row.opportunity_closing_date||null};}
function createSqlBrowse({org,actor,cursor,guarded,project,readAuthority,responsibleDirectory,transitionCapability}){
 return async function browse(client,input,{report=false}={}){
  await guarded(client,'APPLICATION_READ',org);
  const authority=await readAuthority(),names=await responsibleDirectory();
  const {cursor:token,...filters}=input,bind={organizationId:org,subjectId:actor.id,route:'application-browse-sql-v2',...filters};
  const position=token?cursor.openCursor(token,bind):null;
  if(position&&(!Number.isSafeInteger(position.offset)||position.offset<0||position.offset%25||typeof position.digest!=='string'))fail('INVALID_CURSOR');
  if(input.unitId){const available=(await client.query("SELECT to_regclass('opportunity_catalog.application_unit') IS NOT NULL AS available")).rows[0]?.available;if(!available)fail('SCHEMA_UPGRADE_REQUIRED')}
  const {sql,params}=selection(org,authority,names,input),offset=position?.offset||0,statusParam=params.length+1,limitParam=statusParam+1,offsetParam=statusParam+2;
  const result=(await client.query(`${sql}, filtered AS (SELECT * FROM searched WHERE $${statusParam}::text IS NULL OR current_status=$${statusParam}),
   page AS (SELECT * FROM filtered ORDER BY ${ORDER[input.sort]} ${input.direction==='desc'?'DESC':'ASC'} NULLS LAST,application_id LIMIT $${limitParam} OFFSET $${offsetParam})
   SELECT (SELECT count(*)::int FROM filtered) AS total,
   (SELECT jsonb_object_agg(status,n) FROM (SELECT current_status AS status,count(*)::int AS n FROM searched GROUP BY current_status) counts) AS counts,
   (SELECT ${fingerprint('f')} FROM filtered f) AS fingerprint,
   COALESCE((SELECT jsonb_agg(to_jsonb(page) ORDER BY ${ORDER[input.sort]} ${input.direction==='desc'?'DESC':'ASC'} NULLS LAST,application_id) FROM page),'[]') AS items`,
   [...params,input.status,report?10001:25,offset])).rows[0];
  if(!result||!Array.isArray(result.items))fail('SERVICE_UNAVAILABLE');
  if(report&&result.total>10000)fail('LIMIT_EXCEEDED');
  const countsByStatus={...Object.fromEntries(Object.keys(NEXT).map(s=>[s,0])),...result.counts};
  const digest=createHash('sha256').update(JSON.stringify({fingerprint:result.fingerprint,authority,organizationId:org,subjectId:actor.id})).digest('hex');
  if(!report&&position&&position.digest!==digest)fail('INVALID_CURSOR');
  const rows=report?result.items:await hydratePageUnits(client,org,result.items);
  const items=rows.map(row=>projectRow(row,project));
  if(report)return {items,total:result.total,countsByStatus,digest,organizationId:org};
  for(const row of items)row.allowedTransitions=await transitionCapability(row.applicationId)?[...(row.lifecycleExtended?NEXT:BASIC_NEXT)[row.status]||[]]:[];
  const pointer=n=>cursor.cursor({offset:n,digest},bind);
  return {items,total:result.total,countsByStatus,page:Math.floor(offset/25)+1,pageSize:25,nextCursor:offset+25<result.total?pointer(offset+25):null,previousCursor:offset?pointer(offset-25):null};
 };
}
module.exports={selection,projectRow,createSqlBrowse,fingerprint};
