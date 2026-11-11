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
  const crypto=require('node:crypto'),samples=[];
  for(let i=0;i<3;i++){
   const result=await page.evaluate(async organizationId=>{const {organizationDirectoryApi}=await import('/src/api/api.js');const started=performance.now();const response=await organizationDirectoryApi(organizationId).matching({});return {ms:Math.round(performance.now()-started),data:response.data}},state.organizationId);
   const canonical=value=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(k=>[k,canonical(value[k])])):value;
   const sample={ms:result.ms,count:result.data.items.length,hash:crypto.createHash('sha256').update(JSON.stringify(canonical(result.data))).digest('hex')};samples.push(sample);console.log(JSON.stringify(sample));
  }
  const label=process.argv.includes('--after')?'after':'before';const dest=path.join(cfg.root,'output/matching-performance');fs.mkdirSync(dest,{recursive:true});fs.writeFileSync(path.join(dest,label+'.json'),JSON.stringify({samples},null,2));
  if(label==='after'){const before=JSON.parse(fs.readFileSync(path.join(dest,'before.json')));assert(samples.every(s=>s.hash===before.samples[0].hash));console.log('RESULT_PARITY_PASS')}
 }catch(e){console.error('MATCHING_BENCHMARK_FAILED',e.name);process.exitCode=1}finally{await browser.close()}
}
main().catch(()=>{console.error('MATCHING_BENCHMARK_FAILED');process.exitCode=1});
