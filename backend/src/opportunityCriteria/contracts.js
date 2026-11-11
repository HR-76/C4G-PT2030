'use strict';
const {createHash}=require('node:crypto');
const {canonicalize}=require('../organizationalProfile/canonicalization');
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const kinds={COMPETENCY_REQUIREMENT:'COMPETENCY',THEMATIC_AFFINITY:'THEMATIC_AREA',STRATEGIC_PRIORITY_AFFINITY:'STRATEGIC_PRIORITY'};
const fail=(code='INVALID_INPUT')=>{throw Object.assign(new Error(code),{code});};
function exact(v,required,optional=[]){if(!v||Object.getPrototypeOf(v)!==Object.prototype||required.some(k=>!Object.hasOwn(v,k))||Object.keys(v).some(k=>!required.includes(k)&&!optional.includes(k)))fail();}
function uuid(v){if(typeof v!=='string'||!UUID.test(v))fail();return v;}
function text(v,max){if(typeof v!=='string'||v.length>max||/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(v))fail();return v;}
function revision(v){if(!Number.isSafeInteger(v)||v<0||v>=Number.MAX_SAFE_INTEGER)fail();}
function validate(method,input,id,revisionId){uuid(id);if(revisionId)uuid(revisionId);if(!input||Buffer.byteLength(JSON.stringify(input))>65536)fail();
 if(method==='save'){exact(input,['requestId','expectedHeadRevision','opportunityRevisionId','criteria','sources']);uuid(input.requestId);uuid(input.opportunityRevisionId);revision(input.expectedHeadRevision);
 if(!Array.isArray(input.criteria)||!input.criteria.length||input.criteria.length>3||!Array.isArray(input.sources)||input.sources.length>3)fail();
 const seen=new Set(),ids=new Set();for(const c of input.criteria){exact(c,['criterionId','kind','interpretationText'],['conceptRef','evidence','temporalBasis']);uuid(c.criterionId);if(!Object.hasOwn(kinds,c.kind)||seen.has(c.kind)||ids.has(c.criterionId))fail();seen.add(c.kind);ids.add(c.criterionId);text(c.interpretationText,2000);
 if(c.conceptRef!==undefined&&c.conceptRef!==null){exact(c.conceptRef,['conceptId','schemeId','releaseId']);Object.values(c.conceptRef).forEach(uuid);}
 if(c.evidence!==undefined&&c.evidence!==null){exact(c.evidence,['sourceId','locator','excerpt','justification']);uuid(c.evidence.sourceId);text(c.evidence.locator,256);text(c.evidence.excerpt,4000);text(c.evidence.justification,2000);}
 if(c.temporalBasis!==undefined&&c.temporalBasis!==(c.kind==='COMPETENCY_REQUIREMENT'?'EVALUATION_INSTANT':null))fail();}
 const sources=new Set();for(const s of input.sources){exact(s,['sourceId','label','sourceKind','reference','versionLabel','capturedText']);uuid(s.sourceId);if(sources.has(s.sourceId)||!['SYNTHETIC','EDITORIAL_TRANSCRIPTION'].includes(s.sourceKind))fail();sources.add(s.sourceId);text(s.label,200);text(s.reference,2048);text(s.versionLabel,128);text(s.capturedText,12000);
 if(/(?:password|token|secret|authorization)=|:\/\/[^/\s]+@/i.test(s.reference))fail();}
 }else if(method==='confirm'){exact(input,['requestId','expectedHeadRevision','opportunityRevisionId']);uuid(input.requestId);uuid(input.opportunityRevisionId);revision(input.expectedHeadRevision);if(!input.expectedHeadRevision)fail();}
 else if(method==='lookup'){exact(input,['requestId','operation','resourceId']);uuid(input.requestId);uuid(input.resourceId);if(!['SAVE_REVISION','CONFIRM'].includes(input.operation))fail();}
 else if(method==='list'||method==='catalog'){exact(input,method==='catalog'?['kind']:[],['limit','cursor']);if(method==='catalog'&&!Object.hasOwn(kinds,input.kind))fail();if(input.limit!==undefined&&!(typeof input.limit==='number'||typeof input.limit==='string'&&/^[1-9][0-9]*$/.test(input.limit)))fail();const limit=input.limit===undefined?20:Number(input.limit);if(!Number.isInteger(limit)||limit<1||limit>50)fail();if(input.cursor!==undefined)text(input.cursor,4096);return {...input,limit};}
 else exact(input,[]);
 try{canonicalize(input);}catch{fail();}
 return JSON.parse(JSON.stringify(input));}
function findings(content){const out=[];for(const c of content.criteria){const s=content.sources.find(s=>s.sourceId===c.evidence?.sourceId);if(!c.interpretationText.trim())out.push({criterionId:c.criterionId,code:'INTERPRETATION_REQUIRED'});if(!c.conceptRef)out.push({criterionId:c.criterionId,code:'REFERENCE_REQUIRED'});if(!s||!s.label.trim()||!s.reference.trim()||!s.versionLabel.trim()||!c.evidence.locator.trim()||!c.evidence.justification.trim()||!c.evidence.excerpt.trim()||!s.capturedText.includes(c.evidence.excerpt))out.push({criterionId:c.criterionId,code:'EVIDENCE_INCOMPLETE'});if(c.kind==='COMPETENCY_REQUIREMENT'&&c.temporalBasis!=='EVALUATION_INSTANT')out.push({criterionId:c.criterionId,code:'TIME_REQUIRED'});}return out;}
const digest=value=>createHash('sha256').update(canonicalize(value)).digest('hex');
function projectReceipt(value){
 if(!value||!UUID.test(value.setId)||!UUID.test(value.revisionId)||!Number.isSafeInteger(value.revisionNumber)||value.revisionNumber<1||!['DRAFT','CONFIRMED'].includes(value.state))fail('SERVICE_UNAVAILABLE');
 const result={setId:value.setId,revisionId:value.revisionId,revisionNumber:value.revisionNumber,state:value.state};
 if(value.state==='CONFIRMED'){if(typeof value.confirmedAt!=='string'||!Number.isFinite(Date.parse(value.confirmedAt)))fail('SERVICE_UNAVAILABLE');result.confirmedAt=value.confirmedAt;}
 return result;
}
module.exports={validate,findings,digest,uuid,fail,kinds,projectReceipt};
