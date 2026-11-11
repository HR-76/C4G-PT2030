'use strict';
const assert=require('node:assert/strict'),{randomUUID}=require('node:crypto');
async function run({central,tenants,base,http,actor,userA,userB,failures,failAudit,loseNextCommit}){
 const [a]=tenants,root='/api/applications';
 const expect=async(p,status=200)=>{const r=await p;assert.equal(r.status,status,JSON.stringify({r,failures:failures.slice(-3)}));return r.data};
 const app=await expect(http(userA,root,'POST',{opportunityId:a.seed.opportunityId,evaluationId:null,title:'Candidatura parceiros — ensaio',responsibleMembershipId:userA.membershipId,deadline:'2026-12-31',idempotencyKey:randomUUID()}),201);
 const id=app.applicationId,url=root+'/'+id+'/partners';
 const taskUrl=root+'/'+id+'/work';await expect(http(userA,taskUrl+'/tasks','POST',{title:'Tarefa preservada',responsibleMembershipId:userA.membershipId,deadline:'2026-12-01',expectedRevision:1,idempotencyKey:randomUUID()}));const before=await expect(http(userA,taskUrl));
 const person={id:null,name:'Ana Silva',role:'RESPONSAVEL',research_area:'Gestão de projetos',contact:'+351 210 000 001',email:'ana@example.org'};
 const partner={entity_name:'Entidade parceira de ensaio',country:'Portugal',research_area_interest:'Inovação e competências',responsible_person:'Ana Silva',contact:'+351 210 000 000',email:'geral@example.org',people:[person,{...person,name:'Rui Costa',role:'OUTRO',email:'rui@example.org'}]};
 if(process.env.PARTNERS_VISUAL_ONLY==='1'){
  await expect(http(userA,url,'POST',{expectedRevision:1,idempotencyKey:randomUUID(),partner:{entity_name:'Rede de parceiros — ensaio',country:'Portugal',research_area_interest:'Capacitação e transformação digital',responsible_person:'Maria Santos',contact:'',email:'rede@example.org',people:[{id:null,name:'Maria Santos',role:'RESPONSAVEL',research_area:'Formação',contact:'',email:'maria@example.org'}]}}));
  await require('./visual').run({base,userA,applicationId:id});return;
 }
 if(process.env.PARTNERS_BROWSER_ONLY==='1'){
  for(let n=0;n<29;n++)await a.pool.query('INSERT INTO opportunity_catalog.application_partner(organization_id,application_id,partner_id,body) VALUES($1,$2,$3,$4)',[a.org,id,randomUUID(),{...partner,entity_name:'Parceiro '+String(n).padStart(2,'0'),people:[]}]);
  await require('./browser').run({base,userA,userB,applicationId:id});return;
 }
 assert.equal((await expect(http(userA,url))).revision,1);
 let input={expectedRevision:1,idempotencyKey:randomUUID(),partner},saved=await expect(http(userA,url,'POST',input));assert.deepEqual(await expect(http(userA,url,'POST',input)),saved);
 await expect(http(userA,url,'POST',{...input,partner:{...partner,entity_name:'Key conflict'}}),409);
 const get=()=>expect(http(userA,url));let read=await get(),first=read.items[0];assert.equal(first.people.length,2);assert.equal(read.canEdit,true);
 const payload=p=>({entity_name:p.entity_name,country:p.country,research_area_interest:p.research_area_interest,responsible_person:p.responsible_person,contact:p.contact,email:p.email,people:p.people.map(({active,...v})=>v)});
 const edit={partnerId:first.id,expectedRevision:2,idempotencyKey:randomUUID(),partner:{...payload(first),people:[payload(first).people[0]]}};
 failAudit(true);await expect(http(userA,url,'PUT',edit),503);failAudit(false);assert.equal((await get()).revision,2);assert.equal((await get()).items[0].people.length,2);
 saved=await expect(http(userA,url,'PUT',edit));read=await get();assert.equal(read.items[0].people[0].id,first.people[0].id);
 const history=await expect(http(userA,url+'/history'));assert.equal(history.items[0].snapshot.people.find(p=>p.name==='Rui Costa').active,false);
 await expect(http(userA,url,'PUT',{...edit,idempotencyKey:randomUUID()}),409);
 await expect(http(userA,url,'PUT',{...edit,expectedRevision:3,idempotencyKey:randomUUID(),partner:{...edit.partner,people:[{...person,id:randomUUID()}]}}),400);
 await expect(http(userB,url),404);await expect(http(userB,url+'/history'),404);await expect(http(userB,url,'POST',{...input,idempotencyKey:randomUUID()}),404);
 const ro=await actor(a.org,['opportunity.read','application.read']);assert.equal((await expect(http(ro,url))).canEdit,false);await expect(http(ro,url,'POST',{...input,expectedRevision:3,idempotencyKey:randomUUID()}),404);
 assert.deepEqual((await expect(http(userB,root+'/partners'))).countries,[]);
 assert.equal((await expect(http(userA,root+'/partners?q=ana%40example.org&country=Portugal&person_role=RESPONSAVEL'))).total,1);
 assert.equal((await expect(http(userA,root+'/partners?q=rui%40example.org'))).total,0);
 const noOrigin=await actor(a.org,['application.read']);assert.deepEqual((await expect(http(noOrigin,root+'/partners'))).countries,[]);assert.equal((await expect(http(noOrigin,root+'/partners'))).total,0);
 await expect(http({...userA,request:{organizationContext:{organizationId:tenants[1].org}}},root+'/partners'),404);
 const rival=await actor(a.org,['opportunity.read','application.read','application.edit']);
 const race=await Promise.all([userA,rival].map((u,n)=>http(u,url,'PUT',{...edit,expectedRevision:3,idempotencyKey:randomUUID(),partner:{...edit.partner,contact:`Contact ${n}`}})));assert.deepEqual(race.map(r=>r.status).sort(),[200,409]);
 loseNextCommit();const lost={expectedRevision:4,idempotencyKey:randomUUID(),partner:{...partner,entity_name:'Repetição segura'}};const resolved=await expect(http(userA,url,'POST',lost));assert.deepEqual(await expect(http(userA,url,'POST',lost)),resolved);
 await expect(http(userA,url+'/remove','POST',{partnerId:resolved.partnerId,expectedRevision:5,idempotencyKey:randomUUID()}));assert.equal((await get()).total,1);
 assert.equal((await a.pool.query('SELECT active FROM opportunity_catalog.application_partner WHERE partner_id=$1',[resolved.partnerId])).rows[0].active,false);
 assert.deepEqual(await expect(http(userA,taskUrl)),before);assert.equal((await expect(http(userA,root+'/'+id))).revision,1);
 // Bulk fixtures are limited to the disposable tenant; exercise real paging and metadata.
 for(let n=0;n<27;n++)await a.pool.query('INSERT INTO opportunity_catalog.application_partner(organization_id,application_id,partner_id,body) VALUES($1,$2,$3,$4)',[a.org,id,randomUUID(),{...partner,entity_name:`Parceiro ${String(n).padStart(2,'0')}`,country:n===26?'Espanha':'Portugal',people:[]}]);
 let page=await expect(http(userA,root+'/partners'));assert.equal(page.total,28);assert.equal(page.items.length,25);assert.deepEqual(page.countries,['Espanha','Portugal']);
 assert.equal((await expect(http(userA,root+'/partners?cursor='+encodeURIComponent(page.nextCursor)))).items.length,3);
 await expect(http(userB,root+'/partners?cursor='+encodeURIComponent(page.nextCursor)),400);
 await expect(http(userA,root+'/partners?q=other&cursor='+encodeURIComponent(page.nextCursor)),400);
 const detailPage=await get();assert.equal(detailPage.total,28);assert.equal((await expect(http(userA,url+'?cursor='+encodeURIComponent(detailPage.nextCursor)))).items.length,3);
 await expect(http(userA,url,'POST',{expectedRevision:6,idempotencyKey:randomUUID(),partner:{...partner,entity_name:'Novo parceiro'}}));await expect(http(userA,root+'/partners?cursor='+encodeURIComponent(page.nextCursor)),400);
 // Runtime cannot read another organization even if it shares a database, nor delete history.
 const client=await a.limitedPool.connect();try{await client.query('BEGIN');await client.query('SET LOCAL ROLE c4g_opportunity_tenant_runtime');await client.query("SELECT set_config('app.organization_id',$1,true)",[tenants[1].org]);assert.equal((await client.query('SELECT * FROM opportunity_catalog.application_partner')).rowCount,0);await client.query('ROLLBACK');await assert.rejects(()=>client.query('DELETE FROM opportunity_catalog.application_partner_change'),e=>e.code==='42501');}finally{await client.query('ROLLBACK');client.release()}
 console.log('APPLICATION_PARTNERS_POSTGRES_HTTP_CAS_AUDIT_HISTORY_ISOLATION_PASS');
 await require('./browser').run({base,userA,userB,applicationId:id});
}
module.exports={run};
