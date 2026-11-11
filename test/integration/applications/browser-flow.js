'use strict';
const path=require('node:path'),{pathToFileURL}=require('node:url');
const {chromium}=require('../../../frontend/test-harness/node_modules/playwright');
async function browserFlow({base,cookie,otherCookie,opportunityId,responsibleMembershipId,reviewerCookie=null,versionId=null,port=5173}){
 const root=path.resolve(__dirname,'../../../frontend');
 const {createServer}=await import(pathToFileURL(path.join(root,'node_modules/vite/dist/node/index.js')).href);
 const vite=await createServer({root,configFile:path.join(root,'vite.config.js'),logLevel:'error',
  define:{'import.meta.env.VITE_API_URL':JSON.stringify('/api')},server:{host:'localhost',port,strictPort:true,proxy:{'/api':{target:base,changeOrigin:true}}}});
 let browser;
 try{await vite.listen();browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});
  const open=async cookieValue=>{const context=await browser.newContext();await context.addCookies([{name:'c4g_session_dev',
   value:decodeURIComponent(cookieValue.slice(cookieValue.indexOf('=')+1)),domain:'localhost',path:'/',httpOnly:true,sameSite:'Lax'}]);return context.newPage()};
  const page=await open(cookie),other=await open(otherCookie),diagnostics=[];
  page.on('response',response=>{if(response.url().includes('/api/'))diagnostics.push({path:new URL(response.url()).pathname,status:response.status()})});
  await page.goto(`http://localhost:${port}/oportunidades/${opportunityId}`);
  try{await page.getByRole('link',{name:'Criar candidatura'}).click({timeout:30000})}
  catch(error){throw new Error(`APPLICATION_BROWSER_OPPORTUNITY: ${await page.locator('body').innerText()}`,{cause:error})}
  await page.getByLabel('Título',{exact:true}).fill('Candidatura browser');
  try{await page.getByLabel('Responsável da organização').selectOption(responsibleMembershipId,{timeout:30000})}
  catch(error){throw new Error(`APPLICATION_BROWSER_RESPONSIBLE: ${await page.locator('body').innerText()} ${JSON.stringify(diagnostics)}`,{cause:error})}
  await page.getByLabel('Prazo').fill('2026-12-31');
  let lostResponse=false;
  await page.route('**/api/applications',async route=>{
   if(route.request().method()==='POST'&&!lostResponse){lostResponse=true;const response=await route.fetch();
    if(response.status()!==201)throw Error(`APPLICATION_BROWSER_CREATE_SERVER_${response.status()}`);
    await route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:{code:'SERVICE_UNAVAILABLE'}})});return}
   await route.continue();
  });
  const uncertainResponse=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/applications'
   &&response.request().method()==='POST'&&response.status()===503,{timeout:30000});
  await page.getByRole('button',{name:'Criar candidatura'}).click();
  await uncertainResponse;
  if(!lostResponse)throw Error('APPLICATION_BROWSER_UNCERTAIN_RESPONSE_NOT_INJECTED');
  await page.getByRole('button',{name:'Repetir o mesmo envio'}).waitFor();
  await page.unroute('**/api/applications');await page.reload();
  await page.getByRole('button',{name:'Repetir o mesmo envio'}).click();
  try{await page.getByRole('heading',{name:'Candidatura',exact:true}).waitFor({timeout:30000})}
  catch(error){throw new Error(`APPLICATION_BROWSER_CREATE: ${await page.locator('body').innerText()} ${JSON.stringify(diagnostics)}`,{cause:error})}
  const detailUrl=page.url();
  await page.getByLabel('Título',{exact:true}).fill('Candidatura browser revista');
  await page.getByRole('button',{name:'Guardar alterações'}).click();
  await page.getByText('Revisão 2',{exact:false}).first().waitFor();
  await page.getByLabel('Motivo').fill('Preparação iniciada');
  await page.getByRole('button',{name:'Em preparação'}).click();
  await page.getByText('Revisão 3',{exact:false}).first().waitFor();
  await page.reload();await page.getByText('Estado: Em preparação',{exact:false}).waitFor();
  await page.getByRole('heading',{name:'Histórico'}).waitFor();
  let workProof=null;
  if(process.env.APPLICATION_WORK_SLICE_ONLY==='1'){
   await page.getByRole('heading',{name:'Equipa e tarefas'}).waitFor();
   await page.getByLabel('Adicionar participante').selectOption(responsibleMembershipId);
   await page.getByRole('button',{name:'Adicionar',exact:true}).click();
   await page.getByRole('button',{name:'Remover'}).waitFor();
   await page.getByLabel('Título da tarefa').fill('Preparar dossier');
   await page.getByLabel('Responsável da tarefa').selectOption(responsibleMembershipId);
   await page.getByLabel('Prazo da tarefa').fill('2027-01-30');
   await page.getByRole('button',{name:'Criar tarefa'}).click();
   await page.getByText('Preparar dossier',{exact:false}).first().waitFor();
   await page.getByRole('button',{name:'Editar',exact:true}).click();
   await page.getByLabel('Título da tarefa').fill('Preparar dossier revisto');
   await page.getByRole('button',{name:'Guardar tarefa'}).click();
   await page.getByText('Preparar dossier revisto',{exact:false}).first().waitFor();
   await page.getByRole('button',{name:'Concluir'}).click();
   await page.getByText('Concluída',{exact:false}).first().waitFor();
   await page.getByLabel('Título da tarefa').fill('Confirmar orçamento');
   await page.getByLabel('Responsável da tarefa').selectOption(responsibleMembershipId);
   await page.getByLabel('Prazo da tarefa').fill('2027-02-15');
   await page.getByRole('button',{name:'Criar tarefa'}).click();
   await page.getByRole('button',{name:'Cancelar',exact:true}).click();
   await page.getByText('Revisão da equipa e tarefas: 7.',{exact:false}).waitFor();
   await page.getByRole('button',{name:'Remover'}).click();
   try{await page.getByText('Revisão da equipa e tarefas: 8.',{exact:false}).waitFor({timeout:30000})}
   catch(error){throw new Error(`APPLICATION_WORK_REMOVE: ${await page.locator('body').innerText()}`,{cause:error})}
   await page.getByRole('button',{name:'Remover'}).waitFor({state:'detached'});
   await page.reload();
   await page.getByText('Preparar dossier revisto',{exact:false}).first().waitFor();
   await page.getByRole('heading',{name:'Histórico da equipa e tarefas'}).waitFor();
   if(await page.getByRole('button',{name:'Remover'}).count())throw Error('APPLICATION_WORK_PARTICIPANT_NOT_REMOVED');
   workProof={participantAddRemove:true,taskCreateEditCompleteCancel:true,historyReread:true};
  }
  let documentProof=null;
  if(process.env.APPLICATION_DOCUMENT_SLICE_ONLY==='1'){
   const reviewer=await open(reviewerCookie);
   const reviewerDiagnostics=[];reviewer.on('response',response=>{if(response.url().includes('/api/'))reviewerDiagnostics.push({path:new URL(response.url()).pathname,status:response.status()})});reviewer.on('pageerror',error=>reviewerDiagnostics.push({pageError:error.message}));
   await page.getByRole('heading',{name:'Documentos e revisão interna'}).waitFor();
   await page.getByLabel('Versão F11 disponível').selectOption(versionId);
   await page.getByRole('button',{name:'Associar versão'}).click();
   const downloadResponse=page.waitForResponse(response=>new URL(response.url()).pathname.endsWith(`/documents/versions/${versionId}/download`),{timeout:30000});
   await page.getByRole('button',{name:'Descarregar versão'}).click();
   if((await downloadResponse).status()!==200)throw Error('APPLICATION_DOCUMENT_BROWSER_DOWNLOAD_DENIED');
   await page.getByRole('button',{name:'Solicitar revisão do conjunto atual'}).click();
   await page.getByText('O requerente não pode decidir o próprio pedido.').waitFor();
   await reviewer.goto(detailUrl);
   await reviewer.getByRole('heading',{name:'Documentos e revisão interna'}).waitFor();
   await reviewer.getByLabel('Comentário').fill('Conjunto revisto no browser');
   const decisionResponse=reviewer.waitForResponse(response=>new URL(response.url()).pathname.endsWith('/documents/reviews/decide')&&response.request().method()==='POST',{timeout:30000});
   await reviewer.getByRole('button',{name:'Registar decisão'}).click();
   const response=await decisionResponse;if(response.status()!==200)throw new Error(`APPLICATION_DOCUMENT_BROWSER_DECISION_${response.status()}: ${await reviewer.locator('body').innerText()} ${JSON.stringify(reviewerDiagnostics)}`);
   await reviewer.getByText('Aprovado internamente',{exact:false}).first().waitFor();
   await reviewer.reload();try{await reviewer.getByText('Conjunto revisto no browser',{exact:false}).first().waitFor({timeout:90000})}
   catch(error){throw new Error(`APPLICATION_DOCUMENT_REVIEW_RELOAD: ${await reviewer.locator('body').innerText()} ${JSON.stringify(reviewerDiagnostics.slice(-20))}`,{cause:error})}
   await page.reload();await page.getByText('Conjunto revisto no browser',{exact:false}).first().waitFor();
   documentProof={versionSelected:true,requesterReviewer:true,decisionHistoryReread:true};
  }
  await other.goto(detailUrl);await other.getByRole('alert').waitFor();
  if(await other.getByText('Candidatura browser revista').count())throw Error('APPLICATION_CROSS_TENANT_DETAIL');
  return{create:true,edit:true,transition:true,historyReread:true,tenantBHidden:true,uncertainCreateRecovered:lostResponse,headlessChrome:true,...(workProof?{work:workProof}:{}),...(documentProof?{documents:documentProof}:{})};
 }finally{if(browser)await browser.close();await vite.close()}
}
module.exports={browserFlow};
