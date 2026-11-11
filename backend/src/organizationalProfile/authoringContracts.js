'use strict';
const {types:{isProxy}}=require('node:util');
const {canonicalClone}=require('./canonicalization');
const {OrganizationalProfileContractError}=require('./errors');
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
function uuid(value){return typeof value==='string'&&UUID.test(value);}
function fail(){throw new OrganizationalProfileContractError('F13_INVALID_INPUT');}
function exact(value,keys){if(!value||isProxy(value)||Object.getPrototypeOf(value)!==Object.prototype
 ||Reflect.ownKeys(value).length!==keys.length||keys.some(k=>!Object.hasOwn(value,k)
 ||!Object.hasOwn(Object.getOwnPropertyDescriptor(value,k),'value')))fail();}
function items(list){if(!Array.isArray(list)||isProxy(list)||list.length>100)fail();
 try { list=canonicalClone(list); } catch { fail(); }
 const result=list.map(item=>{exact(item,['itemId','itemVersionId','domain','knowledgeStatus','conceptId']);
 if(!uuid(item.itemId)||!uuid(item.itemVersionId)||!['THEMATIC_AREA','STRATEGIC_PRIORITY'].includes(item.domain)
 ||!['KNOWN','UNKNOWN'].includes(item.knowledgeStatus)
 ||(item.knowledgeStatus==='KNOWN'?!uuid(item.conceptId):item.conceptId!==null))fail();return item;});
 if(new Set(result.map(i=>i.itemId)).size!==result.length||new Set(result.map(i=>i.itemVersionId)).size!==result.length)fail();return result;}
function validateCreate(v){exact(v,['draftId','scopeId','items','idempotencyKey']);
 if(!uuid(v.draftId)||!uuid(v.idempotencyKey)||(v.scopeId!==null&&!uuid(v.scopeId)))fail();items(v.items);return canonicalClone(v);}
function validateEdit(v){exact(v,['draftId','expectedRevision','items','idempotencyKey']);
 if(!uuid(v.draftId)||!uuid(v.idempotencyKey)||!Number.isSafeInteger(v.expectedRevision)||v.expectedRevision<1||v.expectedRevision===Number.MAX_SAFE_INTEGER)fail();items(v.items);return canonicalClone(v);}
function validateSubmit(v){exact(v,['draftId','expectedRevision','idempotencyKey']);
 if(!uuid(v.draftId)||!uuid(v.idempotencyKey)||!Number.isSafeInteger(v.expectedRevision)||v.expectedRevision<1||v.expectedRevision===Number.MAX_SAFE_INTEGER)fail();return canonicalClone(v);}
module.exports={validateCreate,validateEdit,validateSubmit};
