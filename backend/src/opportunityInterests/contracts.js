'use strict';
const {UUID}=require('../applications/contracts');
function fail(code='INVALID_INPUT'){throw Object.assign(new Error('Opportunity interest unavailable'),{code});}
function uuid(value){if(typeof value!=='string'||!UUID.test(value))fail();return value.toLowerCase();}
function exact(value,required,optional=[]){
 if(!value||Object.getPrototypeOf(value)!==Object.prototype||required.some(key=>!Object.hasOwn(value,key))||Object.keys(value).some(key=>!required.includes(key)&&!optional.includes(key)))fail();
}
function unitIds(value){
 if(!Array.isArray(value)||value.length>50)fail();
 const ids=value.map(uuid);if(new Set(ids).size!==ids.length)fail();return ids.sort();
}
function revision(value){if(!Number.isSafeInteger(value)||value<1)fail();return value;}
function cursor(value){if(value===undefined)return null;if(typeof value!=='string'||!value||value.length>4000)fail();return value;}
function parse(method,value){
 if(method==='register'){
  exact(value,['opportunityId','centralRevisionId','unitIds','idempotencyKey'],['transversal','notes']);
  if(Object.hasOwn(value,'transversal') && (typeof value.transversal!=='boolean'||value.transversal && value.unitIds?.length))fail();
  if(value.notes!=null && (typeof value.notes!=='string'||value.notes.length>10000))fail();
  return {...(Object.hasOwn(value,'notes')?{notes:value.notes}:{}),...(Object.hasOwn(value,'transversal')?{transversal:value.transversal}:{}),opportunityId:uuid(value.opportunityId),centralRevisionId:uuid(value.centralRevisionId),unitIds:unitIds(value.unitIds),idempotencyKey:uuid(value.idempotencyKey)};
 }
 if(method==='edit'){
  exact(value,['notes','unitIds','expectedRevision','idempotencyKey']);
  if(value.notes!==null&&(typeof value.notes!=='string'||value.notes.length>10000))fail();
  return {notes:value.notes,unitIds:unitIds(value.unitIds),expectedRevision:revision(value.expectedRevision),idempotencyKey:uuid(value.idempotencyKey)};
 }
 if(method==='archive'){
  exact(value,['reason','expectedRevision','idempotencyKey']);
  if(typeof value.reason!=='string'||value.reason!==value.reason.trim()||!value.reason||value.reason.length>500)fail();
  return {reason:value.reason,expectedRevision:revision(value.expectedRevision),idempotencyKey:uuid(value.idempotencyKey)};
 }
 if(method==='list'){
  exact(value,[],['q','unitId','status','cursor']);
  const q=value.q??'',status=value.status??'ACTIVE';
  if(typeof q!=='string'||q.length>200||!['ACTIVE','ARCHIVED','ALL'].includes(status))fail();
  return {q,unitId:value.unitId===undefined?null:value.unitId==='NONE'?'NONE':uuid(value.unitId),status,cursor:cursor(value.cursor)};
 }
 if(method==='units'){
  exact(value,['purpose']);if(!['ASSIGN','FILTER'].includes(value.purpose))fail();return {purpose:value.purpose};
 }
 if(method==='summaries'){
  exact(value,['opportunityIds']);if(typeof value.opportunityIds!=='string'||value.opportunityIds.length>924)fail();
  const ids=value.opportunityIds.split(',').map(uuid);if(ids.length>25||new Set(ids).size!==ids.length)fail();return {opportunityIds:ids};
 }
 if(method==='history'){exact(value,[],['cursor']);return {cursor:cursor(value.cursor)};}
 if(['context','get'].includes(method)){exact(value,[]);return {};}
 fail();
}
module.exports={parse,uuid,unitIds,fail};
