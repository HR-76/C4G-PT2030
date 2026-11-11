'use strict';
const {createHash}=require('node:crypto');
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function fail(code){throw Object.assign(new Error(code),{code});}
function uuid(value){if(typeof value!=='string'||!UUID.test(value))fail('ONBOARDING_INPUT_INVALID');return value.toLowerCase();}
function hash(value){return createHash('sha256').update(value).digest('hex');}
function token(value){if(typeof value!=='string'||!/^[a-f0-9]{64}$/.test(value))fail('ACTIVATION_INVALID');return hash(value);}
function text(value,max=200){if(typeof value!=='string'||!value.trim()||value.length>max||/[\x00-\x1f]/.test(value))fail('ONBOARDING_INPUT_INVALID');return value.trim().normalize('NFC');}
function input(value){
 if(!value||Object.keys(value).sort().join(',')!=='adminEmail,adminName,country,currency,legalName,name,requestId,slug,type')fail('ONBOARDING_INPUT_INVALID');
 const result={requestId:uuid(value.requestId),name:text(value.name),legalName:text(value.legalName),slug:text(value.slug,100),type:text(value.type,64),country:text(value.country,2),currency:text(value.currency,3),adminName:text(value.adminName),adminEmail:text(value.adminEmail,254).toLowerCase()};
 if(!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(result.slug)||!/^[A-Z][A-Z0-9_]{0,63}$/.test(result.type)||!/^[A-Z]{2}$/.test(result.country)||!/^[A-Z]{3}$/.test(result.currency)||! /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(result.adminEmail))fail('ONBOARDING_INPUT_INVALID');
 return result;
}
function view(row){return {id:row.id,organizationId:row.organization_id,phase:row.phase,status:row.status,revision:Number(row.revision),errorCode:row.error_code||null};}
module.exports={fail,uuid,hash,token,input,view};
