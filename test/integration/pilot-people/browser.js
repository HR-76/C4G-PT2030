'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto'),{pathToFileURL}=require('node:url');
const {chromium}=require('../../../frontend/test-harness/node_modules/playwright');
async function run({central,tenants,http,actor,manager,other,reader,base}){
 const root=path.resolve(__dirname,'../../..'),out=path.join(root,'output/playwright/c4g-pilot-people');fs.mkdirSync(out,{recursive:true});
 const admin=await actor(tenants[0].org,[]);await central.pool.query("INSERT INTO public.platform_admin_assignment(id,global_user_id,role_code,status) VALUES($1,$2,'C4G_ADMIN','ACTIVE')",[randomUUID(),admin.id]);
 const repository=require('../../../backend/src/fundingTenders/repository').createFundingRepository({pool:central.pool});
 const queued=await repository.enqueue(admin.id,randomUUID()),run=await repository.claim(queued.runId);
 const fields={title:'Formação e competências — ensaio',summary:'Education training vocational students school learning skills.',programmeName:'Programa de ensaio',funderName:'Entidade de ensaio',officialUrl:'https://example.invalid/education',callReference:'PILOT-EDUCATION',closingDate:'2030-01-01'};
 await repository.stage(run,{records:[{externalIdentifier:'PILOT-EDUCATION',fields}],observedAt:new Date().toISOString(),received:1,failed:0,limited:false});
 for(const item of await repository.pending(run))await repository.apply(run,item);await repository.finish(run);
 const pub=(await repository.list()).items.find(x=>x.title===fields.title);assert(pub);
 const privateResult=await http(manager,'/api/opportunities','POST',{requestId:randomUUID(),fields:{...fields,title:'Convite privado — ensaio'}});assert.equal(privateResult.status,201,JSON.stringify(privateResult.data));
 const {preview}=await import(pathToFileURL(path.join(root,'frontend/node_modules/vite/dist/node/index.js')).href);
 const vite=await preview({root:path.join(root,'frontend'),configFile:path.join(root,'frontend/vite.config.js'),logLevel:'error',preview:{host:'localhost',port:5271,strictPort:true,proxy:{'/api':{target:base,changeOrigin:true}}}});
 let browser,page;const errors=[];
 try{
  browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});
  async function open(user){const context=await browser.newContext({viewport:{width:1440,height:1000}});await context.addCookies([{name:'c4g_session_dev',value:decodeURIComponent(user.cookie.slice(user.cookie.indexOf('=')+1)),domain:'localhost',path:'/',httpOnly:true,sameSite:'Lax'}]);const p=await context.newPage();p.setDefaultTimeout(60000);p.on('pageerror',e=>errors.push(e.message));return p}
  page=await open(manager);
  const go=route=>page.goto('http://localhost:5271'+route);
  await go('/perfil-organizacao/unidades');await page.getByRole('button',{name:'Criar unidade',exact:true}).click();await page.getByLabel('Nome da unidade').fill('Unidade de projetos');await page.getByRole('button',{name:'Guardar alterações'}).click();await page.getByText('Unidade de projetos',{exact:true}).first().waitFor();
  await page.screenshot({animations:'disabled',path:path.join(out,'c4g-units-1440.png'),fullPage:true});
  await go('/perfil-organizacao/pessoas');await page.getByRole('button',{name:'Registar pessoa',exact:true}).click();await page.getByLabel('Nome da pessoa').fill('Pessoa de ensaio visual');await page.getByLabel('Email (opcional)').fill('pessoa@example.invalid');await page.getByLabel('Função (opcional)').fill('Gestão de projetos');await page.getByLabel('Unidade de projetos',{exact:true}).check();await page.getByRole('button',{name:'Guardar alterações'}).click();await page.getByRole('link',{name:'Pessoa de ensaio visual',exact:true}).waitFor();
  await page.screenshot({animations:'disabled',path:path.join(out,'c4g-people-1440.png'),fullPage:true});
  await page.getByRole('link',{name:'Pessoa de ensaio visual',exact:true}).click();await page.getByLabel('Biografia').fill('Experiência em projetos de educação e formação.');await page.getByLabel('Palavras-chave',{exact:true}).fill('educação, formação');await page.getByLabel('Educação e Formação Profissional',{exact:true}).check();await page.getByRole('button',{name:'Guardar perfil',exact:true}).click();await page.getByText('Perfil atualizado.',{exact:true}).waitFor();
  await page.getByRole('button',{name:'Consultar associação e contas'}).click();await page.getByLabel('Conta da organização').selectOption(manager.membershipId);await page.getByRole('button',{name:'Guardar associação'}).click();await page.waitForFunction(()=>!document.querySelector('button[type=submit]')?.disabled);await page.getByText('Perfil atualizado.',{exact:true}).waitFor();
  await go('/perfil');await page.getByLabel('Biografia').waitFor();assert.equal(await page.getByLabel('Biografia').inputValue(),'Experiência em projetos de educação e formação.');
  for(const width of [1440,1008,390]){await page.setViewportSize({width,height:1000});if(width<769)await page.waitForFunction(()=>document.querySelector('#primary-navigation')?.getAttribute('aria-hidden')==='true');assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await page.screenshot({animations:'disabled',path:path.join(out,`c4g-profile-${width}.png`),fullPage:true})}
  await page.setViewportSize({width:1440,height:1000});await go('/matching');await page.getByRole('link',{name:fields.title,exact:true}).waitFor();await page.getByRole('link',{name:'Convite privado — ensaio',exact:true}).waitFor();
  await page.locator('summary').first().click();await page.getByText(/Classificação sugerida pelas palavras:/).first().waitFor();
  for(const width of [1440,1008,390]){await page.setViewportSize({width,height:1000});if(width<769)await page.waitForFunction(()=>document.querySelector('#primary-navigation')?.getAttribute('aria-hidden')==='true');assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await page.screenshot({animations:'disabled',path:path.join(out,`c4g-matching-${width}.png`),fullPage:true})}
  await page.setViewportSize({width:1440,height:1000});await go(`/matching?oportunidade=${pub.opportunityId}&origem=CENTRAL`);await page.getByRole('link',{name:'Pessoa de ensaio visual',exact:true}).waitFor();await page.screenshot({animations:'disabled',path:path.join(out,'c4g-opportunity-people-1440.png'),fullPage:true});
  const isolated=await open(other);await isolated.goto('http://localhost:5271/perfil-organizacao/pessoas');await isolated.getByRole('heading',{name:'Nenhuma pessoa encontrada'}).waitFor();assert.equal(await isolated.getByText('Pessoa de ensaio visual',{exact:true}).count(),0);
  await go('/utilizadores');await page.getByRole('heading',{name:'Acessos da organização'}).waitFor();await page.getByRole('button',{name:'Suspender acesso'}).first().waitFor();await page.screenshot({animations:'disabled',path:path.join(out,'c4g-access-1440.png'),fullPage:true});
  assert.equal(errors.length,0);
  fs.writeFileSync(path.join(out,'browser-verification.json'),JSON.stringify({result:'PASS',synthetic:true,postgres:true,identity:'session fixture',unitCreate:true,personCreate:true,profileSaveReload:true,explicitAccountAssociation:true,selfProfile:true,matchingCentralPrivate:true,opportunityPeople:true,isolation:true,widths:[1440,1008,390],pageErrors:errors},null,2));
  console.log('PILOT_PEOPLE_CHROME_POSTGRES_PASS');
 }catch(error){if(page){await page.screenshot({animations:'disabled',path:path.join(out,'failure.png'),fullPage:true});console.error('PILOT_BROWSER_STATE',(await page.locator('body').innerText()).slice(-2200))}throw error}
 finally{await browser?.close();await new Promise(resolve=>vite.httpServer.close(resolve))}
}
module.exports={run};
