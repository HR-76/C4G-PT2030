'use strict';
const {types:{isProxy}}=require('node:util');
const {canonicalClone}=require('./canonicalization');
const {OrganizationalProfileContractError}=require('./errors');
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
function fail(){throw new OrganizationalProfileContractError('F13_INVALID_INPUT');}
function uuid(v){return typeof v==='string'&&UUID.test(v);}
function exact(v,keys){if(!v||isProxy(v)||Object.getPrototypeOf(v)!==Object.prototype||Reflect.ownKeys(v).length!==keys.length||keys.some(k=>!Object.hasOwn(v,k)||!Object.hasOwn(Object.getOwnPropertyDescriptor(v,k),'value')))fail();}
function date(v){return typeof v==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(v)&&Number.isFinite(Date.parse(v+'T00:00:00.000Z'))&&new Date(v+'T00:00:00.000Z').toISOString().slice(0,10)===v;}
function instant(v){return typeof v==='string'&&Number.isFinite(Date.parse(v))&&new Date(v).toISOString()===v;}

const contentKeys=['assertionKind','countValue','unitId','metricId','countingBasisId','territoryRefs','groupRefs','organizationalScopeId','startDate','endDate','provenanceRef','documentVersionIds'];
function refs(values,keys,id){if(!Array.isArray(values)||isProxy(values)||values.length>64)fail();let copy;try{copy=canonicalClone(values);}catch{fail();}
 for(const r of copy){exact(r,keys);for(const k of keys){if(k==='coverageKind'){if(!['FULL','PARTIAL','UNSPECIFIED'].includes(r[k]))fail();}else if(!uuid(r[k]))fail();}}
 if(new Set(copy.map(r=>r[id])).size!==copy.length)fail();return [...copy].sort((a,b)=>a[id].localeCompare(b[id]));}
function validate(method,v){const keys=['assertionId',...(method==='create'||method==='read'?[]:['expectedRevision']),...(method==='create'||method==='edit'?contentKeys:[]),
 ...(method==='verify'?['methodId','validFrom','validUntil']:[]),...(['reject','dispute','revoke','read'].includes(method)?['reasonId']:[]),...(method==='read'?['purposeId']:[]),'idempotencyKey'];
 exact(v,keys);if(!uuid(v.assertionId)||!uuid(v.idempotencyKey)||(keys.includes('expectedRevision')&&(!Number.isSafeInteger(v.expectedRevision)||v.expectedRevision<1||v.expectedRevision>=Number.MAX_SAFE_INTEGER)))fail();
 const normalized={...v};
 if(method==='create'||method==='edit'){
  if(!['TERRITORY','TARGET_GROUP','SERVED_POPULATION'].includes(v.assertionKind)||!uuid(v.provenanceRef)||!date(v.startDate)||!date(v.endDate)||v.startDate>v.endDate||(v.organizationalScopeId!==null&&!uuid(v.organizationalScopeId)))fail();
  normalized.territoryRefs=refs(v.territoryRefs,['geographicId','coverageKind'],'geographicId');normalized.groupRefs=refs(v.groupRefs,['conceptId','schemeId','releaseId'],'conceptId');
  if(v.assertionKind==='SERVED_POPULATION'){if(typeof v.countValue!=='string'||!/^(0|[1-9][0-9]*)$/.test(v.countValue)||!['unitId','metricId','countingBasisId'].every(k=>uuid(v[k]))||!normalized.territoryRefs.length||!normalized.groupRefs.length)fail();}
  else {if(['countValue','unitId','metricId','countingBasisId'].some(k=>v[k]!==null))fail();
   if(v.assertionKind==='TERRITORY'&&(!normalized.territoryRefs.length||normalized.groupRefs.length))fail();
   if(v.assertionKind==='TARGET_GROUP'&&(!normalized.groupRefs.length||normalized.territoryRefs.length))fail();}
  if(!Array.isArray(v.documentVersionIds)||isProxy(v.documentVersionIds)||v.documentVersionIds.length>16)fail();
  let docs;try{docs=canonicalClone(v.documentVersionIds);}catch{fail();}if(docs.some(id=>!uuid(id))||new Set(docs).size!==docs.length)fail();normalized.documentVersionIds=[...docs].sort();
 }
 if(method==='verify'&&(!uuid(v.methodId)||!instant(v.validFrom)||(v.validUntil!==null&&(!instant(v.validUntil)||v.validUntil<=v.validFrom))))fail();
 if(keys.includes('reasonId')&&!uuid(v.reasonId))fail();if(keys.includes('purposeId')&&!uuid(v.purposeId))fail();return canonicalClone(normalized);
}
module.exports=Object.freeze(Object.fromEntries(['create','edit','read','submit','verify','reject','dispute','revoke'].map(method=>[method,v=>validate(method,v)])));
