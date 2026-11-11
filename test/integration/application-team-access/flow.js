'use strict';
const assert=require('node:assert/strict'),{randomUUID}=require('node:crypto'),fs=require('node:fs'),path=require('node:path');
const {read,utils}=require('../../../backend/node_modules/xlsx');
async function run({central,tenants,base,http,actor,userA,userB,failures,failAudit}){
 const [a,b]=tenants,root='/api/applications';
 const ok=async(p,status=200)=>{const r=await p;assert.equal(r.status,status,JSON.stringify({r,failures:failures.slice(-2)}));return r.data};
 const tech=await actor(a.org,['notification.read'],null,{profileCode:'CONTRIBUTOR',displayName:'Técnico da equipa'});
 const broad=await actor(a.org,['notification.read','application.read','application.edit','application.transition','opportunity.read'],null,{profileCode:'CONTRIBUTOR',displayName:'Técnico com grants anteriores'});
 const foreign=await actor(b.org,['application.read','opportunity.read'],null,{profileCode:'CONTRIBUTOR'});
 const create=title=>ok(http(userA,root,'POST',{opportunityId:a.seed.opportunityId,evaluationId:null,title,responsibleMembershipId:userA.membershipId,deadline:'2027-12-31',idempotencyKey:randomUUID()}),201);
 const app=await create('Projeto da equipa Alfa'),other=await create('Projeto reservado Beta'),url=root+'/'+app.applicationId,otherUrl=root+'/'+other.applicationId;
 const changeTeam=async(target,member,remove=false)=>{
  const work=await ok(http(userA,target+'/work'));
  return ok(http(userA,target+'/work/participants'+(remove?'/remove':''),'POST',{membershipId:member.membershipId,expectedRevision:work.revision,idempotencyKey:randomUUID()}));
 };
 const grantSnapshot=async()=>JSON.stringify((await central.pool.query('SELECT grants,authorization_version FROM public.authority_f5_state WHERE membership_id=$1',[tech.membershipId])).rows);
 const grantsBefore=await grantSnapshot();
 await ok(http(tech,url),404);assert.equal((await ok(http(tech,root+'/browse'))).total,0);
 // A pre-existing task does not confer access; its assignment and history survive removal.
 await ok(http(userA,url+'/work/tasks','POST',{title:'Tarefa existente preservada',responsibleMembershipId:tech.membershipId,deadline:'2027-11-30',expectedRevision:1,idempotencyKey:randomUUID()}));
 await ok(http(tech,url),404);
 await changeTeam(url,tech);await changeTeam(otherUrl,broad);
 const detail=await ok(http(tech,url));assert.equal(detail.canEdit,false);assert.deepEqual(detail.allowedTransitions,[]);
 assert.equal((await ok(http(tech,url+'/work'))).tasks.length,1);
 for(const suffix of ['', '/history','/work','/work/history','/partners','/partners/history','/documents/history'])await ok(http(tech,otherUrl+suffix),404);
 await ok(http(broad,url),404);await ok(http(foreign,url),404);await ok(http(userB,url),404);
 assert.equal((await ok(http(broad,root+'/browse'))).total,1);
 assert.equal((await ok(http(tech,root))).items[0].applicationId,app.applicationId);
 assert.equal((await ok(http(tech,root+'/browse'))).total,1);
 const inaccessibleOrigin=randomUUID();
 const summaries=await ok(http(tech,root+'/opportunity-summaries?opportunityIds='+[a.seed.opportunityId,inaccessibleOrigin,b.seed.opportunityId].join(',')));assert.deepEqual(summaries.items.map(r=>r.count),[1,0,0]);
 assert.equal((await ok(http(tech,root+'?opportunityId='+inaccessibleOrigin))).items.length,0);
 // Team-derived source access stays inside applications.
 await ok(http(tech,'/api/opportunities/'+a.seed.opportunityId),404);
 const work=await ok(http(tech,url+'/work'));
 await ok(http(tech,url+'/work/tasks/complete','POST',{taskId:work.tasks[0].taskId,expectedRevision:work.revision,idempotencyKey:randomUUID()}),404);
 await ok(http(broad,url+'/work/tasks/complete','POST',{taskId:work.tasks[0].taskId,expectedRevision:work.revision,idempotencyKey:randomUUID()}),404);
 const partner={entity_name:'Parceiro Alfa',country:'Portugal',research_area_interest:'',responsible_person:'Contacto',contact:'',email:'',people:[]};
 await ok(http(userA,url+'/partners','POST',{partner,expectedRevision:1,idempotencyKey:randomUUID()}));
 await ok(http(userA,otherUrl+'/partners','POST',{partner:{...partner,entity_name:'Parceiro reservado Beta'},expectedRevision:1,idempotencyKey:randomUUID()}));
 const partners=await ok(http(tech,root+'/partners'));assert.equal(partners.total,1);assert.equal(partners.items[0].entity_name,'Parceiro Alfa');
 const report=await ok(http(tech,root+'/report'));assert.equal(report.total,1);assert.equal(report.items[0].applicationId,app.applicationId);
 const download=digest=>fetch(base+root+'/report.xlsx?digest='+digest,{headers:{Cookie:tech.cookie}});
 const exported=await download(report.digest);assert.equal(exported.status,200);
 const sheet=read(Buffer.from(await exported.arrayBuffer())).Sheets.Candidaturas;
 const rows=utils.sheet_to_json(sheet,{header:1}).slice(5);
 assert.deepEqual(rows.map(row=>[row[9],row[0]]),[[app.applicationId,app.title]]);
 assert.equal((await ok(http(tech,'/api/notifications'))).total,1);
 const beforeTasks=JSON.stringify((await a.pool.query('SELECT * FROM opportunity_catalog.application_task WHERE organization_id=$1 AND application_id=$2',[a.org,app.applicationId])).rows);
 const historyBefore=(await ok(http(userA,url+'/work/history'))).items;
 const removeBody={membershipId:tech.membershipId,expectedRevision:work.revision,idempotencyKey:randomUUID()};
 failAudit(true);try{await ok(http(userA,url+'/work/participants/remove','POST',removeBody),503)}finally{failAudit(false)}
 await ok(http(tech,url));
 console.log('TEAM_ACCESS_HTTP_SCOPE_EXPORT_AUDIT_PASS');
 await require('./browser').run({base,tech,broad,app,other,remove:()=>changeTeam(url,tech,true)});
 // Closing browser contexts can leave already-started session authority writes
 // finishing on the server. Wait for those fixture requests; keep exact HTTP
 // denial assertions below, rather than treating transient 503 as a pass.
 let pending=1;
 for(let n=0;n<50&&pending;n++){pending=Number((await central.pool.query("SELECT count(*)::int n FROM public.authority_write_request WHERE state='WAITING'")).rows[0].n);if(pending)await new Promise(r=>setTimeout(r,200));}
 assert.equal(pending,0,'Browser authority writes must finish before HTTP continuation');
 await ok(http(tech,url),404);assert.equal((await ok(http(tech,root+'/browse'))).total,0);
 assert.equal((await ok(http(tech,root+'/report'))).total,0);assert.equal((await ok(http(tech,root+'/partners'))).total,0);
 assert.equal((await ok(http(tech,'/api/notifications'))).total,0);assert.equal((await download(report.digest)).status,409);
 assert.equal(JSON.stringify((await a.pool.query('SELECT * FROM opportunity_catalog.application_task WHERE organization_id=$1 AND application_id=$2',[a.org,app.applicationId])).rows),beforeTasks);
 assert.deepEqual((await ok(http(userA,url+'/work/history'))).items.slice(1),historyBefore);
 assert.equal(await grantSnapshot(),grantsBefore);
 await changeTeam(url,tech);await ok(http(tech,url));
 // Broad historic grants do not survive removal either.
 await changeTeam(otherUrl,broad,true);await ok(http(broad,otherUrl),404);assert.equal((await ok(http(broad,root+'/browse'))).total,0);
 // Existing central-origin applications use their captured snapshot. No import
 // or public provider is simulated by this authority fixture.
 const centralApp=randomUUID(),centralOpportunity=randomUUID();
 await a.pool.query(`INSERT INTO opportunity_catalog.application(organization_id,application_id,central_opportunity_id,central_revision_id,central_snapshot,title,responsible_membership_id,deadline,status,created_by)
  VALUES($1,$2,$3,$4,$5,$6,$7,'2027-12-31','IDENTIFIED',$8)`,[a.org,centralApp,centralOpportunity,randomUUID(),{title:'Origem central de ensaio',closingDate:'2027-12-31'},'Projeto central da equipa',userA.membershipId,userA.id]);
 const centralUrl=root+'/'+centralApp;await changeTeam(centralUrl,tech);assert.equal((await ok(http(tech,centralUrl))).origin,'CENTRAL');
 const mixed=await ok(http(tech,root+'/opportunity-summaries?opportunityIds='+[a.seed.opportunityId,centralOpportunity,inaccessibleOrigin].join(',')));assert.deepEqual(mixed.items.map(r=>r.count),[1,1,0]);
 assert.equal((await ok(http(tech,root+'?opportunityId='+centralOpportunity))).items[0].applicationId,centralApp);
 await changeTeam(centralUrl,tech,true);await ok(http(tech,centralUrl),404);
 assert.equal((await ok(http(tech,root+'/opportunity-summaries?opportunityIds='+centralOpportunity))).items[0].count,0);
 console.log('TEAM_ACCESS_REVOCATION_TASKS_HISTORY_PASS');
 await require('../../../backend/src/security/membershipRepository').createMembershipRepository(central.pool,central.coordinator).changeStatus({membershipId:tech.membershipId,status:'SUSPENDED',reason:'synthetic team-access proof'});
 const suspended=await http(tech,url);assert([401,404,409].includes(suspended.status));
 const out=path.resolve(__dirname,'../../../output/playwright/c4g-team-access');fs.mkdirSync(out,{recursive:true});fs.writeFileSync(path.join(out,'http-verification.json'),JSON.stringify({result:'PASS',synthetic:true,postgres:true,twoOrganizations:true,teamDerivedRead:true,broadGrantsClamped:true,noImplicitWrite:true,sourceBoundary:true,privateAndCentralOrigins:true,mixedOpportunityCounts:true,listsReportsPartnersAlerts:true,staleExport:true,taskAndHistoryPreserved:true,centralGrantsUnchanged:true,auditRollback:true,suspension:true},null,2));
 console.log('TEAM_ACCESS_POSTGRES_HTTP_PASS');
}
module.exports={run};
