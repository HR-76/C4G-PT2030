'use strict';
const {performance}=require('node:perf_hooks');
const {fixture,id}=require('../test/support/httpSqlFixture');
const {createApplicationRepository}=require('../src/applications/repository');
const {createPq1UiTokens}=require('../src/organizationalProfile/pq1UiTokens');
const {query}=require('../src/applications/contracts');
async function bench(size){
 const fixtures=[];try{
 for(let i=0;i<4;i++)fixtures.push(await fixture(size));
 const services=fixtures.map(f=>createApplicationRepository({organizationId:f.org,actor:{id:id(200000)},protect:async()=>{},
  readAuthority:async()=>({teamOnly:false,membershipId:f.member,application:{all:true,ids:[]},opportunity:{all:true,ids:[]},evaluation:{all:true,ids:[]},version:[1,1]}),
  responsibleDirectory:async()=>new Map([[f.member,'Responsável']]),transitionCapability:async()=>false,
  cursor:createPq1UiTokens({keys:{test:'x'.repeat(32)},currentKeyId:'test'}),audit:async()=>{}}));
 const results=[];
 for(const method of ['browse','report']){
  const samples=[];
  for(let round=0;round<6;round++){
   const batch=await Promise.all(services.map(async(service,i)=>{const started=performance.now(),value=await service[method](fixtures[i].client,query(method,{}));return {ms:performance.now()-started,bytes:Buffer.byteLength(JSON.stringify(value)),rows:value.items.length,total:value.total};}));
   if(round)samples.push(...batch);
  }
  const times=samples.map(s=>s.ms).sort((a,b)=>a-b);
  results.push({method,total:size,concurrency:4,samples:20,p50:times[9],p95:times[18],returnedRows:samples[0].rows,bytes:samples[0].bytes,sqlQueriesPerRequest:1});
 }
 return results;
 }finally{await Promise.all(fixtures.map(f=>f.close()));}
}
(async()=>{const results=[];for(const size of [25,1000,10000])results.push(...await bench(size));
 console.log(JSON.stringify({kind:'PostgreSQL temporary tables in postgres; four connections; authority doubles; after only; not production HTTP/OIDC',results},null,2));
})().catch(error=>{console.error(error.code||error.name);process.exitCode=1;});
