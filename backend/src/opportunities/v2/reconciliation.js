'use strict';
const {createHash}=require('node:crypto');
const {cloneData,deepFreeze}=require('./data');
const {validateSnapshotV2}=require('./validation');
const {readOpportunitySnapshot}=require('./compatibility');
const {contentDigestV2,compareSnapshotsV2}=require('./digests');
const VERSION='opportunity-reconciliation-v2.0',MAX_ITEMS=1000;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const DIGEST=/^[a-f0-9]{64}$/;
const ACTIONS=['UNCHANGED','NEW','CHANGE_REQUIRES_APPROVAL','BLOCKED'];
const compareText=(left,right)=>left<right?-1:left>right?1:0;
const canonical=value=>Array.isArray(value)?'['+value.map(canonical).join(',')+']':value&&typeof value==='object'?'{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+canonical(value[key])).join(',')+'}':JSON.stringify(value);
const hash=(domain,value)=>createHash('sha256').update('C4G:'+domain+'\0').update(canonical(value)).digest('hex');
const rawSnapshotDigest=snapshot=>hash('OPPORTUNITY:RAW-SNAPSHOT:v2',snapshot);
function fail(){throw Object.assign(new TypeError('Opportunity reconciliation input is invalid.'),{code:'OPPORTUNITY_RECONCILIATION_INVALID'});}
function exact(value,required,optional=[]){if(!value||Array.isArray(value)||typeof value!=='object'||required.some(k=>!Object.hasOwn(value,k))||Object.keys(value).some(k=>![...required,...optional].includes(k)))fail();}
function identity(value){
 exact(value,['namespace','externalId']);
 if(typeof value.namespace!=='string'||! /^[A-Z][A-Z0-9_]{0,63}$/.test(value.namespace)||typeof value.externalId!=='string'||!value.externalId||value.externalId!==value.externalId.trim()||value.externalId.length>512)fail();
 return value;
}
const identityKey=value=>JSON.stringify([value.namespace,value.externalId]);
const snapshotIdentities=snapshot=>snapshot.sourceRecords.filter(x=>x.role!=='PROGRAMME_METADATA').map(({namespace,externalId})=>({namespace,externalId}));
function identities(values){
 if(!Array.isArray(values)||!values.length||values.length>64)fail();
 const map=new Map(values.map(value=>{const item=identity(value);return [identityKey(item),item];}));
 if(map.size!==values.length)fail();
 return [...map.entries()].sort(([a],[b])=>compareText(a,b)).map(([,value])=>value);
}
const populated=value=>Array.isArray(value)?value.length>0:value&&typeof value==='object'?Object.keys(value).length>0:Boolean(value);
function conflictPaths(value,path='',result=[]){
 if(!value||typeof value!=='object')return result;
 if(value.state==='CONFLICT'&&Object.hasOwn(value,'evidenceRefs'))result.push(path);
 for(const [key,child]of Object.entries(value))conflictPaths(child,path+'/'+key,result);
 return result;
}
function acceptedRecord(value){
 exact(value,['opportunityId','revisionId','rowVersion','snapshot'],['identities','mappingDigest','corrections','resolutions','privateReferences']);
 if(!UUID.test(value.opportunityId)||!UUID.test(value.revisionId)||!Number.isSafeInteger(value.rowVersion)||value.rowVersion<1||value.mappingDigest!=null&&!DIGEST.test(value.mappingDigest))fail();
 const read=readOpportunitySnapshot(value.snapshot);
 const sourceIdentities=identities(value.identities|| (read.sourceVersion===2?snapshotIdentities(read.snapshot):[]));
 const protectedState={corrections:value.corrections||{},resolutions:value.resolutions||[],privateReferences:value.privateReferences||[],historicalSourceResolution:read.sourceVersion===1?read.snapshot.sourceResolution||null:null};
 if(!protectedState.corrections||Array.isArray(protectedState.corrections)||typeof protectedState.corrections!=='object'||!protectedState.resolutions||typeof protectedState.resolutions!=='object'||!Array.isArray(protectedState.privateReferences))fail();
 return {...value,snapshot:read.snapshot,identities:sourceIdentities,protectedState,binding:{opportunityId:value.opportunityId,revisionId:value.revisionId,rowVersion:value.rowVersion,schemaVersion:read.sourceVersion,
  snapshotDigest:rawSnapshotDigest(read.snapshot),contentDigest:read.sourceVersion===2?contentDigestV2(read.snapshot):null,mappingDigest:value.mappingDigest||null,
  protectedStateDigest:hash('OPPORTUNITY:PROTECTED-STATE:v2',protectedState)}};
}
function candidateRecord(value){
 exact(value,['candidateId','snapshot','mappingDigest']);
 if(typeof value.candidateId!=='string'||!value.candidateId||value.candidateId.length>128||!DIGEST.test(value.mappingDigest))fail();
 const snapshot=validateSnapshotV2(value.snapshot);
 return {...value,snapshot,identities:identities(snapshotIdentities(snapshot)),binding:{candidateId:value.candidateId,contentDigest:contentDigestV2(snapshot),snapshotDigest:rawSnapshotDigest(snapshot),mappingDigest:value.mappingDigest,mappingVersion:snapshot.provenance.mappingVersion}};
}

// Pure preview only. Identity links are supplied by trusted persisted records or
// explicit evidence-backed decisions. Neither titles nor timing creates a link.
// Every proposed write remains subject to a fresh server approval/CAS workflow.
function previewReconciliation(raw){
 const input=cloneData(raw,{maxBytes:32*1024*1024,maxDepth:40});
 exact(input,['accepted','candidates'],['aliases']);
 if(!Array.isArray(input.accepted)||!Array.isArray(input.candidates)||input.accepted.length>MAX_ITEMS||input.candidates.length>MAX_ITEMS)fail();
 const accepted=input.accepted.map(acceptedRecord),candidates=input.candidates.map(candidateRecord);
 if(new Set(accepted.map(x=>x.opportunityId)).size!==accepted.length||new Set(candidates.map(x=>x.candidateId)).size!==candidates.length)fail();
 const aliases=input.aliases||[];if(!Array.isArray(aliases)||aliases.length>MAX_ITEMS)fail();
 const aliasMap=new Map();
 for(const alias of aliases){
  exact(alias,['from','to','decisionId','evidenceDigest','relation']);identity(alias.from);identity(alias.to);
  if(!UUID.test(alias.decisionId)||!DIGEST.test(alias.evidenceDigest)||alias.relation!=='SAME_OPPORTUNITY')fail();
  const key=identityKey(alias.from);if(aliasMap.has(key))fail();aliasMap.set(key,alias);
 }
 function resolve(source){
  let key=identityKey(source);const visited=new Set(),decisions=[];
  while(aliasMap.has(key)){
   if(visited.has(key))return {key,decisions,cycle:true};
   visited.add(key);const alias=aliasMap.get(key);decisions.push(alias.decisionId);key=identityKey(alias.to);
  }
  return {key,decisions,cycle:false};
 }
 const acceptedIndex=new Map(),candidateIndex=new Map(),candidateAcceptedIndex=new Map(),seen=new Set();
 for(const record of accepted)for(const source of record.identities){const resolved=resolve(source);if(!acceptedIndex.has(resolved.key))acceptedIndex.set(resolved.key,new Set());acceptedIndex.get(resolved.key).add(record);}
 for(const record of candidates)for(const source of record.identities){const resolved=resolve(source);if(!candidateIndex.has(resolved.key))candidateIndex.set(resolved.key,new Set());candidateIndex.get(resolved.key).add(record.candidateId);}
 for(const record of candidates)for(const source of record.identities)for(const match of acceptedIndex.get(resolve(source).key)||[]){
  if(!candidateAcceptedIndex.has(match.opportunityId))candidateAcceptedIndex.set(match.opportunityId,new Set());candidateAcceptedIndex.get(match.opportunityId).add(record.candidateId);
 }
 const items=candidates.map(record=>{
  const reasons=new Set(),resolved=record.identities.map(resolve),matches=new Set();
  for(const source of resolved){
   if(source.cycle)reasons.add('ALIAS_CYCLE');
   if((candidateIndex.get(source.key)?.size||0)>1)reasons.add('DUPLICATE_CANDIDATE_IDENTITY');
   for(const match of acceptedIndex.get(source.key)||[])matches.add(match);
  }
  for(const match of matches)seen.add(match.opportunityId);
  if(matches.size>1)reasons.add('AMBIGUOUS_ACCEPTED_IDENTITY');
  const current=matches.size===1?[...matches][0]:null;
  if(current&&candidateAcceptedIndex.get(current.opportunityId).size>1)reasons.add('MULTIPLE_CANDIDATES_FOR_ACCEPTED_IDENTITY');
  if(current&&resolved.some(source=>!current.identities.some(value=>resolve(value).key===source.key)))reasons.add('UNPROVEN_IDENTITY_LINK');
  const conflictFields=conflictPaths(record.snapshot);
  if(conflictFields.length)reasons.add('UNRESOLVED_CONFLICT');
  if(record.snapshot.quality.issues.some(issue=>issue.code==='OFFICIAL_DOCUMENT_TIME_CONFLICT_REQUIRES_REVIEW'))reasons.add('OFFICIAL_DOCUMENT_CONFLICT');
  let action='NEW',changedFields=[],retainedFields=[];
  if(current){
   if(current.snapshot.schemaVersion===1){action='CHANGE_REQUIRES_APPROVAL';reasons.add('LEGACY_MIGRATION_REQUIRES_REVIEW');changedFields=['/schemaVersion'];}
   else{
    const comparison=compareSnapshotsV2(current.snapshot,record.snapshot);
    action=comparison.changed?'CHANGE_REQUIRES_APPROVAL':'UNCHANGED';changedFields=comparison.changedFields;retainedFields=comparison.retainedFields;
    for(const reason of comparison.reasonCodes)if(reason!=='SOURCE_IDENTITY_CHANGED')reasons.add(reason);
    if(!comparison.sameIdentity){action='CHANGE_REQUIRES_APPROVAL';reasons.add('EXPLICIT_ALIAS_REQUIRES_REVIEW');}
   }
   if(current.binding.mappingDigest!==record.mappingDigest){action='CHANGE_REQUIRES_APPROVAL';reasons.add(current.binding.mappingDigest?'MAPPING_IMPLEMENTATION_CHANGED':'MAPPING_BASELINE_UNAVAILABLE');}
   if(action!=='UNCHANGED'){
    if(populated(current.protectedState.corrections))reasons.add('EDITORIAL_CORRECTIONS_REQUIRE_REVIEW');
    if(populated(current.protectedState.resolutions)||populated(current.protectedState.historicalSourceResolution))reasons.add('SOURCE_RESOLUTION_REQUIRES_REVIEW');
   }
  }
  const reviewOnly=new Set(['LEGACY_MIGRATION_REQUIRES_REVIEW','MAPPING_IMPLEMENTATION_CHANGED','MAPPING_BASELINE_UNAVAILABLE','EXPLICIT_ALIAS_REQUIRES_REVIEW']);
  if([...reasons].some(reason=>!reviewOnly.has(reason)))action='BLOCKED';
  const item={candidateId:record.candidateId,action,canReplaceAccepted:false,identities:record.identities,accepted:current?.binding||null,candidate:record.binding,
   aliasDecisionIds:[...new Set(resolved.flatMap(x=>x.decisions))].sort(),changedFields,retainedFields,conflictFields:conflictFields.sort(),reasonCodes:[...reasons].sort()};
  return {...item,itemDigest:hash('OPPORTUNITY:RECONCILIATION-ITEM:v2',item)};
 }).sort((a,b)=>compareText(a.candidateId,b.candidateId));
 const counts=Object.fromEntries(ACTIONS.map(action=>[action,items.filter(item=>item.action===action).length]));
 const result={version:VERSION,counts,totalCandidates:candidates.length,totalAccepted:accepted.length,items,canDeleteAccepted:false,
  unseenAcceptedOpportunityIds:accepted.filter(x=>!seen.has(x.opportunityId)).map(x=>x.opportunityId).sort()};
 // Bind even unmatched accepted rows and alias evidence: changing the catalogue,
 // protected metadata or a decision invalidates approval for this exact preview.
 const approvalInput={...result,acceptedBindings:accepted.map(x=>({binding:x.binding,identities:x.identities})).sort((a,b)=>compareText(a.binding.opportunityId,b.binding.opportunityId)),
  aliases:[...aliases].sort((a,b)=>compareText(identityKey(a.from),identityKey(b.from)))};
 return deepFreeze({...result,previewDigest:hash('OPPORTUNITY:RECONCILIATION-PREVIEW:v2',approvalInput)});
}
module.exports={VERSION,previewReconciliation,rawSnapshotDigest};
