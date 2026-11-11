'use strict';
const {fail,uuid}=require('../platformOnboarding/contracts');
// Existing entity types exposed by OrganizationProfile; no legal-form inference.
const types=Object.freeze(['UNIVERSITY','COMPANY','MUNICIPALITY','ASSOCIATION','PUBLIC_BODY','RESEARCH','CONSULTANCY','OTHER']);
const steps=Object.freeze([
 ['legalName','displayName','typeCode','nif','acronym'],
 ['address','addressComplement','postalCode','locality','institutionalEmail','institutionalPhone','website'],
 ['administratorProfessionalPhone','administratorJobTitle','workerCount','workerReferenceDate']
]);
const optional=new Set(['acronym','addressComplement','website','administratorJobTitle']);
const limits={legalName:200,displayName:200,typeCode:64,nif:9,acronym:50,address:250,addressComplement:150,postalCode:8,locality:150,institutionalEmail:254,institutionalPhone:32,website:500,administratorProfessionalPhone:32,administratorJobTitle:150,workerReferenceDate:10};
const profileKeys=Object.freeze(['nif','acronym','address','addressComplement','postalCode','locality','institutionalEmail','institutionalPhone','website','responsibleName','responsibleEmail','responsiblePhone','responsibleJobTitle','workerCount','workerReferenceDate']);
function validNif(value){
 if(!/^[1-9][0-9]{8}$/.test(value)||/^(\d)\1{8}$/.test(value))return false;
 const remainder=[...value.slice(0,8)].reduce((sum,n,i)=>sum+Number(n)*(9-i),0)%11;
 return Number(value[8])===(remainder<2?0:11-remainder);
}
function civilToday(now){return new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Lisbon',year:'numeric',month:'2-digit',day:'2-digit'}).format(now);}
function validate(fields,{step=null,complete=false,now=new Date()}={}){
 if(!fields||Object.getPrototypeOf(fields)!==Object.prototype||Object.keys(fields).some(k=>!steps.flat().includes(k)))fail('ONBOARDING_INPUT_INVALID');
 if(step!==null&&![0,1,2].includes(step))fail('ONBOARDING_INPUT_INVALID');
 const values={},errors={};
 for(const key of steps.flat()){
  const raw=fields[key];
  if(raw===undefined||raw===null||raw===''){if((complete||steps[step]?.includes(key))&&!optional.has(key))errors[key]='Campo obrigatório.';continue;}
  if(key==='workerCount'){
   if(typeof raw!=='number'||!Number.isSafeInteger(raw)||raw<0)errors[key]='Indique um número inteiro igual ou superior a zero.';else values[key]=raw;
   continue;
  }
  if(typeof raw!=='string'||raw.length>limits[key]||/[\x00-\x1f\x7f]/.test(raw)){errors[key]='Valor inválido ou demasiado longo.';continue;}
  const value=raw.trim().normalize('NFC');
  if(!value){if((complete||steps[step]?.includes(key))&&!optional.has(key))errors[key]='Campo obrigatório.';continue;}
  values[key]=value;
  if(key==='typeCode'&&!types.includes(value))errors[key]='Selecione um tipo de entidade.';
  if(key==='nif'&&!validNif(value))errors[key]='Indique um NIF português válido com nove dígitos.';
  if(key==='postalCode'&&!/^[0-9]{4}-[0-9]{3}$/.test(value))errors[key]='Utilize o formato 0000-000.';
  if(key==='institutionalEmail'){
   if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value))errors[key]='Indique um email válido.';
   values[key]=value.toLowerCase();
  }
  if(key.endsWith('Phone')){
   const normalized=value.replace(/\s+/g,'');
   if(!/^\+?[1-9][0-9]{6,14}$/.test(normalized))errors[key]='Indique um telefone válido, com indicativo se necessário.';
   values[key]=normalized;
  }
  if(key==='website'){
   try{const url=new URL(value);if(!['https:','http:'].includes(url.protocol)||url.username||url.password||!url.hostname.includes('.'))throw Error();}catch{errors[key]='Indique um endereço http:// ou https:// válido.';}
  }
  if(key==='workerReferenceDate'){
   const date=new Date(value+'T00:00:00Z');
   if(!/^\d{4}-\d{2}-\d{2}$/.test(value)||value<'0001-01-01'||Number.isNaN(date.getTime())||date.toISOString().slice(0,10)!==value||value>civilToday(now))errors[key]='Indique uma data real, que não seja futura.';
  }
 }
 return {fields:values,errors,valid:Object.keys(errors).length===0};
}
function command(value){
 if(!value||Object.keys(value).sort().join(',')!=='expectedRevision,fields,requestId'||!Number.isSafeInteger(value.expectedRevision)||value.expectedRevision<0)fail('ONBOARDING_INPUT_INVALID');
 return {expectedRevision:value.expectedRevision,requestId:uuid(value.requestId),fields:value.fields};
}
function profileCommand(value){
 if(!value||Object.keys(value).sort().join(',')!=='expectedRevision,fields,requestId'||!Number.isSafeInteger(value.expectedRevision)||value.expectedRevision<0||!value.fields||Object.getPrototypeOf(value.fields)!==Object.prototype||Object.keys(value.fields).sort().join(',')!==[...profileKeys].sort().join(','))fail('ONBOARDING_INPUT_INVALID');
 return {expectedRevision:value.expectedRevision,requestId:uuid(value.requestId),fields:value.fields};
}
function validateProfile(raw,identity,{now=new Date()}={}){
 if(!identity||typeof identity.legalName!=='string'||typeof identity.displayName!=='string'||!types.includes(identity.typeCode))fail('ONBOARDING_INPUT_INVALID');
 const mapped={legalName:identity.legalName,displayName:identity.displayName,typeCode:identity.typeCode,nif:raw.nif,acronym:raw.acronym,address:raw.address,addressComplement:raw.addressComplement,postalCode:raw.postalCode,locality:raw.locality,institutionalEmail:raw.institutionalEmail,institutionalPhone:raw.institutionalPhone,website:raw.website,administratorProfessionalPhone:raw.responsiblePhone,administratorJobTitle:raw.responsibleJobTitle,workerCount:raw.workerCount,workerReferenceDate:raw.workerReferenceDate};
 const result=validate(mapped,{complete:true,now}),errors={...result.errors},fields=result.fields;
 for(const [key,max] of [['responsibleName',200],['responsibleEmail',254],['responsiblePhone',32],['responsibleJobTitle',150]]){
  const value=raw[key];
  if((value===undefined||value===null||value==='')&&key!=='responsibleJobTitle'){errors[key]='Campo obrigatório.';continue;}
  if(value===undefined||value===null||value==='')continue;
  if(typeof value!=='string'||value.length>max||/[\x00-\x1f\x7f]/.test(value)||!value.trim()){errors[key]='Valor inválido ou demasiado longo.';continue;}
  const normalized=value.trim().normalize('NFC');fields[key]=normalized;
  if(key==='responsibleEmail'){
   if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized))errors[key]='Indique um email válido.';
   fields[key]=normalized.toLowerCase();
  }
  if(key==='responsiblePhone'){
   const phone=normalized.replace(/\s+/g,'');if(!/^\+?[1-9][0-9]{6,14}$/.test(phone))errors[key]='Indique um telefone válido, com indicativo se necessário.';fields[key]=phone;
  }
 }
 for(const [legacy] of [['administratorProfessionalPhone','responsiblePhone'],['administratorJobTitle','responsibleJobTitle']])delete fields[legacy];
 return {fields,errors,valid:Object.keys(errors).length===0};
}
function assertValid(result){if(!result.valid)throw Object.assign(Error('REGISTRATION_FIELDS_INVALID'),{code:'REGISTRATION_FIELDS_INVALID',fields:result.errors});return result.fields;}
module.exports={types,steps,profileKeys,validate,validateProfile,validNif,command,profileCommand,assertValid};
