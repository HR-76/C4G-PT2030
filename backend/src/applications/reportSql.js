'use strict';
const {createHash,randomUUID}=require('node:crypto');
const {selection,projectRow,fingerprint}=require('./browseSql');
const {workbook}=require('./report');
const {fail}=require('./contracts');
const {alignmentCtes,alignmentColumns,strategyAlignment}=require('./strategyAlignment');
const active="status IN ('IDENTIFIED','INTENTION','PREPARATION','SUBMITTED')";
const submitted="status IN ('SUBMITTED','APPROVED','REJECTED')";
function money(field,where='true'){
 return `jsonb_build_object('count',count(*) FILTER(WHERE ${where}),'missing',count(*) FILTER(WHERE ${where} AND ${field} IS NULL),
 'total',CASE WHEN count(*) FILTER(WHERE ${where})=0 THEN '0.00' ELSE sum(${field}) FILTER(WHERE ${where})::text END)`;
}
const metrics=`jsonb_build_object('total',count(*),'active',count(*) FILTER(WHERE ${active}),
 'submitted',count(*) FILTER(WHERE ${submitted}),'approved',count(*) FILTER(WHERE status='APPROVED'),
 'rejected',count(*) FILTER(WHERE status='REJECTED'),'decisions',count(*) FILTER(WHERE status IN ('APPROVED','REJECTED')),
 'successRate',100.0*count(*) FILTER(WHERE status='APPROVED')/nullif(count(*) FILTER(WHERE status IN ('APPROVED','REJECTED')),0),
 'organizationBudget',${money('organization_budget')},'totalBudget',${money('total_budget')},
 'approvedBudget',${money('organization_budget',"status='APPROVED'")},'submittedBudget',${money('organization_budget',submitted)})`;
function createSqlReport({org,actor,guarded,readAuthority,responsibleDirectory,directory,project,cursor,audit,canReadStrategyAlignment,clock=()=>new Date()}){
 return async function report(client,input,exporting=false){
  await guarded(client,'APPLICATION_READ',org);
  const authority=await readAuthority(),names=await responsibleDirectory(),structure=await directory(client);
  const withAlignment=!exporting&&await canReadStrategyAlignment?.();
  const bind={organizationId:org,subjectId:actor.id,route:'application-report-v2'},position=input.cursor?cursor.openCursor(input.cursor,bind):null;
  if(position&&(!Number.isSafeInteger(position.offset)||position.offset<0||position.offset%25||typeof position.digest!=='string'))fail('INVALID_CURSOR');
  const {sql,params}=selection(org,authority,names,{}),today=require('../organizationDirectory/matching').civilToday(clock());
  const result=(await client.query(`${sql}, assigned AS (SELECT s.*,${structure?'u.scope_id':'NULL::uuid'} AS unit_id FROM searched s
   ${structure?`LEFT JOIN organizational_scope.person_profile pp ON pp.organization_id=s.organization_id AND pp.membership_id=s.responsible_membership_id
   LEFT JOIN organizational_scope.person_unit u ON u.organization_id=pp.organization_id AND u.person_id=pp.person_id AND u.is_primary`:''}
   )${withAlignment?','+alignmentCtes:''},
   approvals AS (SELECT approval.total_budget, to_char(approval.recorded_at AT TIME ZONE 'Europe/Lisbon','YYYY-MM') AS month
    FROM assigned a CROSS JOIN LATERAL (
     SELECT h.total_budget,h.recorded_at FROM opportunity_catalog.application_change h
     WHERE h.organization_id=a.organization_id AND h.application_id=a.application_id AND h.to_status='APPROVED'
       AND h.kind IN ('CREATE','TRANSITION')
     ORDER BY h.revision LIMIT 1
    ) approval),
   approval_periods AS (SELECT COALESCE(month,left(month,4),'all') AS period,${money('total_budget')} AS metric
    FROM approvals GROUP BY GROUPING SETS ((),(left(month,4)),(month))),
   page AS (SELECT * FROM assigned ORDER BY lower(title),application_id LIMIT $13 OFFSET $14)
   SELECT (SELECT ${metrics} FROM assigned) AS metrics,
   (SELECT jsonb_object_agg(period,metric) FROM approval_periods) AS approval_history,
   (SELECT jsonb_object_agg(status,metric) FROM (SELECT current_status AS status,${metrics} AS metric FROM assigned GROUP BY current_status) g) AS states,
   (SELECT jsonb_agg(jsonb_build_object('unitId',unit_id,'metrics',metric)) FROM (SELECT unit_id,${metrics} AS metric FROM assigned GROUP BY unit_id) g) AS units,
   (SELECT ${fingerprint('a')} FROM assigned a) AS fingerprint,
   COALESCE((SELECT jsonb_agg(to_jsonb(page) ORDER BY lower(title),application_id) FROM page),'[]') AS items,
   (SELECT count(*)::int FROM assigned WHERE ${active} AND deadline<=$15::date+30) AS deadline_total,
   COALESCE((SELECT jsonb_agg(d ORDER BY deadline,application_id) FROM
    (SELECT application_id,title,opportunity_title,deadline::text,deadline-$15::date AS days_left FROM assigned
     WHERE ${active} AND deadline<=$15::date+30 ORDER BY deadline,application_id LIMIT 25) d),'[]') AS deadlines${withAlignment?','+alignmentColumns:''}`,
   [...params,exporting?10001:25,position?.offset||0,today])).rows[0];
  if(!result||!Array.isArray(result.items))fail('SERVICE_UNAVAILABLE');
  const units=structure?.units||[],digest=createHash('sha256').update(JSON.stringify({fingerprint:result.fingerprint,authority,org,actor:actor.id,units,unitsAvailable:Boolean(structure)})).digest('hex');
  if(exporting&&input.digest!==digest)fail('STALE_REPORT');
  if(position&&position.digest!==digest)fail('INVALID_CURSOR');
  const offset=position?.offset||0,pointer=n=>cursor.cursor({offset:n,digest},bind);
  const output={organizationId:org,generatedAt:clock().toISOString(),definition:'c4g-dashboard-v1',today,digest,
   total:result.metrics.total,metrics:result.metrics,approvalHistory:result.approval_history,states:result.states||{},unitMetrics:result.units||[],unitsAvailable:Boolean(structure),units,
   items:result.items.map(row=>{const item={...projectRow(row,project),unitId:row.unit_id||null};delete item.notes;return item;}),
   deadlines:result.deadlines.map(row=>({id:row.application_id,title:row.title,opportunity_title:row.opportunity_title,deadline:row.deadline,days_left:row.days_left})),deadlineTotal:result.deadline_total,
   page:offset/25+1,pageSize:25,nextCursor:offset+25<result.metrics.total?pointer(offset+25):null,previousCursor:offset?pointer(offset-25):null};
  if(withAlignment)output.strategyAlignment=strategyAlignment(result.strategy_objectives,result.strategy_preparation,result.states?.PREPARATION?.total||0);
  if(exporting){
   if(output.total>10000)fail('LIMIT_EXCEEDED');
   const content=await workbook(output);if(content.length>900000)fail('LIMIT_EXCEEDED');
   await audit(client,{eventCode:'EXPORT_ALLOWED',operationCode:'APPLICATION_READ',resourceId:org,resourceType:'APPLICATION',idempotencyKey:randomUUID(),auditPrefix:'APP_REPORT'});
   return {content,generatedAt:output.generatedAt};
  }
  if(Buffer.byteLength(JSON.stringify(output),'utf8')>900000){
   if(output.strategyAlignment?.state!=='READY')fail('LIMIT_EXCEEDED');
   const {total,areaCatalogVersion}=output.strategyAlignment;
   output.strategyAlignment={state:'UNAVAILABLE',total,aligned:null,areaCatalogVersion};
   if(Buffer.byteLength(JSON.stringify(output),'utf8')>900000)fail('LIMIT_EXCEEDED');
  }
  return output;
 };
}
module.exports={createSqlReport,metrics};
