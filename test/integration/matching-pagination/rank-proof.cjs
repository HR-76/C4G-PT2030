'use strict';
// Isolated algorithm proof, not connected to the product's HTTP or authority ports.
const {createHash}=require('node:crypto');
const {canonicalize}=require('../../../backend/src/organizationalProfile/canonicalization');
const {createPq1UiTokens}=require('../../../backend/src/organizationalProfile/pq1UiTokens');
const failure=()=>Object.assign(new Error('Invalid or stale cursor'),{code:'INVALID_CURSOR'});
function compare(a,b){return b.score-a.score||a.deadline.localeCompare(b.deadline)||a.id.localeCompare(b.id)||a.origin.localeCompare(b.origin)}
function createProof({key,clock=()=>Date.now()}){
 const tokens=createPq1UiTokens({keys:{proof:key},currentKeyId:'proof',clock});
 return async function page({source,context,cursor=null,pageSize=25}){
  if(!Number.isInteger(pageSize)||pageSize<1||pageSize>100)throw new TypeError('Invalid page size');
  const bind={...context,pageSize,algorithm:'synthetic-ranking-proof-v1'},position=cursor?tokens.openCursor(cursor,bind):null;
  if(position&&(!position.after||!/^[a-f0-9]{64}$/.test(position.digest||'')))throw failure();
  const digest=createHash('sha256'),selected=[];let total=0,seen=0;
  for await(const item of source()){
   if(++seen>10000)throw Object.assign(new Error('Proof budget exceeded'),{code:'LIMIT_EXCEEDED'});
   const encoded=Buffer.from(canonicalize(item),'utf8');digest.update(String(encoded.length)+':').update(encoded);
   if(!item.match)continue;total++;
   if(position&&compare(item,position.after)<=0)continue;
   selected.push(item);selected.sort(compare);if(selected.length>pageSize+1)selected.pop();
  }
  const fingerprint=digest.digest('hex');if(position&&position.digest!==fingerprint)throw failure();
  const items=selected.slice(0,pageSize),last=items.at(-1);
  return {items,total,nextCursor:selected.length>pageSize?tokens.cursor({after:last,digest:fingerprint},bind):null};
 };
}
module.exports={createProof,compare};
