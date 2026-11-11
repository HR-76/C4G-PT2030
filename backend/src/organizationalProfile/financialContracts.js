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
const contentKeys=['amount','currencyId','metricId','startDate','endDate','provenanceRef','documentVersionIds'];
function validate(method,v){const keys=['assertionId',...(method==='create'||method==='read'?[]:['expectedRevision']),...(method==='create'||method==='edit'?contentKeys:[]),
 ...(method==='verify'?['methodId','validFrom','validUntil']:[]),...(['reject','dispute','revoke','read'].includes(method)?['reasonId']:[]),...(method==='read'?['purposeId']:[]),'idempotencyKey'];
 exact(v,keys);if(!uuid(v.assertionId)||!uuid(v.idempotencyKey)||(keys.includes('expectedRevision')&&(!Number.isSafeInteger(v.expectedRevision)||v.expectedRevision<1||v.expectedRevision>=Number.MAX_SAFE_INTEGER)))fail();
 if(method==='create'||method==='edit'){
  if(typeof v.amount!=='string'||!/^(0|[1-9][0-9]{0,17})(\.[0-9]{1,6})?$/.test(v.amount)||!['currencyId','metricId','provenanceRef'].every(k=>uuid(v[k]))||!date(v.startDate)||!date(v.endDate)||v.startDate>v.endDate)fail();
  const docs=v.documentVersionIds;if(!Array.isArray(docs)||isProxy(docs)||docs.length>16)fail();let copy;try{copy=canonicalClone(docs);}catch{fail();}
  if(copy.some(id=>!uuid(id))||new Set(copy).size!==copy.length)fail();
 }
 if(method==='verify'&&(!uuid(v.methodId)||!instant(v.validFrom)||(v.validUntil!==null&&(!instant(v.validUntil)||v.validUntil<=v.validFrom))))fail();
 if(keys.includes('reasonId')&&!uuid(v.reasonId))fail();if(keys.includes('purposeId')&&!uuid(v.purposeId))fail();
 const normalized={...v};if(contentKeys.every(k=>keys.includes(k))){const [whole,fraction='']=v.amount.split('.');normalized.amount=whole+'.'+fraction.padEnd(6,'0');normalized.documentVersionIds=[...v.documentVersionIds].sort();}
 return canonicalClone(normalized);
}
module.exports=Object.freeze(Object.fromEntries(['create','edit','read','submit','verify','reject','dispute','revoke'].map(method=>[method,v=>validate(method,v)])));
