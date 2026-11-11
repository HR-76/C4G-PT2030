'use strict';
// Read-time presentation only: canonical revisions, projections and IDs stay immutable.
const fs=require('node:fs'),path=require('node:path'),{createHash}=require('node:crypto');
const {buildEvidence}=require('../../fundingTenders/sourceEvidence');
const {adaptEuOpportunityV2}=require('../../fundingTenders/adapterV2');
const {contentDigestV2}=require('../v2/digests');
const {sourceDescription}=require('../../fundingTenders/sourceDescription');
const {loadArchivedDescription}=require('./archivedDescription');
const manifest=require('./storedEvidence.manifest.json');
const sha=value=>createHash('sha256').update(value).digest('hex');
const unavailable=()=>({value:null,source:'unavailable',sourceUrl:null,sourcePointer:null});
function value(text,source,sourceUrl,sourcePointer){
 if(typeof text!=='string'||!text.trim())return unavailable();
 const clean=text.trim();return {value:clean.length>8000?clean.slice(0,7950)+' … [Consultar fonte completa]':clean,source,sourceUrl:sourceUrl||null,sourcePointer};
}
const present=fact=>fact?.state==='PRESENT'?fact.value:null;
const concept=item=>typeof item==='string'?item:item?.label||'';
const concepts=fact=>(present(fact)||[]).map(concept).filter(Boolean).join(' · ');
function canonicalPresentation(projection){
 const snapshot=projection.inputs.snapshot,url=snapshot.sourceRecords[0]?.url||null;
 const canonical=(text,pointer)=>value(text,'canonical',url,pointer);
 const nature=present(snapshot.classification.callNature);
 const inferredKind=snapshot.identity.kind==='CASCADE_CALL'?canonical('Financiamento em cascata','/identity/kind'):present(snapshot.publication)==='PLANNED'?canonical('Aviso planeado','/publication/value'):unavailable();
 const objectives=(present(snapshot.classification.specificObjectives)||[]).map(item=>[item.code,item.label].filter(Boolean).join(' — ')).join(' · ');
 const themes=concepts(snapshot.classification.themes);
 const topics=(present(snapshot.identity.references)||[]).filter(item=>item.kind==='TOPIC_REFERENCE').map(item=>item.value).join(' · ');
 const territories=(present(snapshot.eligibility.territories)||[]).map(item=>concept(item.concept)+(item.scope==='UNSPECIFIED'?' (âmbito não especificado)':'')).join(' · ');
 return {
  presentation:{
   typification:nature?canonical(concept(nature),'/classification/callNature/value'):inferredKind,
   areas:themes?canonical(themes,'/classification/themes/value'):objectives?canonical('Objetivo específico: '+objectives,'/classification/specificObjectives/value'):unavailable(),
  },
  callInformation:{
   topic:topics?canonical(topics,'/identity/references/value'):objectives?canonical('Objetivo específico: '+objectives,'/classification/specificObjectives/value'):unavailable(),
   eligibleCandidates:canonical(concepts(snapshot.eligibility.beneficiaryTypes),'/eligibility/beneficiaryTypes/value'),
   duration:unavailable(),location:canonical(territories,'/eligibility/territories/value'),
  },
 };
}
function loadPresentation(directory=path.resolve(__dirname,'../../../../context/references/opportunity-v2/evidence')){
 const describeArchive=loadArchivedDescription(directory),documents={};
 for(const name of ['eu-11145.json','eu-11145.metadata.json']){
  const bytes=fs.readFileSync(path.join(directory,name));
  if(sha(bytes)!==manifest.files[name])throw Error('CATALOG_PRESENTATION_EVIDENCE_MISMATCH');
  documents[name]=JSON.parse(bytes.toString('utf8'));
 }
 const metadata=documents['eu-11145.metadata.json'];
 const envelope=buildEvidence(metadata.externalIdentifier,documents['eu-11145.json'].results);
 // Same pinned evidence under either mapping: the published v2.0 revision or the live adapter's.
 const expectedDigests=new Set([contentDigestV2(require('./acceptedEu11145').acceptedEu11145(envelope,metadata)),contentDigestV2(adaptEuOpportunityV2(envelope,{observedAt:metadata.observedAt}))]);
 const artifactHash=sha(JSON.stringify(envelope)),raw=envelope.variants[0].metadata;
 const scalar=key=>Array.isArray(raw[key])&&raw[key].length===1&&typeof raw[key][0]==='string'?sourceDescription(raw[key][0],raw[key][0].length+1)||'':'';
 const lines=scalar('furtherInformation').split('\n').map(line=>line.trim()).filter(Boolean);
 const section=heading=>{const index=lines.findIndex(line=>line===heading);return index>=0&&index+1<lines.length&&!/^[A-Z &]+:$/.test(lines[index+1])?lines[index+1]:null;};
 const narrative=scalar('description').split('\n').map(line=>line.trim()).filter(Boolean);
 const start=narrative.findIndex(line=>line.endsWith('including but not limited to:'));
 const end=narrative.findIndex((line,index)=>index>start&&line==='Eligible Participants');
 const themes=start>=0&&end>start?narrative.slice(start+1,end).join(' · '):null;
 const archived=(text,key)=>value(text,'archived',metadata.officialUrl,'/variants/0/metadata/'+key+'/0');
 function fields(projection){
  const fields=canonicalPresentation(projection);
  // The pinned artifact is usable only for the exact admitted canonical revision.
  if(!expectedDigests.has(projection.sourceDigest)||!projection.collections.evidence.some(item=>item.contentSha256===artifactHash))return fields;
  fields.presentation.areas=archived(themes,'description');
  fields.callInformation.eligibleCandidates=archived(section('ELIGIBLE CANDIDATES:'),'furtherInformation');
  fields.callInformation.duration=archived(scalar('duration'),'duration');
  fields.callInformation.location=archived(section('LOCATION:'),'furtherInformation');
  return fields;
 }
 const presentSummary=(summary,projection)=>({...summary,presentation:fields(projection).presentation});
 const describe=projection=>({...describeArchive(projection),summary:presentSummary(projection.detail.summary,projection),callInformation:fields(projection).callInformation});
 // Reuse the same verified enrichment on the established central catalog routes.
 // This adapter accepts a canonical snapshot already validated by the read model;
 // it does not read projections, grant authority, or alter immutable revisions.
 function presentSnapshot(snapshot,{detail=false}={}) {
  const observations=new Map(snapshot.provenance.observations.map(item=>[item.id,item]));
  const evidence=snapshot.provenance.evidence.map(item=>({id:item.id,
   contentSha256:observations.get(item.observationId)?.artifactSha256,
   locator:{jsonPointer:item.locatorType==='JSON_POINTER'?item.locator:null}}));
  const projection={inputs:{snapshot},sourceDigest:contentDigestV2(snapshot),collections:{evidence},detail:{}};
  const result=fields(projection);
  if(detail){const archived=describeArchive(projection);if(archived.description)Object.assign(result,{description:archived.description,descriptionTruncated:archived.descriptionTruncated,descriptionSourceUrl:archived.descriptionSourceUrl});}
  return result;
 }
 return Object.freeze({presentSummary,describe,presentSnapshot});
}
module.exports={loadPresentation,canonicalPresentation};
