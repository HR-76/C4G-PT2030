'use strict';
const {temporalSql}=require('../opportunities/temporalSql');
const {civilDateSql}=require('../opportunities/v2/temporalSql');
const {instant}=require('../opportunities/v2/normalization');
async function opportunitySummary(client,{organizationId=null,today,central=false,asOf}){
 if(asOf!==undefined&&(instant(asOf)!==asOf||asOf.slice(0,10)!==today))throw new TypeError('Invalid dashboard reference instant');
 const values=central?[today]:[today,organizationId];
 if(asOf!==undefined)values.push(asOf);
 const now=asOf===undefined?'CURRENT_TIMESTAMP':`$${values.length}::timestamptz`;
 const source=central?"CASE WHEN r.snapshot->>'schemaVersion'='2' THEN CASE WHEN (SELECT count(DISTINCT record->>'namespace') FROM jsonb_array_elements(r.snapshot->'sourceRecords') record)=1 THEN (SELECT min(record->>'namespace') FROM jsonb_array_elements(r.snapshot->'sourceRecords') record) ELSE 'MULTIPLE_SOURCES' END WHEN f.external_identifier IS NULL THEN 'C4G_MANUAL' WHEN f.external_identifier ~ '^(INTERREG_EUROPE|POCTEP):2021-2027:CALL:[1-9][0-9]{0,2}$' THEN split_part(f.external_identifier,':',1) ELSE 'EU_FUNDING_TENDERS' END":"'Registo privado'";
 const result=(await client.query(`WITH catalog AS (
  SELECT o.opportunity_id,CASE WHEN r.snapshot->>'schemaVersion'='2' THEN r.snapshot#>>'{description,title,value}' ELSE o.title END AS title,
  CASE WHEN r.snapshot->>'schemaVersion'='2' THEN ${civilDateSql('left(schedule.next_deadline,10)')} ELSE COALESCE(left(schedule.next_deadline,10)::date,o.closing_date) END AS closing_date,o.lifecycle_state,temporal.temporal_state,${source} AS source
  FROM opportunity_catalog.opportunity o
  JOIN opportunity_catalog.revision r ON r.revision_id=o.current_revision_id
  ${central?'LEFT JOIN opportunity_catalog.funding_identity f ON f.opportunity_id=o.opportunity_id':''}
  ${temporalSql({corrections:central?'f.corrections':"'{}'::jsonb",sourceReview:central?"to_jsonb(f)->>'source_review'":'NULL::text',now})}
  ${central?'':"WHERE o.organization_id=$2 AND o.lifecycle_state='ACTIVE'"}
 ), current AS (SELECT * FROM catalog WHERE lifecycle_state='ACTIVE' AND temporal_state='OPEN')
 SELECT (SELECT count(*)::int FROM catalog) AS total,(SELECT count(*)::int FROM current) AS open,
 (SELECT count(*)::int FROM current WHERE closing_date<=$1::date+14) AS closing_soon,
 ${['UPCOMING','PLANNED','CLOSED','CANCELLED','UNKNOWN'].map(state=>`(SELECT count(*)::int FROM catalog WHERE lifecycle_state='ACTIVE' AND temporal_state='${state}') AS ${state.toLowerCase()}`).join(',')},
 COALESCE((SELECT jsonb_agg(s ORDER BY source) FROM (SELECT source,count(*)::int AS total,count(*) FILTER(WHERE lifecycle_state='ACTIVE' AND temporal_state='OPEN')::int AS open FROM catalog GROUP BY source) s),'[]') AS sources,
 COALESCE((SELECT jsonb_agg(r ORDER BY closing_date,opportunity_id) FROM (SELECT opportunity_id,title,source,closing_date::text FROM current ORDER BY closing_date,opportunity_id LIMIT 10) r),'[]') AS recent`,values)).rows[0];
 const root=central?'/catalogo':'/oportunidades';
 return {...result,recent:result.recent.map(row=>({id:`${root}:${row.opportunity_id}`,title:row.title,source:row.source,closing_date:row.closing_date,href:`${root}/${row.opportunity_id}`}))};
}
module.exports={opportunitySummary};
