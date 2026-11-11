"use strict";
const assert=require('node:assert/strict');
const {seed}=require('../catalog-acceptance/catalog-fixture.cjs');
const quantile=(values,q)=>{const a=values.filter(Number.isFinite).sort((a,b)=>a-b);return a.length?Math.round(a[Math.ceil(a.length*q)-1]*100)/100:null};
async function run({pool,get,actor}){
 const report={status:'RUNNING',authentication:'signed synthetic sessions; NOT an OIDC acceptance',target:{opportunities:10000,concurrency:10,pageSize:25,runs:5,requestsPerRun:10,serverP95Ms:500},fixtures:[],scenarios:[],limits:['Single machine, no external network, existing reader limits unchanged','Baseline 27 vs 10000 measures volume scaling, not a before/after code optimization','The native reader and authority pools each retain their existing max=2 connections; 10 HTTP requests compete for these pools']};
 for(const volume of [27,10000]){
  console.log('LOAD_SEED_START '+volume);const fixture=await seed(pool,volume);report.fixtures.push({volume,storedPayloadBytes:fixture.storedPayloadBytes,seedMs:fixture.seedMs,readerMaxBytes:67108864});
  for(const [name,path,query] of [['list','/opportunities',{sort:'title'}],['detail','/opportunities/'+fixture.firstId,{}]]){
   async function request(){const start=performance.now();try{const r=await get(path,query,actor);return {status:r.status,data:r.body,httpMs:performance.now()-start,serverMs:Number(/dur=([0-9.]+)/.exec(r.headers.get('server-timing')||'')?.[1])};}catch(e){return {status:0,httpMs:performance.now()-start,serverMs:null,code:e.name==='TimeoutError'?'TIMEOUT':'TRANSPORT_ERROR'}}}
   const warmups=await Promise.all(Array.from({length:10},request));const useful=warmups.every(r=>r.status===200);const scenario={volume,name,mode:useful?'USEFUL_LOAD':'REJECTION_DIAGNOSTIC',warmups:warmups.map(r=>({status:r.status,serverMs:r.serverMs,httpMs:r.httpMs,errorCode:r.data?.error?.code||r.code||null})),runs:[]};
   for(let run=1;run<=5;run++){
    const requests=await Promise.all(Array.from({length:10},request));const successes=requests.filter(r=>r.status===200);for(const r of successes){if(name==='list')assert.equal(r.data.data.length,25);else assert.equal(r.data.data.summary.id,fixture.firstId);}
    scenario.runs.push({run,attempts:10,successes:successes.length,errors:10-successes.length,serverP50Ms:quantile(successes.map(r=>r.serverMs),.5),serverP95Ms:quantile(successes.map(r=>r.serverMs),.95),httpP95Ms:quantile(successes.map(r=>r.httpMs),.95),samples:requests.map(r=>({status:r.status,serverMs:r.serverMs,httpMs:Math.round(r.httpMs*100)/100,errorCode:r.data?.error?.code||r.code||null}))});
    console.log('LOAD_MEASURE '+volume+' '+name+' '+run+' '+successes.length+'/10');
   }
   scenario.accepted=useful&&scenario.runs.every(r=>r.errors===0&&r.serverP95Ms!==null&&r.serverP95Ms<=500);report.scenarios.push(scenario);
  }
 }
 report.status=report.scenarios.every(s=>s.accepted)?'PASS':'NOT_ACCEPTED';return report;
}
module.exports={run};
