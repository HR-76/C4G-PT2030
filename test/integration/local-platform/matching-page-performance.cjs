'use strict';
const fs=require('fs'),path=require('path'),assert=require('node:assert/strict'),{chromium}=require('../../../frontend/test-harness/node_modules/playwright'),cfg=require('../../../backend/scripts/localPlatform/config');
async function main(){
 const platform=process.argv.includes('--platform'),access=JSON.parse(fs.readFileSync(path.join(cfg.folder,'access.json'))),state=JSON.parse(fs.readFileSync(path.join(cfg.folder,'runtime.json'))),out=path.join(cfg.root,process.argv.includes('--after')?'output/playwright/sections-review-after'+(platform?'-platform':''):'output/playwright/sections-review');fs.mkdirSync(out,{recursive:true});
 const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'}),results=[];let stage='login';
 try{const page=await browser.newPage({viewport:{width:1440,height:1000},reducedMotion:'reduce'});let errors=[],responses=[],blocked=[];
  page.on('pageerror',e=>errors.push(e.name));page.on('response',r=>{if(new URL(r.url()).origin==='http://localhost:3000'&&r.status()>=400)responses.push({path:new URL(r.url()).pathname,status:r.status()})});
  await page.route('**/api/**',route=>{const r=route.request(),p=new URL(r.url()).pathname;if(!p.startsWith('/api/auth/')&&!['GET','HEAD','OPTIONS'].includes(r.method())){blocked.push(p);return route.abort()}return route.continue()});
  const credentials=platform?access.admin:access.hugo;
  await page.goto('http://localhost:3000/');await page.locator('#username').fill(credentials.username);await page.locator('#password').fill(credentials.password);await page.locator('#kc-login').click();await page.waitForURL(platform?'http://localhost:3000/administracao/dashboard':'http://localhost:3000/catalogo');
  if(!platform){const selector=page.getByRole('combobox',{name:'Organização ativa'});await page.waitForFunction(()=>{const el=document.querySelector('select[aria-label="Organização ativa"]');return el&&!el.disabled});if(await selector.inputValue()!==state.organizationId)await selector.selectOption(state.organizationId)}

  await page.waitForLoadState('networkidle',{timeout:90000});

  const samples=[];
  for(let i=0;i<3;i++){
   let matchingRequests=0,peopleRequests=0;const captures=[];
   const canonical=value=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(k=>[k,canonical(value[k])])):value;
   const responseListener=r=>{if(new URL(r.url()).pathname.endsWith('/organization-directory/matching'))captures.push(r.json().then(data=>({hash:require('node:crypto').createHash('sha256').update(JSON.stringify(canonical(data))).digest('hex'),endpointMs:Math.round(r.request().timing().responseEnd)})))};page.on('response',responseListener);
   const listener=r=>{const p=new URL(r.url()).pathname;if(p.endsWith('/organization-directory/matching'))matchingRequests++;if(p.endsWith('/organization-directory/people'))peopleRequests++};page.on('request',listener);
   const started=performance.now();await page.goto('http://localhost:3000/matching');await page.locator('.pilot-matching tbody tr').first().waitFor({timeout:90000});const readyMs=Math.round(performance.now()-started);await page.waitForLoadState('networkidle',{timeout:90000});page.off('request',listener);page.off('response',responseListener);const contents=await Promise.all(captures);
   const sample={readyMs,matchingRequests,peopleRequests,contents,count:await page.locator('.pilot-matching tbody tr').count()};if(process.argv.includes('--after')){const before=JSON.parse(fs.readFileSync(path.join(cfg.root,'output/matching-performance/before.json')));assert(contents.length===1);assert.equal(contents[0].hash,before.samples[0].hash);assert.equal(matchingRequests,1);assert.equal(peopleRequests,1)}samples.push(sample);console.log(JSON.stringify(sample));
  }
  const label=process.argv.includes('--after')?'page-after':'page-before';const dest=path.join(cfg.root,'output/matching-performance');fs.mkdirSync(dest,{recursive:true});fs.writeFileSync(path.join(dest,label+'.json'),JSON.stringify({samples},null,2));
 }catch(e){console.error('MATCHING_PAGE_BENCHMARK_FAILED',e.name);process.exitCode=1}finally{await browser.close()}
}
main().catch(()=>{console.error('MATCHING_PAGE_BENCHMARK_FAILED');process.exitCode=1});
