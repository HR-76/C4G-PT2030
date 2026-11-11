'use strict';
const assert=require('node:assert/strict');
module.exports=async function pages(context,origin,record=()=>{}){
 const results=[];
 for(let repetition=0;repetition<3;repetition++)for(const route of ['/candidaturas']){
  const page=await context.newPage(),requests=[],started=new Map();
  page.on('request',r=>{if(new URL(r.url()).pathname.startsWith('/api/'))started.set(r,performance.now());});
  page.on('response',r=>{const start=started.get(r.request());if(start!==undefined)requests.push({path:new URL(r.url()).pathname,status:r.status(),ms:performance.now()-start});});
  const start=performance.now();
  try{
   const expected=route==='/dashboard'?/\/dashboard\/summary$/:route==='/candidaturas'?/\/applications\/browse(?:-page)?$/:route==='/notificacoes'?/\/notifications(?:\/refresh-list)?$/:/\/organization-directory$/;
   const ready=page.waitForResponse(r=>expected.test(new URL(r.url()).pathname),{timeout:60000});
   await page.goto(origin+route);
   const response=await ready;assert.equal(response.status(),200,'Primary request '+route);await response.finished();
   await page.locator('main').first().waitFor({timeout:60000});
   await page.waitForFunction(()=>document.querySelector('main')&&!document.querySelector('.loading-indicator'),{},{timeout:60000});
   if(route==='/candidaturas')await page.locator('table.applications-table tbody tr').first().waitFor({timeout:60000});
   // Let React commit the response and paint twice, not merely finish the fetch.
   await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
   if(route==='/notificacoes')await page.locator('[data-alert-results-ready]').first().waitFor({timeout:60000});
   const ms=performance.now()-start;
   const alerts=await page.locator('main [role="alert"]').allTextContents();
   assert.equal(alerts.length,0,'No error page '+route);
   const result={route,mode:'load',repetition,ms,requests};results.push(result);record(results);
   await page.waitForLoadState('networkidle',{timeout:60000});
   result.settledMs=performance.now()-start;
   assert(requests.every(r=>r.status<400),'No failed API response '+route);
   record(results);console.log('PAGE '+JSON.stringify({route,repetition,ms,settledMs:result.settledMs}));
  }catch(e){results.push({route,error:e.name,requests});record(results);throw e;}finally{await page.close();}
 }
 const page=await context.newPage();
 try{
  await page.goto(origin+'/dashboard');await page.locator('.dashboard-tabs').waitFor({timeout:60000});
  await page.waitForLoadState('networkidle',{timeout:60000});
  for(const route of ['/candidaturas']){
   const expected=route==='/dashboard'?/\/dashboard\/summary$/:route==='/candidaturas'?/\/applications\/browse(?:-page)?$/:route==='/notificacoes'?/\/notifications(?:\/refresh-list)?$/:/\/organization-directory$/;
   const ready=page.waitForResponse(r=>expected.test(new URL(r.url()).pathname),{timeout:60000}),start=performance.now();
   await page.locator('#primary-navigation a[href="'+route+'"]').click();
   const response=await ready;assert.equal(response.status(),200);await response.finished();
   await page.waitForFunction(()=>!document.querySelector('.loading-indicator'),{},{timeout:60000});
   if(route==='/candidaturas')await page.locator('table.applications-table tbody tr').first().waitFor({timeout:60000});
   await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
   assert.equal(await page.locator('main [role="alert"]').count(),0);
   if(route==='/notificacoes')await page.locator('[data-alert-results-ready]').first().waitFor({timeout:60000});
   const result={route,mode:'navigation',ms:performance.now()-start};results.push(result);record(results);
   console.log('NAVIGATION '+JSON.stringify(result));await page.waitForLoadState('networkidle',{timeout:60000});
  }
 }finally{await page.close();}
 return results;
};
