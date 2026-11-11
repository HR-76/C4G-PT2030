'use strict';
const assert=require('node:assert/strict');
const {summarize}=require('./durable-load.cjs');
const {validate}=require('../../../backend/src/opportunities/catalogRead/contractValidation');
const orders=[['A','C1','C2'],['C1','C2','A'],['C2','A','C1'],['A','C2','C1'],['C2','C1','A'],['C1','A','C2']];
async function settle(selector,pools){
 const deadline=Date.now()+15000;let stable=0;
 while(Date.now()<deadline){
  if(selector.active===0&&pools.every(p=>p.waitingCount===0&&p.idleCount===p.totalCount)){if(++stable===3)return;}else stable=0;
  await new Promise(r=>setTimeout(r,10));
 }
 throw Error('VARIANT_SETTLEMENT_TIMEOUT');
}
async function runLoad({catalog,http,admin,renew,report,save,sessionDiagnostics,selector,db}){
 const pools=[catalog.catalogPool,catalog.authorityPool,db.central.authorityPool];assert(sessionDiagnostics);
 const result={status:'RUNNING',design:'balanced six permutations; A previous, C1 only, C2 only',target:{concurrency:10,serverP95Ms:500,seriesPerArm:6,requestsPerSeries:10,warmupsPerBlock:10},orders,fixtures:[],scenarios:[]};report.load=result;save();
 for(const volume of [27,10000]){
  const fixture=await catalog.seed(volume);result.fixtures.push({volume,storedPayloadBytes:fixture.storedPayloadBytes,seedMs:fixture.seedMs});await renew();
  const cold=await http(admin,'/api/catalog-read/v1/opportunities');assert.equal(cold.status,200);const snapshot=encodeURIComponent(cold.data.meta.snapshot),id=cold.data.data[0].id;
  await settle(selector,pools);
  for(const [name,route] of [['list','/api/catalog-read/v1/opportunities'],['detail',`/api/catalog-read/v1/opportunities/${id}?snapshot=${snapshot}`]]){
   const scenario={volume,name,blocks:[]};result.scenarios.push(scenario);
   const sample=async()=>{const r=await http(admin,route);return {status:r.status,serverMs:Number.isFinite(r.serverMs)?r.serverMs:null,httpMs:Number.isFinite(r.httpMs)?r.httpMs:null,errorCode:r.data?.error?.code||null,phases:r.phases,contractValid:r.status===200&&validate(name==='list'?'ListResponse':'DetailResponse',r.data).valid&&(name==='list'?r.data.data.length===25:r.data.data.summary.id===id)};};
   for(let round=0;round<orders.length;round++)for(let position=0;position<3;position++){
    const arm=orders[round][position];await settle(selector,pools);selector.set(arm);await renew();await settle(selector,pools);
    const before=selector.counts();sessionDiagnostics.start();const warmups=await Promise.all(Array.from({length:10},sample));await settle(selector,pools);const warmDiagnostics=sessionDiagnostics.finish();
    assert.equal(warmDiagnostics.phases['touch.total']?.count,10);assert.equal(summarize(warmups).errors,0);
    sessionDiagnostics.start();const samples=await Promise.all(Array.from({length:10},sample));await settle(selector,pools);const diagnostics=sessionDiagnostics.finish();
    assert.equal(diagnostics.phases['touch.total']?.count,10);assert.equal(diagnostics.phases['sessionRead.admission']?.count,10);assert.equal(diagnostics.dropped,0);
    const after=selector.counts();assert.equal(selector.arm,arm);assert.equal(selector.active,0);
    for(const k of Object.keys(after))if(!k.startsWith(arm+':'))assert.equal(after[k],before[k]);
    const selectedCounts=Object.fromEntries(Object.keys(after).filter(k=>k.startsWith(arm+':')).map(k=>[k.split(':')[1],after[k]-(before[k]||0)]));
    assert(selectedCounts.reader>=20);assert.equal(selectedCounts[arm==='C2'?'combinedReader':'baselineReader'],selectedCounts.reader);
    if(arm==='C1')assert(selectedCounts.localVersion>0);else assert.equal(selectedCounts.localVersion||0,0);
    const block={round:round+1,position:position+1,arm,selectedCounts,warmups,samples,...summarize(samples),diagnostics,warmDiagnostics};assert.equal(block.errors,0);scenario.blocks.push(block);save();
    console.log('ALTERNATING '+volume+' '+name+' '+(round+1)+' '+arm+' '+block.serverP95Ms);
   }
  }
 }
 await settle(selector,pools);selector.set('BOTH');result.selectorCounts=selector.counts();result.status=result.scenarios.every(s=>s.blocks.every(b=>b.serverP95Ms<=500))?'PASS':'NOT_ACCEPTED';save();return result;
}
module.exports={runLoad,settle,orders};
