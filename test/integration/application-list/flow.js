'use strict';
const assert=require('node:assert/strict'),{randomUUID}=require('node:crypto');
async function run({central,tenants,base,http,actor,userA,userB,failures}){
 const [a]=tenants,root='/api/applications',browse=root+'/browse';
 const expect=async(p,status=200)=>{const r=await p;assert.equal(r.status,status,JSON.stringify({r,failures:failures.slice(-2)}));return r.data};
 const first=await expect(http(userA,root,'POST',{opportunityId:a.seed.opportunityId,evaluationId:null,title:'Projeto 00',responsibleMembershipId:userA.membershipId,deadline:'2026-12-31',totalBudget:'99999999999999.99',organizationBudget:'0',idempotencyKey:randomUUID()}),201);
 // Additional synthetic records exist only in this disposable tenant.
 for(let n=1;n<31;n++){
  const id=randomUUID(),title=`Projeto ${String(n).padStart(2,'0')}`;
  await a.pool.query(`INSERT INTO opportunity_catalog.application(organization_id,application_id,opportunity_id,title,responsible_membership_id,deadline,status,created_by,total_budget,organization_budget)
   VALUES($1,$2,$3,$4,$5,'2026-12-31','IDENTIFIED',$6,$7,NULL)`,[a.org,id,a.seed.opportunityId,title,userA.membershipId,userA.id,n===30?null:String(n)+'.23']);
  await a.pool.query(`INSERT INTO opportunity_catalog.application_change(organization_id,application_id,revision,kind,from_status,to_status,title,responsible_membership_id,deadline,actor_subject_id,total_budget)
   VALUES($1,$2,1,'CREATE',NULL,'IDENTIFIED',$3,$4,'2026-12-31',$5,$6)`,[a.org,id,title,userA.membershipId,userA.id,n===30?null:String(n)+'.23']);
 }
 await expect(http(userA,root+'/'+first.applicationId+'/transitions','POST',{status:'SUBMITTED',reason:'Ensaio da lista',expectedRevision:1,idempotencyKey:randomUUID()}));
 const page=await expect(http(userA,browse));assert.equal(page.total,31);assert.equal(page.items.length,25);assert.equal(page.items[0].title,'Projeto 00');assert.equal(page.items[0].responsibleName,'Synthetic');assert.equal(page.countsByStatus.IDENTIFIED,30);assert.equal(page.countsByStatus.SUBMITTED,1);
 await expect(http({...userA,request:{organizationContext:{organizationId:tenants[1].org}}},browse),404);
 const second=await expect(http(userA,browse+'?cursor='+encodeURIComponent(page.nextCursor)));assert.equal(second.items.length,6);assert.equal(second.items[0].title,'Projeto 25');assert.equal(second.page,2);
 const back=await expect(http(userA,browse+'?cursor='+encodeURIComponent(second.previousCursor)));assert.equal(back.items[0].applicationId,first.applicationId);
 const filtered=await expect(http(userA,browse+'?q=Projeto%200&status=IDENTIFIED'));assert.equal(filtered.total,9);assert.equal(filtered.countsByStatus.SUBMITTED,1);
 assert.equal((await expect(http(userA,browse+'?q=synthetic'))).total,31);
 const money=await expect(http(userA,browse+'?sort=totalBudget&direction=desc'));assert.equal(money.items[0].applicationId,first.applicationId);
 assert.equal((await expect(http(userB,browse))).total,0);await expect(http(userB,browse+'?cursor='+encodeURIComponent(page.nextCursor)),400);
 await expect(http(userA,browse+'?q=other&cursor='+encodeURIComponent(page.nextCursor)),400);
 const readOnly=await actor(a.org,['opportunity.read','application.read']);assert((await expect(http(readOnly,browse))).items.every(r=>r.allowedTransitions.length===0));
 await expect(http(readOnly,root+'/'+first.applicationId+'/transitions','POST',{status:'PREPARATION',reason:'Recusado',expectedRevision:2,idempotencyKey:randomUUID()}),404);
 await expect(http(userA,root+'/'+first.applicationId,'PUT',{title:'Projeto 00 revisto',responsibleMembershipId:userA.membershipId,deadline:'2026-12-31',expectedRevision:2,idempotencyKey:randomUUID()}));
 await expect(http(userA,browse+'?cursor='+encodeURIComponent(page.nextCursor)),400);
 // Central snapshot title and deadline are read without a cross-database join.
 const centralId=randomUUID();await a.pool.query(`INSERT INTO opportunity_catalog.application(organization_id,application_id,title,responsible_membership_id,deadline,status,created_by,central_opportunity_id,central_revision_id,central_snapshot)
 VALUES($1,$2,'Projeto central',$3,'2026-12-31','IDENTIFIED',$4,$5,$6,$7)`,[a.org,centralId,userA.membershipId,userA.id,randomUUID(),randomUUID(),{title:'Aviso central',closingDate:'2027-07-01'}]);
 const centralRow=(await expect(http(userA,browse+'?q=Aviso%20central'))).items[0];assert.equal(centralRow.opportunityTitle,'Aviso central');assert.equal(centralRow.opportunityClosingDate,'2027-07-01');
 const limited=await actor(a.org,['application.read']),scope={type:'ORGANIZATION',id:a.org,organizationId:a.org};
 await central.data.change({organizationId:a.org,membershipId:limited.membershipId,expectedVersion:2,grants:[{permission:'application.read',scope},{permission:'opportunity.read',resourceId:a.seed.opportunityId,resourceType:'OPPORTUNITY',scope}],assuranceRequirements:central.requirement});
 const subset=await expect(http(limited,browse));assert.equal(subset.total,31);assert.equal(subset.items.some(r=>r.origin==='CENTRAL'),false);
 await central.data.change({organizationId:a.org,membershipId:limited.membershipId,expectedVersion:3,grants:[{permission:'application.read',scope}],assuranceRequirements:central.requirement});
 assert.equal((await expect(http(limited,browse))).total,0);await expect(http(limited,browse+'?cursor='+encodeURIComponent(subset.nextCursor)),400);
 console.log('APPLICATION_LIST_POSTGRES_HTTP_PAGINATION_COUNTS_ISOLATION_PASS');
 await require('./browser').run({base,userA,userB});
}
module.exports={run};
