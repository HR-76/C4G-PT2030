'use strict';
const {isPlain,cloneFreeze}=require('./immutability');
const {types:{isProxy}}=require('node:util');
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
function invalid(){throw new TypeError('Invalid public source resolution');}
function exact(value,keys){if(!isPlain(value)||isProxy(value)||Reflect.ownKeys(value).length!==keys.length||keys.some(k=>!Object.hasOwn(value,k))||Reflect.ownKeys(value).some(k=>!keys.includes(k)))invalid();}
function bounded(value,max){if(typeof value!=='string'||!value.trim()||value.length>max||/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value))invalid();return value;}
function validateResolutionSources(sources){
 if(!Array.isArray(sources)||!sources.length||sources.length>12)invalid();
 return sources.map(source=>{
  exact(source,['url','title','locator']);bounded(source.url,2048);bounded(source.title,300);bounded(source.locator,500);
  let parsed;try{parsed=new URL(source.url);}catch{invalid();}
  if(parsed.protocol!=='https:'||parsed.username||parsed.password)invalid();
  return {...source};
 });
}
function validateSourceResolution(value){
 exact(value,['schemaVersion','resolutionId','decidedAt','sourceFingerprint','reason','note','sources']);
 if(value.schemaVersion!==1||!UUID.test(value.resolutionId)||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value.decidedAt)||!Number.isFinite(Date.parse(value.decidedAt))||!/^[a-f0-9]{64}$/.test(value.sourceFingerprint))invalid();
 bounded(value.reason,500);bounded(value.note,2000);
 const out={...value,sources:validateResolutionSources(value.sources)};
 if(Buffer.byteLength(JSON.stringify(out))>12000)invalid();
 return cloneFreeze(out);
}
module.exports={validateSourceResolution,validateResolutionSources};
