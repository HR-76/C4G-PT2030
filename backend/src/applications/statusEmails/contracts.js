"use strict";
const LABELS = Object.freeze({IDENTIFIED:'Identificada',INTENTION:'Intenção',PREPARATION:'Em preparação',SUBMITTED:'Submetida',APPROVED:'Aprovada',REJECTED:'Rejeitada',CANCELLED:'Cancelada',ARCHIVED:'Arquivada'});
function invalid(){throw new TypeError('INVALID_STATUS_EMAIL_CONTRACT');}
function exact(value,keys){if(!value||Object.getPrototypeOf(value)!==Object.prototype||Reflect.ownKeys(value).length!==keys.length||keys.some(k=>!Object.hasOwn(value,k)))invalid();}
function id(value){if(typeof value!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value))invalid();return value.toLowerCase();}
function text(value,max=500){if(typeof value!=='string'||!value.trim()||value.length>max||/[\x00-\x1f\x7f]/.test(value))invalid();return value;}
function email(value){if(typeof value!=='string')return null;const normalized=value.trim().toLowerCase();return normalized.length<=254&&/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(normalized)?normalized:null;}
function event(value){
 exact(value,['organizationId','applicationId','revision','actorUserId','actorEmail','occurredAt','organizationName','title','fromStatus','toStatus','candidateMembershipIds']);
 if(!Number.isSafeInteger(value.revision)||value.revision<1||!Object.hasOwn(LABELS,value.fromStatus)||!Object.hasOwn(LABELS,value.toStatus)||value.fromStatus===value.toStatus)invalid();
 if(typeof value.occurredAt!=='string'||!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value.occurredAt)||!Number.isFinite(Date.parse(value.occurredAt))||new Date(value.occurredAt).toISOString()!==value.occurredAt)invalid();
 if(!Array.isArray(value.candidateMembershipIds)||value.candidateMembershipIds.length>1000)invalid();
 if(value.actorEmail!==null&&!email(value.actorEmail))invalid();
 return Object.freeze({...value,organizationId:id(value.organizationId),applicationId:id(value.applicationId),actorUserId:id(value.actorUserId),actorEmail:email(value.actorEmail),organizationName:text(value.organizationName,200),title:text(value.title),candidateMembershipIds:Object.freeze([...new Set(value.candidateMembershipIds.map(id))])});
}
function payload(value){exact(value,['deliveryId']);return Object.freeze({deliveryId:id(value.deliveryId)});}
function message(value){exact(value,['to','subject','html','text']);if(!email(value.to))invalid();text(value.subject,800);for(const k of ['html','text'])if(typeof value[k]!=='string'||!value[k].length||value[k].length>50000)invalid();return Object.freeze({...value,to:email(value.to)});}
module.exports={LABELS,exact,id,text,email,event,payload,message,invalid};
