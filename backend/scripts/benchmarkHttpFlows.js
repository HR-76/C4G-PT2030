'use strict';
// Deterministic in-process concurrent workload. No database, OIDC or Dev writes.
const {performance}=require('node:perf_hooks');
const {createOrganizationMatching}=require('../src/organizationDirectory/matching');
const {areas}=require('../src/organizationDirectory/thematicAreas');
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const tick=()=>new Promise(resolve=>setImmediate(resolve));
async function sample(size){
 let calls=0,details=0;const people=Array.from({length:size},(_,n)=>({personId:id(n+1),name:`Person ${n}`,active:true,areaIds:areas.map(a=>a.id)}));
 const service=createOrganizationMatching({directory:{async execute(method,query,personId){calls++;await tick();if(method==='context')return {};
  if(method==='person'){details++;return {person:people.find(p=>p.personId===personId),profile:{areaIds:areas.map(a=>a.id)}};}
  const offset=Number(query.cursor||0);return {items:people.slice(offset,offset+25),nextCursor:offset+25<size?String(offset+25):null};}},
  opportunities:{},central:{get:async()=>({snapshot:{title:'Education training',lifecycleState:'ACTIVE',closingDate:'2027-12-31'}})},clock:()=>new Date('2026-10-26T12:00:00Z')});
 const start=performance.now(),result=await service.execute({origin:'CENTRAL',opportunityId:id(9999)},{});
 return {ms:performance.now()-start,calls,details,items:result.items.length};
}
(async()=>{const results=[];for(const size of [25,250,1000]){
 const samples=[];for(let batch=0;batch<5;batch++)samples.push(...await Promise.all(Array.from({length:4},()=>sample(size))));
 const times=samples.map(s=>s.ms).sort((a,b)=>a-b);results.push({size,concurrency:4,samples:samples.length,p50:times[9],p95:times[18],calls:samples[0].calls,individualDetails:samples[0].details,items:samples[0].items});
 }console.log(JSON.stringify({kind:'in-process doubles; setImmediate per directory call; not HTTP/PostgreSQL or production SLO',results},null,2));})().catch(e=>{console.error(e);process.exitCode=1;});
