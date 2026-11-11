'use strict';
const assert=require('node:assert/strict'), path=require('node:path');
module.exports=async function pages(context,origin,record=()=>{}){
 const results=[];
 for(const width of [1440,390])for(const route of ['/dashboard','/catalogo','/candidaturas'])for(let repetition=0;repetition<2;repetition++){
  const page=await context.newPage();await page.setViewportSize({width,height:900});const requests=[],started=new Map();page.on('request',r=>{if(new URL(r.url()).pathname.startsWith('/api/'))started.set(r,performance.now())});page.on('response',r=>{const start=started.get(r.request());if(start!==undefined)requests.push({path:new URL(r.url()).pathname,status:r.status(),ms:Math.round(performance.now()-start)})});
  const start=performance.now();try{
   await page.goto(origin+route);const heading=route==='/dashboard'?'Dashboard operacional':route==='/catalogo'?'Catálogo C4G':'Candidaturas';await page.getByRole('heading',{name:heading,exact:true}).first().waitFor({timeout:60000});
   if(route==='/dashboard')await page.locator('.dashboard-charts').waitFor({timeout:60000});
   if(route==='/catalogo')await page.locator('.catalog-empty, .catalog-summary .data-table').first().waitFor({timeout:60000});
   if(route==='/candidaturas')await page.locator('table.applications-table tbody tr').first().waitFor({timeout:60000});
   await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));const elapsed=Math.round(performance.now()-start);const dims=await page.evaluate(()=>({width:innerWidth,scrollWidth:document.documentElement.scrollWidth}));assert(dims.scrollWidth<=dims.width+1,'horizontal overflow '+route);
   const alerts=await page.locator('main [role="alert"]').allTextContents();assert.equal(alerts.length,0,'error '+route);if(repetition===0&&route==='/catalogo'){const link=page.getByRole('link',{name:'Oportunidade sintética de teste'}).first();await link.waitFor({timeout:60000});const t=performance.now();await link.click();await page.waitForURL(u=>u.pathname.startsWith('/catalogo/'),{timeout:60000});await page.getByText('Oportunidade sintética de teste').first().waitFor({timeout:60000});results.push({route:'catalogo-detalhe',width,readyMs:Math.round(performance.now()-t)});const interest=page.getByRole('button',{name:/Registar interesse/}).first();if(await interest.count()){await interest.click();await page.getByRole('dialog').waitFor({timeout:10000});results.push({route:'registar-interesse-dialogo',width,observed:true})}} if(repetition===0){const out=path.resolve(__dirname,'../../../context/reviews',process.env.HTTP_PROOF_REPORT);await page.screenshot({path:path.join(out,route.slice(1)+'-'+width+'.png'),fullPage:true});} results.push({route,width,repetition,readyMs:elapsed,dims,requests});record(results);console.log('UX_PAGE '+JSON.stringify({route,width,repetition,readyMs:elapsed}));
  }catch(e){results.push({route,width,repetition,error:e.name,requests});record(results);throw e}finally{await page.close()}
 }
 return results;
};



