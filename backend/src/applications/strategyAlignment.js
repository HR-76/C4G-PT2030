'use strict';
const {areas,classify,version}=require('../organizationDirectory/thematicAreas');

const maxPreparation=1000;

// Use the same authorized application population as the dashboard. Read only
// the matching text of each opportunity and retain the central frozen revision.
const alignmentCtes=`
 strategy_objectives AS (
  SELECT COALESCE((SELECT strategy->'objectives' FROM organizational_scope.organization_card
   WHERE organization_id=$1),'[]'::jsonb) AS objectives
 ), strategy_preparation AS (
  SELECT a.application_id AS "applicationId",a.title,
   CASE WHEN snap.body->>'schemaVersion'='2' THEN snap.body#>>'{description,title,value}' ELSE snap.body->>'title' END AS "opportunityTitle",
   CASE WHEN snap.body->>'schemaVersion'='2' THEN snap.body#>>'{description,summary,value}' ELSE snap.body->>'summary' END AS summary,
   CASE WHEN snap.body->>'schemaVersion'='2' THEN snap.body#>>'{eligibility,conditions,value}'
    ELSE COALESCE(snap.body->>'eligibilitySummary',snap.body->>'eligibility') END AS eligibility,
   CASE WHEN snap.body->>'schemaVersion'='2' THEN (
    SELECT string_agg(concept->>'label',' · ' ORDER BY ordinal)
    FROM jsonb_array_elements(CASE WHEN snap.body#>>'{programmes,state}'='PRESENT'
     THEN snap.body#>'{programmes,value}' ELSE '[]'::jsonb END) WITH ORDINALITY AS p(concept,ordinal)
   ) ELSE snap.body->>'programmeName' END AS "programmeName",
   CASE WHEN snap.body->>'schemaVersion'='2' THEN NULL ELSE snap.body->>'funderName' END AS "funderName"
  FROM assigned a
  LEFT JOIN opportunity_catalog.opportunity o ON a.central_opportunity_id IS NULL
   AND o.organization_id=a.organization_id AND o.opportunity_id=a.opportunity_id
  LEFT JOIN opportunity_catalog.revision r ON r.organization_id=o.organization_id
   AND r.opportunity_id=o.opportunity_id AND r.revision_id=o.current_revision_id
  CROSS JOIN LATERAL (SELECT COALESCE(a.central_snapshot,r.snapshot) AS body) snap
  WHERE a.status='PREPARATION'
   AND (SELECT count(*) FROM assigned WHERE status='PREPARATION')<=${maxPreparation}
   AND EXISTS (SELECT 1 FROM strategy_objectives s CROSS JOIN LATERAL jsonb_array_elements(s.objectives) AS g(objective)
    WHERE jsonb_array_length(objective->'areaIds')>0)
 )`;

const alignmentColumns=`(SELECT objectives FROM strategy_objectives) AS strategy_objectives,
 COALESCE((SELECT jsonb_agg(p ORDER BY lower(p.title),p."applicationId") FROM strategy_preparation p),'[]'::jsonb) AS strategy_preparation`;

function strategyAlignment(objectives,preparation,total){
 const goals=objectives.map(({id,title,areaIds})=>({id,title,areaIds,count:0}));
 const configured=new Set(goals.flatMap(goal=>goal.areaIds));
 const result={areaCatalogVersion:version,total,aligned:null};
 if(!configured.size||total===0)return {...result,state:configured.size?'NO_PREPARATION':'NO_OBJECTIVE_AREAS'};
 if(total>maxPreparation||preparation.length!==total)return {...result,state:'UNAVAILABLE'};

 let aligned=0;
 const applications=preparation.map(({applicationId,title,opportunityTitle,...fields})=>{
  const areaIds=classify({title:opportunityTitle,...fields}).map(area=>area.id).filter(id=>configured.has(id));
  if(areaIds.length)aligned++;
  for(const goal of goals){
   if(areaIds.some(id=>goal.areaIds.includes(id)))goal.count++;
  }
  return {applicationId,title,areaIds};
 });
 const areaNames=Object.fromEntries(areas.filter(area=>configured.has(area.id)).map(({id,name})=>[id,name]));
 return {...result,state:'READY',aligned,objectives:goals,applications,areaNames};
}

module.exports={alignmentCtes,alignmentColumns,strategyAlignment};
