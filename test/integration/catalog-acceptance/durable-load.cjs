'use strict';
const assert=require('node:assert/strict');
function percentile(values,q){const v=values.slice().sort((a,b)=>a-b);return v.length?Math.round(v[Math.ceil(v.length*q)-1]*100)/100:null;}
function summarize(samples){const ok=samples.filter(s=>s.status===200&&Number.isFinite(s.serverMs)&&Number.isFinite(s.httpMs)&&s.contractValid);return {attempts:samples.length,successes:ok.length,errors:samples.length-ok.length,serverP95Ms:percentile(ok.map(s=>s.serverMs),.95),httpP95Ms:percentile(ok.map(s=>s.httpMs),.95)};}
async function runLoad({catalog,http,admin,renew,report,save,sessionDiagnostics=null,volumes=[27,10000]}){
 const result={status:'RUNNING',profileOnly:volumes.length===1,authentication:'real local OIDC session, TLS/PKCE; synthetic institutional identities',target:{opportunities:10000,concurrency:10,pageSize:25,runs:5,requestsPerRun:10,serverP95Ms:500},fixtures:[],scenarios:[]};report.load=result;save();
 for(const volume of volumes){
  const fixture=await catalog.seed(volume);result.fixtures.push({volume,storedPayloadBytes:fixture.storedPayloadBytes,seedMs:fixture.seedMs});await renew();
  const cold=await http(admin,'/api/catalog-read/v1/opportunities');assert.equal(cold.status,200);assert.equal(cold.data.data.length,25);
  result.fixtures.at(-1).coldList={status:cold.status,serverMs:cold.serverMs,httpMs:cold.httpMs};
  const snapshot=encodeURIComponent(cold.data.meta.snapshot),id=cold.data.data[0].id;
  for(const [name,route] of [['list','/api/catalog-read/v1/opportunities'],['detail',`/api/catalog-read/v1/opportunities/${id}?snapshot=${snapshot}`]]){
   await renew();const scenario={volume,name,warmups:[],runs:[]};result.scenarios.push(scenario);
   const sample=async()=>{const r=await http(admin,route);return {status:r.status,serverMs:Number.isFinite(r.serverMs)?r.serverMs:null,httpMs:Number.isFinite(r.httpMs)?r.httpMs:null,errorCode:r.data?.error?.code||null,...(r.phases?{phases:r.phases}:{}),contractValid:r.status===200&&r.data?.meta?.contractVersion==='gcni-catalog-read/1.0'&&(name==='list'?Array.isArray(r.data.data)&&r.data.data.length===25:r.data?.data?.summary?.id===id)};};
   scenario.warmups=await Promise.all(Array.from({length:10},sample));
   sessionDiagnostics?.start();
   for(let run=1;run<=5;run++){const samples=await Promise.all(Array.from({length:10},sample));scenario.runs.push({run,...summarize(samples),samples});save();}
   if(sessionDiagnostics)scenario.sessionDiagnostics=sessionDiagnostics.finish();
   scenario.accepted=summarize(scenario.warmups).errors===0&&scenario.runs.every(r=>r.errors===0&&r.serverP95Ms!==null&&r.serverP95Ms<=500);save();
  }
 }
 result.status=result.scenarios.every(s=>s.accepted)?'PASS':'NOT_ACCEPTED';save();return result;
}
module.exports={runLoad,summarize,percentile};
