'use strict';
// All arguments are trusted SQL fragments from composition, never request text.
const isV2=snapshot=>`(${snapshot}->>'schemaVersion'='2')`;
function titleExpression(snapshot='r.snapshot',fallback='o.title'){
 return `CASE WHEN ${isV2(snapshot)} THEN ${snapshot}#>>'{description,title,value}' ELSE ${fallback} END`;
}
function programmeLabelsExpression(snapshot='r.snapshot',fallback='o.programme_name'){
 return `CASE WHEN ${isV2(snapshot)} THEN CASE WHEN ${snapshot}#>>'{programmes,state}'='PRESENT' THEN COALESCE((SELECT jsonb_agg(p->>'label') FROM jsonb_array_elements(${snapshot}#>'{programmes,value}') p),'[]'::jsonb) ELSE '[]'::jsonb END
 WHEN ${snapshot}#>>'{sourceEnrichment,fields,programme,status}'='PUBLISHED' THEN COALESCE((SELECT jsonb_agg(p#>>'{value,label}') FROM jsonb_array_elements(${snapshot}#>'{sourceEnrichment,fields,programme,items}') p),'[]'::jsonb)
 WHEN ${snapshot}->'sourceEnrichment' IS NOT NULL THEN '[]'::jsonb
 WHEN ${fallback} IS NOT NULL THEN jsonb_build_array(${fallback}) ELSE '[]'::jsonb END`;
}
function referenceValuesExpression(snapshot='r.snapshot',fallback='o.call_reference'){
 return `CASE WHEN ${isV2(snapshot)} THEN CASE WHEN ${snapshot}#>>'{identity,references,state}'='PRESENT' THEN COALESCE((SELECT jsonb_agg(p->>'value') FROM jsonb_array_elements(${snapshot}#>'{identity,references,value}') p),'[]'::jsonb) ELSE '[]'::jsonb END
 WHEN ${fallback} IS NOT NULL THEN jsonb_build_array(${fallback}) ELSE '[]'::jsonb END`;
}
function sourceExpression(snapshot='r.snapshot',fallback="'C4G_MANUAL'"){
 return `CASE WHEN ${isV2(snapshot)} THEN (SELECT CASE WHEN count(DISTINCT s->>'namespace')=1 THEN min(s->>'namespace') ELSE 'MULTIPLE_SOURCES' END FROM jsonb_array_elements(${snapshot}->'sourceRecords') s) ELSE ${fallback} END`;
}
module.exports={isV2,titleExpression,programmeLabelsExpression,referenceValuesExpression,sourceExpression};
