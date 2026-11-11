'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
async function verify({p,id,origin,http,central,completion,completionPorts,report}){
 const out=path.resolve(__dirname,'../../../output/playwright/c4g-completion');fs.mkdirSync(out,{recursive:true});
 const before=(await central.pool.query('SELECT to_jsonb(m) row FROM public.organization_membership m ORDER BY id')).rows;
 await p.goto(origin+'/adesao/'+id);await p.getByRole('button',{name:'Continuar',exact:true}).waitFor();for(let n=0;n<3;n++){await p.getByRole('button',{name:'Continuar',exact:true}).click();if(n<2)await p.getByRole('heading',{name:n===0?'2. Morada e contactos':'3. Administrador e dimensão'}).waitFor();}
 const button=p.getByRole('button',{name:'Concluir ficha e preparar acesso',exact:true});await button.waitFor();
 let command;p.on('request',r=>{if(new URL(r.url()).pathname===`/api/admissions/${id}/submit`)command=r.postDataJSON()});
 await button.click();await p.getByRole('heading',{name:'Estamos a preparar a entidade'}).waitFor();assert(command);
 const submitted=await http(p,`/api/admissions/${id}/submit`,'POST',command);assert.equal(submitted.status,200);assert.equal(submitted.data.phase,'TENANT');
 await p.reload();await p.getByRole('heading',{name:'Estamos a preparar a entidade'}).waitFor();
 for(const width of [1440,390]){await p.setViewportSize({width,height:1000});await p.screenshot({path:path.join(out,`preparing-${width}.png`),fullPage:true});assert(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));}
 const org=submitted.data.organizationId,worker=require('../../../backend/src/entityAdmission/completionWorker').createCompletionWorker(completion);
 // Real adapters lose replies once at each phase; activation audit fails once.
 if(completionPorts?.automatic){
  await completionPorts.startAutomatic();
  const deadline=Date.now()+120000;let complete=false;
  while(Date.now()<deadline){const state=(await central.pool.query('SELECT phase FROM public.entity_admission_completion WHERE admission_id=$1',[id])).rows[0].phase;if(state==='COMPLETE'){complete=true;break;}await new Promise(r=>setTimeout(r,1000));}
  assert(complete,'Automatic local worker must complete durable job');await completionPorts.restart();
 }else for(let n=0;n<6;n++){
  const results=await worker.runOnce();assert.equal(results.length,1);
  const state=(await central.pool.query('SELECT phase FROM public.entity_admission_completion WHERE admission_id=$1',[id])).rows[0].phase;
  if(n<5){assert.notEqual(state,'COMPLETE');assert.equal((await central.pool.query('SELECT status FROM public.organization WHERE id=$1',[org])).rows[0].status,'PROVISIONING');assert.equal((await http(p,'/api/central-opportunities')).status,403);}else assert.equal(state,'COMPLETE');
 }
 assert.equal((await worker.runOnce()).length,0);
 const previous=(await central.pool.query('SELECT to_jsonb(m) row FROM public.organization_membership m WHERE organization_id<>$1 ORDER BY id',[org])).rows;assert.deepEqual(previous,before);
 await p.getByRole('button',{name:'Atualizar estado'}).click();await p.getByRole('button',{name:'Entrar na entidade'}).waitFor();await p.screenshot({path:path.join(out,'ready-390.png'),fullPage:true});
 await p.getByRole('button',{name:'Entrar na entidade'}).click();await p.getByRole('heading',{name:'Ficha administrativa'}).waitFor();await p.getByText('500000000',{exact:true}).waitFor();
 await p.setViewportSize({width:1440,height:1000});await p.screenshot({path:path.join(out,'complete-profile-1440.png'),fullPage:true});
 const row=(await central.pool.query('SELECT fields FROM public.organization_registration WHERE organization_id=$1',[org])).rows[0];assert.equal(row.fields.workerCount,0);assert.equal(row.fields.country,'PT');
 assert.equal((await central.pool.query('SELECT count(*)::int n FROM public.organization_fiscal_identity WHERE organization_id=$1',[org])).rows[0].n,1);
 await assert.rejects(()=>central.coordinator.write(['POLICY'],c=>completion.cancel(c,id)),{code:'ONBOARDING_NOT_READY'});
 const completed=(await central.pool.query('SELECT actor_id,membership_id FROM public.entity_admission_completion WHERE admission_id=$1',[id])).rows[0];
 const sid=(await central.pool.query("SELECT sid FROM public.application_session WHERE global_user_id=$1 AND status='ACTIVE' ORDER BY created_at DESC LIMIT 1",[completed.actor_id])).rows[0].sid;
 await require('../../../backend/src/security/membershipRepository').createMembershipRepository(central.coordinator.pool,central.coordinator).changeStatus({membershipId:completed.membership_id,status:'SUSPENDED',reason:'ISOLATED_PROOF'});
 assert.equal((await completion.status(id,{user:{id:completed.actor_id},sessionID:sid,authContext:{sessionId:sid}})).canEnter,false);
 report.checks.push('Complete Portuguese admission, durable queue, lost tenant/projection replies, worker restart, activation audit rollback, real isolated database and credentials, active profile; old memberships preserved');
 fs.writeFileSync(path.join(out,completionPorts?.automatic?'local-worker-verification.json':'real-verification.json'),JSON.stringify({result:'PASS',realKeycloak:true,realPostgres:true,viewports:[1440,390],usualEnvironmentTouched:false,automaticWorker:Boolean(completionPorts?.automatic),dynamicCredentials:Boolean(completionPorts?.automatic),restart:true},null,2));console.log('PASS complete admission and real tenant activation');
}
module.exports={verify};
