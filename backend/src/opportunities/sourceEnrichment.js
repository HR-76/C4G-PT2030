'use strict';
const {types:{isProxy}}=require('node:util');
const {isIP}=require('node:net');
const {cloneFreeze}=require('./immutability');
const {canonicalize}=require('../organizationalProfile/canonicalization');
const FIELDS=Object.freeze(['programme','instrument','budget','support','rate','territories','beneficiaries','consortium','conditions','documents','submission']);
const MAX_BYTES=12288;
function invalid(){throw new TypeError('Invalid public source enrichment');}
function data(value,depth=0){
 if(depth>15||isProxy(value))invalid();
 if(value===null||typeof value==='boolean'||typeof value==='number'&&Number.isFinite(value))return value;
 if(typeof value==='string'){if(!value.isWellFormed()||/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value))invalid();return value;}
 if(!value||typeof value!=='object'||!Array.isArray(value)&&Object.getPrototypeOf(value)!==Object.prototype)invalid();
 const descriptors=Object.getOwnPropertyDescriptors(value),out=Array.isArray(value)?[]:{};
 for(const key of Reflect.ownKeys(descriptors)){
  if(key==='length'&&Array.isArray(value))continue;
  if(typeof key!=='string'||!Object.hasOwn(descriptors[key],'value')||!descriptors[key].enumerable||['__proto__','constructor','prototype'].includes(key))invalid();
  out[key]=data(descriptors[key].value,depth+1);
 }
 if(Array.isArray(value)&&out.length!==value.length)invalid();
 return out;
}
function exact(v,keys){if(!v||Array.isArray(v)||Object.getPrototypeOf(v)!==Object.prototype||Object.keys(v).length!==keys.length||keys.some(k=>!Object.hasOwn(v,k)))invalid();}
function str(v,max,empty=false){if(typeof v!=='string'||v.length>max||!empty&&!v.trim())invalid();}
function nullable(v,max){if(v!==null)str(v,max);}
function instant(v){if(typeof v!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(v)||!Number.isFinite(Date.parse(v))||new Date(v).toISOString()!==v)invalid();}
function safePublicUrl(value){
 if(typeof value!=='string'||value.length>2048||/[\u0000-\u0020\\]/.test(value))return null;
 try{const u=new URL(value),host=u.hostname.toLowerCase();
  if(u.protocol!=='https:'||u.username||u.password||isIP(host)||host.includes(':')||!host.includes('.')||/\.(local|localhost|internal|test|invalid)$/.test(host)||host==='localhost'||u.port&&u.port!=='443'||[...u.searchParams.keys()].some(k=>/(?:token|secret|password|authorization|credential|signature|api.?key|^sig$)/i.test(k)))return null;
  return u.href;
 }catch{return null;}
}
function positive(v){if(typeof v!=='string'||! /^(?:0|[1-9]\d{0,23})(?:\.\d{1,8})?$/.test(v)||!/[1-9]/.test(v))invalid();}
function compare(a,b){const [aw,af='']=a.split('.'),[bw,bf='']=b.split('.');return aw.length-bw.length||aw.localeCompare(bw)||af.padEnd(8,'0').localeCompare(bf.padEnd(8,'0'));}
function currency(v){if(v!==null&&(typeof v!=='string'||! /^[A-Z]{3}$/.test(v)))invalid();}
function validateValue(key,v){
 if(key==='programme'){exact(v,['id','code','label']);str(v.id,100);nullable(v.code,64);str(v.label,200);}
 else if(key==='budget'){exact(v,['amount','currency','period','scope','group','action']);positive(v.amount);currency(v.currency);nullable(v.period,80);nullable(v.group,100);nullable(v.action,300);if(!['CALL','TOPIC_OR_SHARED'].includes(v.scope))invalid();}
 else if(key==='support'){exact(v,['minimum','maximum','currency','unit','action']);if(v.minimum===null&&v.maximum===null)invalid();if(v.minimum!==null)positive(v.minimum);if(v.maximum!==null)positive(v.maximum);if(v.minimum!==null&&v.maximum!==null&&compare(v.minimum,v.maximum)>0)invalid();currency(v.currency);nullable(v.action,300);if(v.unit!=='PER_PROJECT')invalid();}
 else if(['documents','submission'].includes(key)){exact(v,key==='documents'?['title','url']:['title','url','availability']);str(v.title,200);if(!safePublicUrl(v.url))invalid();if(key==='submission'&&v.availability!=='UNKNOWN')invalid();}
 else{exact(v,['text']);str(v.text,key==='conditions'?3000:1800);}
}
// PostgreSQL jsonb::text includes separators with spaces; account for them before persistence.
function jsonbBytes(value){
 function encode(v){if(Array.isArray(v))return '['+v.map(encode).join(', ')+']';if(v&&typeof v==='object')return '{'+Object.entries(v).map(([k,x])=>JSON.stringify(k)+': '+encode(x)).join(', ')+'}';return JSON.stringify(v);}
 return Buffer.byteLength(encode(value));
}
function validateSourceEnrichment(input){
 const v=data(input);exact(v,['schemaVersion','mappingVersion','observedAt','fields']);if(v.schemaVersion!==1)invalid();str(v.mappingVersion,100);instant(v.observedAt);exact(v.fields,FIELDS);
 for(const key of FIELDS){const field=v.fields[key];exact(field,['status','items','truncated']);if(!['PUBLISHED','NOT_FOUND','CONFLICT','UNSUPPORTED'].includes(field.status)||typeof field.truncated!=='boolean'||!Array.isArray(field.items)||field.items.length>(key==='conditions'?1:8)||field.status==='PUBLISHED'&&!field.items.length||field.status==='NOT_FOUND'&&field.items.length)invalid();
  for(const item of field.items){exact(item,['value','evidence']);validateValue(key,item.value);exact(item.evidence,['url','locator','excerpt','observedAt']);if(!safePublicUrl(item.evidence.url))invalid();str(item.evidence.locator,240);str(item.evidence.excerpt,500,true);instant(item.evidence.observedAt);}
 }
 if(jsonbBytes(v)>MAX_BYTES)invalid();return cloneFreeze(v);
}
function semanticEnrichment(value){if(value==null)return value;const v=data(value);delete v.observedAt;for(const field of Object.values(v.fields||{}))for(const item of field.items||[])delete item.evidence.observedAt;return v;}
function retainEnrichmentObservation(previous,incoming){
 if(incoming===undefined)return previous;
 if(!previous)return incoming;
 if(canonicalize(semanticEnrichment(previous))===canonicalize(semanticEnrichment(incoming)))return previous;
 const out=data(incoming);
 if(previous.schemaVersion===incoming.schemaVersion&&previous.mappingVersion===incoming.mappingVersion){for(const key of FIELDS){const old=previous.fields[key],fresh=incoming.fields[key];const project=f=>f&&{...f,items:f.items.map(i=>({...i,evidence:{...i.evidence,observedAt:undefined}}))};
   // JSON removes only the observation instant, never the source or excerpt.
   if(canonicalize(JSON.parse(JSON.stringify(project(old))))===canonicalize(JSON.parse(JSON.stringify(project(fresh)))))out.fields[key]=data(old);
 }}return out;
}
function fitEnrichment(value,maxBytes=MAX_BYTES){
 if(!Number.isSafeInteger(maxBytes)||maxBytes<1500||maxBytes>MAX_BYTES)invalid();
 const out=data(value);
 // Evidence snippets are secondary; keep typed values and original source links first.
 if(jsonbBytes(out)>maxBytes)for(const key of [...FIELDS].reverse())for(const item of out.fields[key].items){if(item.evidence.excerpt.length>120){item.evidence.excerpt=item.evidence.excerpt.slice(0,120);out.fields[key].truncated=true;}}
 if(jsonbBytes(out)>maxBytes)for(const key of ['conditions','consortium','beneficiaries','territories','rate','instrument'])for(const item of out.fields[key].items){if(item.value.text.length>500){item.value.text=item.value.text.slice(0,500);out.fields[key].truncated=true;}}
 const order=['documents','conditions','submission','consortium','beneficiaries','territories','rate','instrument','support','budget','programme'];
 while(jsonbBytes(out)>maxBytes){const key=order.find(k=>out.fields[k].items.length);if(!key)invalid();const f=out.fields[key];f.items.pop();f.truncated=true;if(!f.items.length&&f.status==='PUBLISHED')f.status='UNSUPPORTED';}
 return validateSourceEnrichment(out);
}
module.exports={FIELDS,MAX_BYTES,validateSourceEnrichment,semanticEnrichment,retainEnrichmentObservation,fitEnrichment,jsonbBytes,safePublicUrl};
