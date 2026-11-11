'use strict';
const {timingSafeEqual}=require('node:crypto');
const {types:{isProxy}}=require('node:util');
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const DIGEST=/^[0-9a-f]{64}$/;
const IDS=Object.freeze(['organizationId','tenantId','databaseGenerationId','rootExecutionId','executionId']);
const NUMBERS=Object.freeze(['generation','authorityEpoch']);
const DIGESTS=Object.freeze(['contentDigest','bindingDigest']);
const KEYS=Object.freeze([...IDS,'jobType',...NUMBERS,...DIGESTS]);
const JOB=/^[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)+$/;
function data(value,keys){
 if(!value||typeof value!=='object'||isProxy(value)||Object.getPrototypeOf(value)!==Object.prototype)return null;
 const descriptors=Object.getOwnPropertyDescriptors(value);
 if(Reflect.ownKeys(descriptors).length!==keys.length||keys.some(key=>!descriptors[key]?.enumerable||!Object.hasOwn(descriptors[key],'value')))return null;
 return Object.fromEntries(keys.map(key=>[key,descriptors[key].value]));
}
// Consistency check only. It does not authenticate either input, serialize a
// replay, or authorize release; callers must establish those guarantees.
function matchesTerminalBinding(expected,observation){
 try{
  const a=data(expected,KEYS),b=data(observation,[...KEYS,'outcome']);
  if(!a||!b||b.outcome!=='SUCCESS')return false;
  if(IDS.some(key=>typeof a[key]!=='string'||typeof b[key]!=='string'||!UUID.test(a[key])||!UUID.test(b[key])||a[key]!==b[key]))return false;
  if(typeof a.jobType!=='string'||!JOB.test(a.jobType)||a.jobType!==b.jobType)return false;
  if(NUMBERS.some(key=>!Number.isSafeInteger(a[key])||a[key]<1||!Number.isSafeInteger(b[key])||a[key]!==b[key]))return false;
  if(DIGESTS.some(key=>typeof a[key]!=='string'||typeof b[key]!=='string'||!DIGEST.test(a[key])||!DIGEST.test(b[key])||!timingSafeEqual(Buffer.from(a[key],'hex'),Buffer.from(b[key],'hex'))))return false;
  return true;
 }catch{return false;}
}
module.exports={matchesTerminalBinding};
