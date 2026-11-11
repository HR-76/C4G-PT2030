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
  const routes=platform?['/administracao/dashboard','/catalogo','/integracoes','/administracao/importar','/administracao/entidades','/administracao/logs','/conta/seguranca']:['/dashboard','/catalogo','/oportunidades','/candidaturas','/parceiros','/matching','/notificacoes','/perfil-organizacao','/perfil-organizacao/unidades','/perfil-organizacao/pessoas','/utilizadores','/perfil','/conta/seguranca'];
  const requested=process.argv.find(a=>a.startsWith('--routes='))?.slice(9).split(',');
  for(const route of requested||routes){
   stage=route+' navigation';errors=[];responses=[];blocked=[];await page.goto('http://localhost:3000'+route);await page.waitForLoadState('networkidle',{timeout:90000});await page.locator('main').first().waitFor();
   stage=route+' screenshots';const sizes=[];for(const width of [1440,390]){await page.setViewportSize({width,height:1000});await page.screenshot({path:path.join(out,route.slice(1).replaceAll('/','-')+'-'+width+'.png'),fullPage:true,animations:'disabled'});sizes.push({width,overflow:await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1)})}
   results.push({route,headings:await page.locator('main h1').allTextContents(),alerts:await page.locator('main [role="alert"]').allTextContents(),errors:[...errors],responses:[...responses],blocked:[...blocked],sizes});fs.writeFileSync(path.join(out,'review.json'),JSON.stringify({observedAt:new Date().toISOString(),routes:results},null,2));console.log(JSON.stringify(results.at(-1)));await page.setViewportSize({width:1440,height:1000});
  }
  fs.writeFileSync(path.join(out,'review.json'),JSON.stringify({observedAt:new Date().toISOString(),routes:results},null,2));
 }catch(e){console.error('SECTIONS_REVIEW_FAILED',stage,e.name, String(e.message).split('\n')[0]);process.exitCode=1}finally{await browser.close()}
}
main().catch(()=>{console.error('SECTIONS_REVIEW_FAILED');process.exitCode=1});
