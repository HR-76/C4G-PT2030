'use strict';
const {readOpportunitySnapshot}=require('./compatibility');
const {projectTemporalV2}=require('./temporal');
const {instant}=require('./normalization');
const {deepFreeze}=require('./data');
const {temporalState}=require('../temporal');
const VERSION='opportunity-read-v2.0';
const MAX_LIST_BYTES=1024*1024,MAX_DETAIL_BYTES=512*1024;
function fail(){throw Object.assign(new Error('OPPORTUNITY_READ_LIMIT_EXCEEDED'),{code:'OPPORTUNITY_READ_LIMIT_EXCEEDED'});}
const bytes=value=>Buffer.byteLength(JSON.stringify(value),'utf8');
const absent=reason=>({state:'NOT_COLLECTED',value:null,candidates:[],complete:false,representation:null,sourcePaths:[],reason});
function legacyTemporal(snapshot,{asOf,corrections,sourceReview}){
 const value=temporalState(snapshot,asOf,corrections,sourceReview);
 const raw=!Object.hasOwn(corrections,'closingDate')&&snapshot.sourceTemporal?.deadlines?.length?snapshot.sourceTemporal.deadlines:snapshot.closingDate?[snapshot.closingDate]:[];
 // v1 validation intentionally accepts historical offset/24:00 forms. Apply
 // its Date semantics only to this calculation; original values stay above in
 // the legacy projection and snapshot, never subjected to stricter v2 input rules.
 const typed=date=>({at:date.length===10?{precision:'DATE',value:date}:{precision:'INSTANT',value:new Date(date).toISOString()},phase:null});
 const deadlines=[...new Set(raw)].sort((a,b)=>Date.parse(a)-Date.parse(b));
 const next=value.nextDeadline?typed(value.nextDeadline):null,final=deadlines.length?typed(deadlines.at(-1)):null;
 const precisions=new Set(deadlines.map(d=>d.length===10?'DATE_ONLY':'EXACT'));
 return {asOf,effectiveState:value.state,publishedState:value.publishedState,publishedCode:snapshot.sourceTemporal?.statusCode||null,
  nextDeadline:next,nextDeadlineCandidates:next?[next]:[],finalDeadline:final,finalDeadlineCandidates:final?[final]:[],
  precision:precisions.size>1?'MIXED':precisions.values().next().value||'UNKNOWN',reasonCodes:['LEGACY_TEMPORAL_SEMANTICS']};
}
function qualityFor(read,sourceReview){
 const fieldStates=Object.fromEntries(['PRESENT','NOT_FOUND','NOT_COLLECTED','NOT_APPLICABLE','CONFLICT','UNSUPPORTED'].map(state=>[state,0]));
 let totalFields=0,completeFields=0;
 const nestedIssues=[];
 function walk(value,path=''){
  if(!value||typeof value!=='object')return;
  if(Object.hasOwn(fieldStates,value.state)&&Object.hasOwn(value,'value')){
   totalFields++;fieldStates[value.state]++;
   if(value.complete===true||value.complete===undefined&&['PRESENT','NOT_FOUND','NOT_APPLICABLE'].includes(value.state))completeFields++;
   if(['CONFLICT','UNSUPPORTED'].includes(value.state))nestedIssues.push({code:'FIELD_'+value.state,field:path});
   walk(value.value,path+'/value');return;
  }
  for(const [key,child] of Object.entries(value))if(key!=='legacy')walk(child,path+'/'+key);
 }
 walk(read.projection);
 const issues=read.sourceVersion===2?read.snapshot.quality.issues.map(({code,field})=>({code,field})):read.warnings.map(({code,path})=>({code,field:path}));
 issues.push(...nestedIssues);
 if(sourceReview)issues.push({code:'SOURCE_REVIEW_REQUIRED',field:'/sourceRecords'});
 return {ruleVersion:'opportunity-read-quality-v2.0',fieldStates,totalFields,completeFields,
  reviewRequired:Boolean(sourceReview||issues.length||fieldStates.NOT_COLLECTED||fieldStates.CONFLICT||fieldStates.UNSUPPORTED),
  issues,coverage:read.sourceVersion===2?read.snapshot.provenance.observations.map(({sourceRecordKey,coverage})=>({sourceRecordKey,coverage})):[],verification:'NOT_CERTIFIED'};
}
// `prepared` is the result of prepareOpportunitySnapshot for this same snapshot.
// It lets a caller validate an immutable revision once and reuse it across reads.
const prepareOpportunitySnapshot=readOpportunitySnapshot;
function createOpportunityReadModel(snapshot,{revisionId=null,asOf,observedAt=null,sourceReview=null,corrections={},prepared=null}={}){
 if(instant(asOf)!==asOf)throw new TypeError('A canonical UTC reference time is required.');
 const read=prepared||readOpportunitySnapshot(snapshot),version=read.sourceVersion;
 const temporal=version===2?{...projectTemporalV2(read.snapshot,{asOf})}:legacyTemporal(read.snapshot,{asOf,corrections,sourceReview});
 if(sourceReview){temporal.effectiveState='UNKNOWN';temporal.reasonCodes=[...temporal.reasonCodes,'SOURCE_REVIEW_REQUIRED'];}
 const sourceRecords=version===2?read.snapshot.sourceRecords:[];
 const identity=version===2?{kind:read.snapshot.identity.kind,references:{...read.snapshot.identity.references,candidates:[],complete:['PRESENT','NOT_FOUND','NOT_APPLICABLE'].includes(read.snapshot.identity.references.state),representation:'v2',sourcePaths:['/identity/references']}}
  :{kind:null,references:read.snapshot.callReference?{state:'PRESENT',value:[{kind:'CALL_REFERENCE',value:read.snapshot.callReference}],candidates:[],complete:true,representation:'v1-core',sourcePaths:['/callReference'],reason:null}:absent('NO_LEGACY_OBSERVATION')};
 const observation=observedAt?instant(observedAt):version===2?[...read.snapshot.provenance.observations].map(o=>o.observedAt).sort().at(-1)||null:read.snapshot.sourceEnrichment?.observedAt||null;
 const quality=qualityFor(read,sourceReview);
 const ageSeconds=observation?Math.floor((Date.parse(asOf)-Date.parse(observation))/1000):null;
 if(ageSeconds!==null&&ageSeconds<0){quality.reviewRequired=true;quality.issues.push({code:'SOURCE_OBSERVATION_IN_FUTURE',field:'/sourceRecords'});}
 return deepFreeze({version:VERSION,sourceVersion:version,revisionId,asOf,identity,sourceRecords,projection:read.projection,
  temporal,quality,warnings:read.warnings,freshness:{observedAt:observation,ageSeconds,sourceReview}});
}

// Dynamic page size keeps all returned facts intact and resumes at the last
// emitted identity. A single excessive item fails rather than being truncated.
function boundedCatalogPage(rows,{programmes=[],asOf,interventionAreas}={}){
 const items=[];
 const areaMetadata=interventionAreas?{interventionAreas}:{};
 // Same size as serializing the growing envelope, without serializing it per item.
 const emptyEnvelope=bytes({...areaMetadata,items:[],programmes,nextCursor:'',asOf});
 let itemBytes=0;
 for(const row of rows.slice(0,25)){
  const size=itemBytes+bytes(row)+(items.length?1:0);
  if(emptyEnvelope+size+bytes(row.opportunityId)-2>MAX_LIST_BYTES-4096){if(!items.length)fail();break;}
  items.push(row);itemBytes=size;
 }
 const result={...areaMetadata,items,programmes,nextCursor:rows.length>items.length?items.at(-1)?.opportunityId||null:null,asOf};
 if(bytes(result)>MAX_LIST_BYTES-4096)fail();
 return result;
}
function assertDetailSize(value){if(bytes(value)>MAX_DETAIL_BYTES-4096)fail();return value;}
module.exports={createOpportunityReadModel,prepareOpportunitySnapshot,boundedCatalogPage,assertDetailSize,VERSION,MAX_LIST_BYTES,MAX_DETAIL_BYTES};
