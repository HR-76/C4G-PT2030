'use strict';
const assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');
async function run({central,databases,pageFor,control}){
 const pages=[];
 for(const db of databases){
  const version=(await central.pool.query('SELECT authorization_version FROM public.authority_f5_state WHERE membership_id=$1',[db.maker.membershipId])).rows[0];
  await central.data.change({organizationId:db.org,membershipId:db.maker.membershipId,expectedVersion:Number(version.authorization_version),grants:['opportunity.read','opportunity.private.create','opportunity.private.update','opportunity.criteria.read','opportunity.criteria.edit','opportunity.criteria.confirm'].map(permission=>({permission,scope:{type:'ORGANIZATION',id:db.org,organizationId:db.org}})),assuranceRequirements:central.requirement});
  const page=await pageFor(db.maker);pages.push(page);
  const csrf=(await (await page.request.get('http://localhost:5173/api/auth/csrf')).json()).csrfToken;
  db.call=async(path,body,method=body?'POST':'GET')=>{const response=await page.request.fetch('http://localhost:5173/api'+path,{method,headers:{'X-CSRF-Token':csrf,Origin:'http://localhost:5173'},...(body?{data:body}:{})});const value=await response.json();assert(!/"\w*(digest|secret|password)\w*"\s*:/i.test(JSON.stringify(value)));console.log("CRITERIA_HTTP",method,path.replace(/[a-f0-9-]{36}/g,":id"),response.status());return {status:response.status(),value};};
  let r=await db.call('/opportunities',{requestId:randomUUID(),fields:{title:'Synthetic evidenced criteria',funderName:'Synthetic funder',summary:'Synthetic example only'}});assert.equal(r.status,201,JSON.stringify(r));db.op=r.value;
  db.root='/opportunities/'+db.op.opportunityId+'/criteria';
  r=await db.call(db.root);assert.equal(r.status,200,JSON.stringify(r));assert.equal(r.value.head,null);
  r=await db.call(db.root+'/catalog?kind=THEMATIC_AFFINITY');assert.equal(r.status,200,JSON.stringify(r));assert(r.value.items.length);const ref=r.value.items[0].conceptRef;
  const sourceId=randomUUID();db.save={requestId:randomUUID(),expectedHeadRevision:0,opportunityRevisionId:db.op.revisionId,criteria:[{criterionId:randomUUID(),kind:'THEMATIC_AFFINITY',interpretationText:'Synthetic thematic affinity',conceptRef:ref,temporalBasis:null,evidence:{sourceId,locator:'Clause 1',excerpt:'Theme preferred.',justification:'Explicit synthetic preference'}}],sources:[{sourceId,sourceKind:'SYNTHETIC',label:'Synthetic source',reference:'urn:synthetic:criteria',versionLabel:'v1',capturedText:'Theme preferred.'}]};
  if(db===databases[0]){
   await page.goto('http://localhost:5173/oportunidades/'+db.op.opportunityId);await page.getByRole('button',{name:/^Recarregar revis/}).click();
   for(let attempt=0;attempt<3;attempt++){await page.locator('.criteria-panel[aria-busy="false"]').waitFor();if(await page.getByRole('button',{name:'Adicionar afinidade temática',exact:true}).isEnabled())break;await page.getByRole('button',{name:'Voltar a consultar critérios',exact:true}).click();}
   await page.getByRole('button',{name:'Adicionar afinidade temática',exact:true}).click();await page.getByRole('button',{name:'Adicionar fonte',exact:true}).click();
   await page.getByRole('textbox',{name:/^Interpretação/}).fill('Synthetic thematic affinity');await page.getByRole('combobox',{name:/^Conceito publicado/}).selectOption({index:1});
   await page.getByLabel('Nome da fonte',{exact:true}).fill('Synthetic source');await page.getByLabel('Referência da fonte',{exact:true}).fill('urn:synthetic:criteria');await page.getByLabel('Versão da fonte',{exact:true}).fill('v1');await page.getByLabel('Texto capturado',{exact:true}).fill('Theme preferred.');
   await page.getByRole('combobox',{name:/^Fonte/}).selectOption({index:1});await page.getByLabel('Cláusula/localização',{exact:true}).fill('Clause 1');await page.getByLabel('Trecho exato',{exact:true}).fill('Theme preferred.');await page.getByLabel('Justificação da interpretação',{exact:true}).fill('Explicit synthetic preference');
   const saved=page.waitForResponse(response=>response.request().method()==='POST'&&new URL(response.url()).pathname.endsWith(db.root+'/revisions'));
   await page.getByRole('button',{name:'Guardar nova revisão',exact:true}).click();const response=await saved;assert.equal(response.status(),201);db.save=response.request().postDataJSON();db.revision=await response.json();
   await page.getByRole('button',{name:'Consultar revisão 1 — rascunho',exact:true}).waitFor();
  }else{r=await db.call(db.root+'/revisions',db.save);assert.equal(r.status,201,JSON.stringify(r));db.revision=r.value;}
  assert.deepEqual((await db.call(db.root+'/revisions',db.save)).value,db.revision);
  r=await db.call(db.root+'/revisions/'+db.revision.revisionId);assert.equal(r.status,200,JSON.stringify(r));assert.equal(r.value.actions.canConfirm,true);
  if(db===databases[0]){
  await page.goto('http://localhost:5173/opportunities/'+db.op.opportunityId);
  await page.getByRole('button',{name:/^Recarregar revis/}).click();
  for(let attempt=0;attempt<3;attempt++){await page.locator('.criteria-panel[aria-busy="false"]').waitFor();if(await page.getByRole('button',{name:'Rever e confirmar revisão',exact:true}).isEnabled())break;await page.getByRole('button',{name:'Voltar a consultar critérios',exact:true}).click();}
  await page.getByRole('button',{name:'Rever e confirmar revisão',exact:true}).click();
  await page.getByRole('button',{name:'Confirmar interpretação editorial',exact:true}).press('Enter');
  await page.getByRole('button',{name:'Consultar revisão 1 — confirmada',exact:true}).waitFor();
  }else{const confirmed=await db.call(db.root+'/revisions/'+db.revision.revisionId+'/confirm',{requestId:randomUUID(),expectedHeadRevision:1,opportunityRevisionId:db.op.revisionId});assert.equal(confirmed.status,200,JSON.stringify(confirmed));}
  r=await db.call(db.root+'/revisions/'+db.revision.revisionId);assert.equal(r.value.state,'CONFIRMED');
  r=await db.call(db.root+'/intentions/lookup',{requestId:db.save.requestId,operation:'SAVE_REVISION',resourceId:db.op.opportunityId});assert.equal(r.value.status,'CONFIRMED',JSON.stringify(r));
  r=await db.call(db.root+'/intentions/lookup',{requestId:randomUUID(),operation:'SAVE_REVISION',resourceId:db.op.opportunityId});assert.equal(r.value.status,'UNKNOWN');
  const next={...db.save,requestId:randomUUID(),expectedHeadRevision:1};
  control.mode='COMMIT';r=await db.call(db.root+'/revisions',next);assert.equal(r.status,201,JSON.stringify(r));db.next=r.value;
  const confirm={requestId:randomUUID(),expectedHeadRevision:2,opportunityRevisionId:db.op.revisionId};
  control.mode='F7';r=await db.call(db.root+'/revisions/'+db.next.revisionId+'/confirm',confirm);assert.equal(r.status,503);
  r=await db.call(db.root+'/intentions/lookup',{requestId:confirm.requestId,operation:'CONFIRM',resourceId:db.next.revisionId});assert.equal(r.value.status,'FAILED_FINAL',JSON.stringify(r));
  assert.equal((await db.pool.query('SELECT count(*)::int n FROM opportunity_catalog.criteria_confirmation WHERE revision_id=$1',[db.next.revisionId])).rows[0].n,0);
  assert.equal((await db.pool.query("SELECT count(*)::int n FROM audit.event WHERE event_code='OPPORTUNITY_CRITERIA_REVISION_CONFIRMED' AND event_data->'resource'->>'id'=$1",[db.next.revisionId])).rows[0].n,0);
  r=await db.call('/opportunities/'+db.op.opportunityId,{requestId:randomUUID(),expectedRowVersion:db.op.rowVersion,changes:{summary:'New synthetic revision'}},'PUT');assert.equal(r.status,200,JSON.stringify(r));db.updatedOp=r.value;
  r=await db.call(db.root+'/revisions/'+db.next.revisionId+'/confirm',{...confirm,requestId:randomUUID()});assert.equal(r.status,409);assert.equal(r.value.error.code,'OPPORTUNITY_CHANGED');
  r=await db.call(db.root+'/revisions/'+db.revision.revisionId);assert.equal(r.value.state,'CONFIRMED');assert.equal(r.value.freshness,'REVIEW_REQUIRED');
 }
 await require('./freshness-probes').run({databases,central,pageFor});
 assert.equal((await databases[1].call(databases[0].root)).status,404);
 const db=databases[0],other=databases[1];
 await assert.rejects(()=>central.authorityPool.query('SELECT * FROM public.authority_commit_guard'),{code:'42501'});
 const restricted=await db.pool.connect();try{
  await restricted.query('BEGIN');await restricted.query('SET LOCAL ROLE c4g_opportunity_tenant_runtime');await restricted.query("SELECT set_config('app.organization_id',$1,true)",[other.org]);
  assert.equal((await restricted.query('SELECT * FROM opportunity_catalog.criteria_revision')).rowCount,0);
  await assert.rejects(()=>restricted.query('UPDATE opportunity_catalog.criteria_revision SET content=content'),{code:'42501'});
 }finally{await restricted.query('ROLLBACK');restricted.release();}
 const downgrade=await db.pool.connect();try{await downgrade.query('BEGIN');await assert.rejects(()=>downgrade.query(require('fs').readFileSync(require('path').resolve(__dirname,'../../../backend/database/tenant/migrations/017_opportunity_evidenced_criteria.down.sql'),'utf8')),/CRITERIA_DATA_PRESENT/);}finally{await downgrade.query('ROLLBACK');downgrade.release();}
 const checkerVersion=(await central.pool.query('SELECT authorization_version FROM public.authority_f5_state WHERE membership_id=$1',[db.checker.membershipId])).rows[0];
 await central.data.change({organizationId:db.org,membershipId:db.checker.membershipId,expectedVersion:Number(checkerVersion.authorization_version),grants:['opportunity.read','opportunity.criteria.read','opportunity.criteria.edit'].map(permission=>({permission,scope:{type:'ORGANIZATION',id:db.org,organizationId:db.org}})),assuranceRequirements:central.requirement});
 const checkerPage=await pageFor(db.checker),checkerCsrf=(await (await checkerPage.request.get('http://localhost:5173/api/auth/csrf')).json()).csrfToken;
 const checkerCall=async(path,body)=>{const response=await checkerPage.request.post('http://localhost:5173/api'+path,{headers:{Origin:'http://localhost:5173','X-CSRF-Token':checkerCsrf},data:body});return {status:response.status(),value:await response.json()};};
 assert.equal((await checkerCall(db.root+'/intentions/lookup',{requestId:db.save.requestId,operation:'SAVE_REVISION',resourceId:db.op.opportunityId})).value.status,'UNKNOWN');
 assert.equal((await checkerCall(db.root+'/revisions/'+db.next.revisionId+'/confirm',{requestId:randomUUID(),expectedHeadRevision:2,opportunityRevisionId:db.updatedOp.revisionId})).status,403);
 assert.equal((await db.call(db.root+'/revisions/'+other.revision.revisionId)).status,404);
 assert.equal((await db.call(db.root+'/revisions',{...db.save,requestId:randomUUID(),expectedHeadRevision:2,opportunityRevisionId:other.updatedOp.revisionId})).value.error.code,'OPPORTUNITY_CHANGED');
 for(const body of [{requestId:db.save.requestId,operation:'SAVE_REVISION',resourceId:other.op.opportunityId},{requestId:db.save.requestId,operation:'CONFIRM',resourceId:db.revision.revisionId}])assert.equal((await db.call(db.root+'/intentions/lookup',body)).value.status,'UNKNOWN');
 const next={...db.save,requestId:randomUUID(),expectedHeadRevision:2,opportunityRevisionId:db.updatedOp.revisionId};
 const started=new Promise(resolve=>control.reached=resolve);control.barrier=new Promise(resolve=>control.release=resolve);control.mode='PAUSE';control.releaseOnObservation=true;
 const writing=db.call(db.root+'/revisions',next);await started;
 try{const pending=await db.call(db.root+'/intentions/lookup',{requestId:next.requestId,operation:'SAVE_REVISION',resourceId:db.op.opportunityId});assert.equal(pending.value.status,'RESOLVING',JSON.stringify(pending));}finally{control.release();}
 assert.equal((await writing).status,201);
 const races=await Promise.all([db.call,checkerCall].map(call=>call(db.root+'/revisions',{...next,requestId:randomUUID(),expectedHeadRevision:3})));assert.deepEqual(races.map(r=>r.status).sort(),[201,409]);
 const page=pages[0];await page.getByRole('button',{name:/^Recarregar revis/}).click();
 for(let attempt=0;attempt<3;attempt++){await page.locator('.criteria-panel[aria-busy="false"]').waitFor();if(await page.getByRole('textbox',{name:/^Interpretação/}).count()&&await page.getByRole('textbox',{name:/^Interpretação/}).isEnabled())break;await page.getByRole('button',{name:'Voltar a consultar critérios',exact:true}).click();}
 await page.getByRole('textbox',{name:/^Interpretação/}).fill('Synthetic interpretation reviewed in browser');
 await page.route('**/criteria/revisions',async route=>{if(route.request().method()!=='POST')return route.continue();await route.fetch();await route.abort('failed');});
 await page.waitForFunction(()=>[...document.querySelectorAll('button')].some(b=>b.textContent==='Guardar nova revisão'&&!b.disabled));
 await page.getByRole('button',{name:'Guardar nova revisão',exact:true}).evaluate(button=>{button.click();button.click();});
 await page.getByText('Operação por resolver. Não inicie outra gravação.',{exact:false}).waitFor();await page.reload();
 await page.getByRole('button',{name:/^Recarregar revis/}).click();
 await page.locator('.criteria-panel[aria-busy="false"]').waitFor();
 if(await page.getByText('Serviço indisponível ou resultado por confirmar.',{exact:true}).isVisible())await page.getByRole('button',{name:'Voltar a consultar critérios',exact:true}).click();
 await page.waitForFunction(()=>!Object.keys(sessionStorage).some(k=>k.startsWith('c4g.criteria.intention.v1:')),null,{timeout:60000});
 assert.equal((await db.pool.query('SELECT head_revision FROM opportunity_catalog.criteria_set WHERE organization_id=$1 AND opportunity_id=$2',[db.org,db.op.opportunityId])).rows[0].head_revision,'5');
 await page.setViewportSize({width:360,height:760});await page.waitForFunction(()=>document.querySelector('.sidebar').getBoundingClientRect().right<=1);await page.locator('.criteria-panel[aria-busy="false"]').waitFor();assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 await page.screenshot({path:process.env.CRITERIA_SCREENSHOT_PATH||require('path').resolve(__dirname,'../../../context/reviews/opportunity-evidenced-criteria/criteria-mobile.png'),fullPage:true});
 await page.setViewportSize({width:1280,height:900});
 const version=(await central.pool.query('SELECT authorization_version FROM public.authority_f5_state WHERE membership_id=$1',[db.maker.membershipId])).rows[0];
 await central.data.change({organizationId:db.org,membershipId:db.maker.membershipId,expectedVersion:Number(version.authorization_version),grants:[],assuranceRequirements:central.requirement});
 assert([403,404].includes((await db.call(db.root)).status));
 assert.equal((await db.call(db.root+'/intentions/lookup',{requestId:next.requestId,operation:'SAVE_REVISION',resourceId:db.op.opportunityId})).status,403);
 const member=randomUUID();await central.pool.query("INSERT INTO public.organization_membership(id,global_user_id,organization_id,base_role_code,status,activated_at) VALUES($1,$2,$3,'ORG_ADMIN','ACTIVE',clock_timestamp())",[member,db.maker.id,other.org]);
 await central.data.change({organizationId:other.org,membershipId:member,expectedVersion:0,grants:['opportunity.read','opportunity.criteria.read'].map(permission=>({permission,scope:{type:'ORGANIZATION',id:other.org,organizationId:other.org}})),assuranceRequirements:central.requirement});
 await page.reload();await page.getByLabel('Organização ativa').selectOption(other.org);
 await page.waitForFunction(()=>!document.body.innerText.includes('Synthetic interpretation reviewed in browser'));
 await page.evaluate(({userId,organizationId,opportunityId})=>{const requestId=crypto.randomUUID();sessionStorage.setItem('c4g.criteria.intention.v1:'+requestId,JSON.stringify({userId,organizationId,opportunityId,resourceId:opportunityId,operation:'SAVE_REVISION',requestId}));},{userId:db.maker.id,organizationId:other.org,opportunityId:other.op.opportunityId});
 await page.getByTitle('Sair',{exact:true}).click();await page.getByRole('button',{name:'Continuar com Keycloak',exact:true}).waitFor();
 assert.equal(await page.evaluate(()=>Object.keys(sessionStorage).filter(k=>k.startsWith('c4g.criteria.intention.v1:')).length),0);
 console.log('CRITERIA_REAL_HTTP_BROWSER_AB: PASS');
}
module.exports={run};
