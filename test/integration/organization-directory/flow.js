'use strict';
const assert=require('node:assert/strict'),{randomUUID}=require('node:crypto');
const root='/api/organization-directory';
const permissions=['organization_directory.read','organization_directory.edit','organizational_scope.read','organizational_scope.create','organizational_scope.rename','organizational_scope.reparent','opportunity.read','application.read',...(process.env.PILOT_PEOPLE_SLICE==='1'?['organization_membership.manage','personal_profile.read','personal_profile.edit','opportunity.private.create']:[])];
async function run({central,tenants,base,http,actor,userA,failures,loseNextCommit,failAudit}){
 const [a,b]=tenants,manager=await actor(a.org,permissions),other=await actor(b.org,permissions),reader=await actor(a.org,['organization_directory.read','organizational_scope.read']);
 if(process.env.PILOT_PEOPLE_SLICE==='1'&&process.env.PILOT_PEOPLE_ONLY==='1'){await require('../pilot-people/flow').run({central,tenants,http,actor,manager,other,reader,failures,loseNextCommit,failAudit,base});return;}
 const expected=async(promise,status=200)=>{const result=await promise;if(result.status!==status)console.error('DIRECTORY_HTTP_FAILURE',result,failures.slice(-2));assert.equal(result.status,status);return result.data};
 const unit=(label,parentScopeId=null)=>({label,parentScopeId,stableCode:null,idempotencyKey:randomUUID()});
 const person=(name,ids=[],primary=ids[0]||null)=>({name,email:'pessoa@example.invalid',functionLabel:'Gestão',active:true,unitIds:ids,primaryUnitId:primary,idempotencyKey:randomUUID()});
 if(process.env.DIRECTORY_BROWSER_ONLY==='1'){
  const top=await expected(http(manager,root+'/units','POST',unit('Direção')),201);
  await require('./browser').run({base,manager,other,reader,unit:top});return;
 }
 const membersBefore=Number((await central.pool.query('SELECT count(*) AS n FROM public.organization_membership')).rows[0].n);
 await expected(http(userA,root),403);assert.equal((await expected(http(reader,root))).permissions.edit,false);
 const creation=unit('Direção');const top=await expected(http(manager,root+'/units','POST',creation),201);
 assert.equal((await expected(http(manager,root+'/units','POST',creation),201)).scopeId,top.scopeId);
 await expected(http(manager,root+'/units','POST',unit('Subunidade recusada',top.scopeId)),400);
 const child=await expected(http(manager,root+'/units','POST',unit('Operações')),201);
 await expected(http(manager,root+'/units/'+top.scopeId+'/parent','PUT',{parentScopeId:child.scopeId,expectedRevision:1,idempotencyKey:randomUUID()}),400);
 await expected(http(other,root+'/units/'+top.scopeId+'/name','PUT',{label:'Intrusão',expectedRevision:1,idempotencyKey:randomUUID()}),404);
 await expected(http(reader,root+'/units','POST',unit('Recusada')),404);
 const renamed=await expected(http(manager,root+'/units/'+child.scopeId+'/name','PUT',{label:'Projetos',expectedRevision:1,idempotencyKey:randomUUID()}));assert.equal(renamed.revision,2);
 await expected(http(manager,root+'/units/'+child.scopeId+'/parent','PUT',{parentScopeId:null,expectedRevision:2,idempotencyKey:randomUUID()}),400);
 await expected(http(manager,root+'/units/'+child.scopeId+'/name','PUT',{label:'Obsoleto',expectedRevision:1,idempotencyKey:randomUUID()}),409);
 console.log('DIRECTORY_UNITS_HTTP_PASS');
 const personInput=person('Pessoa C4G',[top.scopeId,child.scopeId]);const created=await expected(http(manager,root+'/people','POST',personInput),201);
 assert.equal((await expected(http(manager,root+'/people','POST',personInput),201)).personId,created.personId);
 await expected(http(manager,root+'/people','POST',{...personInput,name:'Reutilização indevida'}),409);
 await expected(http(other,root+'/people','POST',person('Outra entidade',[top.scopeId])),409);
 await expected(http(other,root+'/people/'+created.personId,'PUT',{...person('Intrusão'),expectedRevision:1}),404);
 assert.equal((await expected(http(other,root+'/people'))).items.length,0);
 assert.equal((await expected(http(manager,root+'/people?unitId='+child.scopeId))).items[0].primaryUnitId,top.scopeId);
 const edit={...personInput,idempotencyKey:randomUUID(),expectedRevision:1,name:'Pessoa atualizada',active:false};
 await expected(http(manager,root+'/people/'+created.personId,'PUT',edit));await expected(http(manager,root+'/people/'+created.personId,'PUT',edit));
 await expected(http(manager,root+'/people/'+created.personId,'PUT',{...edit,idempotencyKey:randomUUID(),name:'Conflito'}),409);
 assert.equal((await expected(http(manager,root+'/people'))).items.length,0);assert.equal((await expected(http(manager,root+'/people?status=INACTIVE'))).items.length,1);
 assert.equal((await expected(http(manager,root+'/people?status=ALL&search=atualizada'))).items.length,1);
 console.log('DIRECTORY_PEOPLE_HTTP_PASS');
 const profile={description:'Entidade C4G de teste',email:'entidade@example.invalid',website:'https://example.invalid',expectedRevision:0,idempotencyKey:randomUUID()};
 await expected(http(manager,root,'PUT',profile));assert.equal((await expected(http(manager,root))).profile.description,profile.description);
 await expected(http(reader,root,'PUT',{...profile,idempotencyKey:randomUUID()}),403);
 // A changed selection cannot redirect an already queued write to another tenant.
 const original=manager.request.organizationContext.organizationId;manager.request.organizationContext.organizationId=b.org;
 await expected(http(manager,root+'/people','POST',person('Contexto incorreto')),409);manager.request.organizationContext.organizationId=original;
 const count=async()=>Number((await a.pool.query('SELECT count(*) AS n FROM organizational_scope.person')).rows[0].n);
 const before=await count();failAudit(true);await expected(http(manager,root+'/people','POST',person('Auditoria falhada')),503);failAudit(false);assert.equal(await count(),before);
 loseNextCommit();await expected(http(manager,root+'/people','POST',person('Resultado reconciliado')),201);assert.equal(await count(),before+1);
 loseNextCommit();await expected(http(manager,root+'/units','POST',unit('Unidade reconciliada')),201);
 console.log('DIRECTORY_FAILURE_RECOVERY_PASS');
 const c=await a.pool.connect();try{
  await c.query('BEGIN');await c.query('SET LOCAL ROLE c4g_opportunity_tenant_runtime');await c.query("SELECT set_config('app.organization_id',$1,true)",[b.org]);
  assert.equal((await c.query('SELECT * FROM organizational_scope.person')).rowCount,0);await c.query('ROLLBACK');
  await c.query('BEGIN');await c.query('SET LOCAL ROLE c4g_opportunity_tenant_runtime');await c.query("SELECT set_config('app.organization_id',$1,true)",[a.org]);
  await assert.rejects(()=>c.query('DELETE FROM organizational_scope.person WHERE organization_id=$1',[a.org]),{code:'42501'});await c.query('ROLLBACK');
 }finally{await c.query('ROLLBACK').catch(()=>{});c.release()}
 assert.equal(Number((await central.pool.query('SELECT count(*) AS n FROM public.organization_membership')).rows[0].n),membersBefore);
 // The prior catalog remains readable with the additive schema.
 await expected(http(manager,'/api/opportunities'));await expected(http(manager,'/api/applications'));
 if(process.env.DIRECTORY_BROWSER==='1')await require('./browser').run({base,manager,other,reader,organizationId:a.org,unit:top});
 if(process.env.PILOT_PEOPLE_SLICE==='1')await require('../pilot-people/flow').run({central,tenants,http,actor,manager,other,reader,failures,loseNextCommit,failAudit,base});
 console.log('DIRECTORY_POSTGRES_HTTP_PASS: hierarchy, people, read-only, A/B, RLS, CAS, idempotency, context binding, critical audit rollback, uncertain commit, no account creation, catalog regression');
}
module.exports={run};
