'use strict';
const assert=require('node:assert/strict'),{randomUUID}=require('node:crypto');
const {NEXT}=require('../../../backend/src/applications/contracts');
async function run({central,tenants,base,http,actor,userA,userB,failures,loseNextCommit,failAudit}){
 const [a]=tenants,root='/api/applications';
 if(process.env.APPLICATION_LIFECYCLE_BROWSER_ONLY==='1'){await require('./browser').run({base,userA,userB,opportunityId:a.seed.opportunityId});return;}
 const expect=async(p,status=200)=>{const r=await p;assert.equal(r.status,status,JSON.stringify({r,failures:failures.slice(-3)}));return r.data};
 const create=(overrides={})=>({opportunityId:a.seed.opportunityId,evaluationId:null,title:'Candidatura de ensaio',responsibleMembershipId:userA.membershipId,deadline:'2026-12-31',notes:'Notas de ensaio\nSegunda linha',totalBudget:'120000.67',organizationBudget:'0',idempotencyKey:randomUUID(),...overrides});
 const input=create(),record=await expect(http(userA,root,'POST',input),201),id=record.applicationId,url=`${root}/${id}`;
 assert.equal(record.status,'IDENTIFIED');assert.equal(record.totalBudget,'120000.67');assert.equal(record.organizationBudget,'0');
 assert.deepEqual(await expect(http(userA,root,'POST',input),201),record);
 const tasks=url+'/work';let work=await expect(http(userA,tasks));
 work=await expect(http(userA,tasks+'/tasks','POST',{title:'Tarefa existente preservada',responsibleMembershipId:userA.membershipId,deadline:'2026-12-20',expectedRevision:work.revision,idempotencyKey:randomUUID()}));
 const taskBefore=await expect(http(userA,tasks));
 const edit={title:'Candidatura revista',responsibleMembershipId:userA.membershipId,deadline:'2027-01-15',expectedRevision:1,idempotencyKey:randomUUID()};
 let current=await expect(http(userA,url,'PUT',edit));assert.equal(current.totalBudget,'120000.67');assert.equal(current.notes,input.notes);assert.equal(current.statusChangedAt,record.statusChangedAt);
 await expect(http(userA,url,'PUT',{...edit,idempotencyKey:randomUUID()}),409);
 await expect(http(userA,url,'PUT',{...edit,expectedRevision:2,totalBudget:'1.001',idempotencyKey:randomUUID()}),400);
 failAudit(true);await expect(http(userA,url,'PUT',{...edit,expectedRevision:2,notes:'Must roll back',idempotencyKey:randomUUID()}),503);failAudit(false);
 assert.equal((await expect(http(userA,url))).notes,input.notes);
 current=await expect(http(userA,url,'PUT',{...edit,expectedRevision:2,totalBudget:null,organizationBudget:'99999999999999.99',notes:null,idempotencyKey:randomUUID()}));assert.equal(current.totalBudget,null);assert.equal(current.organizationBudget,'99999999999999.99');assert.equal(current.notes,null);
 const transition=async(status)=>{current=await expect(http(userA,url+'/transitions','POST',{status,reason:`Registo ${status}`,expectedRevision:current.revision,idempotencyKey:randomUUID()}));return current};
 await transition('SUBMITTED');const submitted=current.lastSubmittedAt;assert(submitted);
 await transition('PREPARATION');assert.equal(current.lastSubmittedAt,submitted);
 await transition('IDENTIFIED');await transition('INTENTION');await transition('SUBMITTED');await transition('APPROVED');
 await expect(http(userA,url+'/transitions','POST',{status:'PREPARATION',reason:'Invalid reopen',expectedRevision:current.revision,idempotencyKey:randomUUID()}),409);
 current=await expect(http(userA,url,'PUT',{...edit,expectedRevision:current.revision,notes:'Resultado preservado',idempotencyKey:randomUUID()}));assert.equal(current.status,'APPROVED');
 await transition('ARCHIVED');await expect(http(userA,url,'PUT',{...edit,expectedRevision:current.revision,idempotencyKey:randomUUID()}),409);
 assert.deepEqual(await expect(http(userA,tasks)),taskBefore);
 const history=await expect(http(userA,url+'/history'));assert.equal(history.items.length,current.revision);assert.equal(history.items.at(-1).toStatus,'IDENTIFIED');
 assert.equal(history.items.at(-1).totalBudget,'120000.67');
 for(const endpoint of [url,url+'/history',tasks,url+'/documents'])await expect(http(userB,endpoint),404);
 assert.equal((await expect(http(userB,root))).items.length,0);
 await expect(http(userB,url,'PUT',{...edit,responsibleMembershipId:userB.membershipId,idempotencyKey:randomUUID()}),404);
 await expect(http(userA,root,'POST',create({responsibleMembershipId:userB.membershipId})),409);
 loseNextCommit();const uncertain=create({title:'Resposta incerta'}),resolved=await expect(http(userA,root,'POST',uncertain),201);assert.deepEqual(await expect(http(userA,root,'POST',uncertain),201),resolved);
 // Exercise every allowed edge, and every prohibited destination, through authorization/HTTP.
 for(const [from,destinations] of Object.entries(NEXT)){
  for(const target of Object.keys(NEXT)){
   let r=await expect(http(userA,root,'POST',create({title:`${from} to ${target}`})),201);const path=`${root}/${r.applicationId}/transitions`;
   const move=async status=>{r=await expect(http(userA,path,'POST',{status,reason:'Ensaio da matriz',expectedRevision:r.revision,idempotencyKey:randomUUID()}))};
   if(['APPROVED','REJECTED'].includes(from))await move('SUBMITTED');if(from!=='IDENTIFIED')await move(from);
   await expect(http(userA,path,'POST',{status:target,reason:'Ensaio da matriz',expectedRevision:r.revision,idempotencyKey:randomUUID()}),destinations.includes(target)?200:409);
  }
 }
 const admin=await actor(a.org,[]);await central.pool.query("INSERT INTO public.platform_admin_assignment(id,global_user_id,role_code,status) VALUES($1,$2,'C4G_ADMIN','ACTIVE')",[randomUUID(),admin.id]);
 const funding=require('../../../backend/src/fundingTenders/repository').createFundingRepository({pool:central.pool});
 const queued=await funding.enqueue(admin.id,randomUUID()),run=await funding.claim(queued.runId);
 await funding.stage(run,{records:[{externalIdentifier:'APPLICATION-LIFECYCLE',fields:{title:'Oportunidade central de ensaio',summary:'Ensaio isolado',programmeName:'Programa',funderName:'Financiador',officialUrl:'https://example.invalid/call',callReference:'APPLICATION-LIFECYCLE',closingDate:'2030-01-01'}}],observedAt:new Date().toISOString(),received:1,failed:0,limited:false});
 for(const item of await funding.pending(run))await funding.apply(run,item);await funding.finish(run);
 const pub=(await funding.list()).items[0],detail=await funding.get(pub.opportunityId);
 const centralInput=create({origin:'CENTRAL',centralRevisionId:detail.revisionId,opportunityId:pub.opportunityId});
 const centralRecord=await expect(http(userA,root,'POST',centralInput),201);assert.equal(centralRecord.status,'IDENTIFIED');assert.equal(centralRecord.origin,'CENTRAL');
 assert.equal((await expect(http(userA,root+'/'+centralRecord.applicationId))).opportunityClosingDate,'2030-01-01');
 console.log('APPLICATION_LIFECYCLE_HTTP_MATRIX_FIELDS_TASKS_AUDIT_ISOLATION_PASS');
 await require('./browser').run({base,userA,userB,opportunityId:a.seed.opportunityId});
}
module.exports={run};
