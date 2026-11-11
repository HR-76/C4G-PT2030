'use strict';
const {createOpportunityReadModel}=require('../opportunities/v2/readModel');
const {jsonbBytes}=require('../opportunities/v2/data');
const {fail}=require('./contracts');
const value=fact=>fact?.state==='PRESENT'?fact.value:null;
const labels=fact=>(value(fact)||[]).map(item=>typeof item==='string'?item:item.label).filter(Boolean).join(' · ')||null;

// Read the original frozen source revision. Never replace it with a fabricated
// v1 snapshot or a changing current revision of the catalogue.
function describeFrozenOpportunity(snapshot,{revisionId=null,asOf=new Date().toISOString()}={}){
 if(snapshot?.schemaVersion!==2)return {title:snapshot?.title||null,closingDate:snapshot?.closingDate||null,
  openingDate:snapshot?.openingDate||null,officialUrl:snapshot?.officialUrl||null,
  programmeName:snapshot?.programmeName||null,callReference:snapshot?.callReference||null};
 const readModel=createOpportunityReadModel(snapshot,{revisionId,asOf}),p=readModel.projection;
 const closing=readModel.temporal.finalDeadline?.at;
 const references=value(readModel.identity.references)||[];
 return {title:value(p.description.title),closingDate:closing&&['DATE','INSTANT'].includes(closing.precision)?closing.value:null,
  openingDate:value(p.schedule.opening)?.value||null,officialUrl:value(p.links.official),programmeName:labels(p.programmes),
  callReference:references.filter(item=>['CALL_REFERENCE','PLAN_ID'].includes(item.kind)).map(item=>item.value).join(' · ')||null,readModel};
}

function centralLifecycle(snapshot,current){
 if(snapshot?.schemaVersion!==2)return snapshot?.lifecycleState;
 if(!current||!['DRAFT','ACTIVE','STALE','ARCHIVED'].includes(current.lifecycleState))fail('RESOURCE_NOT_AVAILABLE');
 return current.lifecycleState;
}

function assertApplicationSnapshotFits(snapshot,{v2=false}={}){
 // Capacity is observed by the repository from installed schema, never accepted
 // from an HTTP input. Historical v1 keeps its original bound after expansion.
 const limit=v2===true&&snapshot?.schemaVersion===2?262144:32768;
 try{if(jsonbBytes(snapshot)<=limit)return;}catch{}
 fail('SCHEMA_UPGRADE_REQUIRED');
}

function frozenSnapshotExpressions(snapshot,{finalDeadlineOnly=false}={}){
 if(typeof snapshot!=='string'||!/^\w+\.\w+$/.test(snapshot))throw new TypeError('Trusted snapshot column required');
 const v2=`${snapshot}->>'schemaVersion'='2'`;
 const title=require('../opportunities/v2/catalogSql').titleExpression(snapshot,`${snapshot}->>'title'`);
 const deadline=`CASE WHEN ${v2} THEN v2_schedule.final_deadline ELSE ${snapshot}->>'closingDate' END`;
 const {civilDateSql,instantSql,temporalV2Sql,finalDeadlineV2Sql}=require('../opportunities/v2/temporalSql');
 const dateValue="v2_schedule.final_deadline_at->>'value'";
 const deadlineDate=`CASE WHEN ${v2} THEN CASE v2_schedule.final_deadline_at->>'precision' WHEN 'INSTANT' THEN (${instantSql(dateValue)} AT TIME ZONE 'Europe/Lisbon')::date WHEN 'DATE' THEN ${civilDateSql(dateValue)} ELSE NULL::date END ELSE left(${snapshot}->>'closingDate',10)::date END`;
 // PostgreSQL's 1 BC is ISO year 0000. Keep the notification text canonical
 // while computing its day difference with native DATE, never recasting ISO 0000.
 const nativeYear=`extract(year FROM (${deadlineDate}))::int`;
 const deadlineDay=`CASE WHEN ${nativeYear}<0 THEN CASE WHEN ${nativeYear}=-1 THEN '0000' ELSE '-'||lpad((-(${nativeYear}+1))::text,6,'0') END||to_char((${deadlineDate}),'-MM-DD') ELSE to_char((${deadlineDate}),'YYYY-MM-DD') END`;
 return {title,deadline,deadlineDay,deadlineDate,join:(finalDeadlineOnly?finalDeadlineV2Sql:temporalV2Sql)({snapshot})};
}

module.exports={describeFrozenOpportunity,centralLifecycle,assertApplicationSnapshotFits,frozenSnapshotExpressions};
