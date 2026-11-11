'use strict';
const assert=require('node:assert/strict'),{randomUUID}=require('node:crypto'),fs=require('node:fs'),path=require('node:path');
async function run({central,tenants,base,http,actor,userA,userB,failures}){
 const [a,b]=tenants,root='/api/organization-directory';
 const ok=async(p,status=200)=>{const r=await p;assert.equal(r.status,status,JSON.stringify({r,failures:failures.slice(-2)}));return r.data};
 const manager=await actor(a.org,[],null,{profileCode:'FUNDING_MANAGER',displayName:'Gestor da entidade'});
 const tech=await actor(a.org,['organization_membership.manage','organization_directory.edit'],null,{profileCode:'CONTRIBUTOR',displayName:'Técnica da equipa'});
 const candidate=await actor(a.org,[],null,{profileCode:'VIEWER',displayName:'Pessoa a associar à equipa'});
 const foreign=await actor(b.org,[],tech.id,{profileCode:'CONTRIBUTOR',displayName:'Mesma pessoa noutra entidade'});
 const targetPath=(u,kind)=>root+'/memberships/'+u.membershipId+'/'+kind;
 const profile=(code,revision=1)=>({profileCode:code,expectedRevision:revision,idempotencyKey:randomUUID()});
 const status=(state,revision=1)=>({status:state,expectedRevision:revision,idempotencyKey:randomUUID()});
 const refresh=u=>ok(http(u,'/api/auth/organization','POST',{organizationId:a.org}));
 const list=await ok(http(manager,root+'/access'));assert(list.items.some(m=>m.membershipId===tech.membershipId));assert(!list.items.some(m=>m.membershipId===foreign.membershipId));
 assert.equal(list.items.find(m=>m.membershipId===userA.membershipId).profileOptions.length,0);
 await ok(http(tech,root+'/access'),403);
 await ok(http(tech,targetPath(candidate,'profile'),'PUT',profile('CONTRIBUTOR')),403);
 await ok(http(manager,targetPath(candidate,'profile'),'PUT',profile('ORG_ADMIN')),403);
 await ok(http(manager,targetPath(candidate,'status'),'PUT',status('SUSPENDED')),403);
 await ok(http(manager,targetPath(userA,'status'),'PUT',status('SUSPENDED')),403);
 await ok(http(manager,targetPath(userA,'profile'),'PUT',profile('CONTRIBUTOR')),403);
 await ok(http(userA,targetPath(foreign,'profile'),'PUT',profile('CONTRIBUTOR')),404);
 await ok(http(userA,targetPath(userA,'profile'),'PUT',profile('CONTRIBUTOR')),409);
 await ok(http(userB,targetPath(userB,'status'),'PUT',status('SUSPENDED')),409);
 await ok(http(userA,targetPath(candidate,'profile'),'PUT',{...profile('CONTRIBUTOR'),organizationId:b.org}),400);
 // The identity has a separate membership in B. Changing A must not touch it.
 const suspend=status('SUSPENDED');await ok(http(manager,targetPath(tech,'status'),'PUT',suspend));await ok(http(manager,targetPath(tech,'status'),'PUT',suspend));
 assert.equal((await central.pool.query('SELECT status FROM public.organization_membership WHERE id=$1',[foreign.membershipId])).rows[0].status,'ACTIVE');
 assert([401,403,409].includes((await http(tech,'/api/applications/browse')).status));
 await ok(http(manager,targetPath(tech,'status'),'PUT',status('ACTIVE',2)));
 const command=profile('CONTRIBUTOR');await ok(http(manager,targetPath(candidate,'profile'),'PUT',command));await ok(http(manager,targetPath(candidate,'profile'),'PUT',command));
 await ok(http(manager,targetPath(candidate,'profile'),'PUT',profile('CONTRIBUTOR')),409);
 assert.equal((await central.pool.query("SELECT count(*)::int n FROM audit.event WHERE event_code='GRANT_CHANGED' AND idempotency_key=$1",[`MEMBERSHIP:${a.org}:${command.idempotencyKey}`])).rows[0].n,1);
 // Renew selection after the membership version changed, as a real client does.
 await refresh(candidate);await ok(http(candidate,root+'/access'),403);
 const app=await ok(http(userA,'/api/applications','POST',{opportunityId:a.seed.opportunityId,evaluationId:null,title:'Projeto de ensaio dos perfis',responsibleMembershipId:userA.membershipId,deadline:'2027-12-31',idempotencyKey:randomUUID()}),201);
 const appPath='/api/applications/'+app.applicationId;
 let work=await ok(http(userA,appPath+'/work'));
 work=await ok(http(userA,appPath+'/work/participants','POST',{membershipId:candidate.membershipId,expectedRevision:work.revision,idempotencyKey:randomUUID()}));
 await ok(http(userA,appPath+'/work/tasks','POST',{title:'Tarefa preservada pelos perfis',responsibleMembershipId:candidate.membershipId,deadline:'2027-11-30',expectedRevision:work.revision,idempotencyKey:randomUUID()}));
 await ok(http(candidate,appPath));assert.equal((await ok(http(candidate,'/api/applications/browse'))).total,1);
 const tasksBefore=(await a.pool.query('SELECT to_jsonb(t) row FROM opportunity_catalog.application_task t ORDER BY task_id')).rows;
 // Inject after the actual central update to prove atomic rollback, not only input rejection.
 const protocol=require('../../../backend/src/security/authorityProtocolQueries'),original=protocol.execute;
 const change=profile('FUNDING_MANAGER',2);
 protocol.execute=async(client,sql,...args)=>{const result=await original(client,sql,...args);if(sql===require('../../../backend/src/organizationDirectory/accessSql').profile)throw Error('SYNTHETIC_AFTER_PROFILE_UPDATE');return result};
 try{await ok(http(userA,targetPath(candidate,'profile'),'PUT',change),503)}finally{protocol.execute=original}
 assert.equal((await central.pool.query('SELECT base_role_code FROM public.organization_membership WHERE id=$1',[candidate.membershipId])).rows[0].base_role_code,'CONTRIBUTOR');
 assert.equal((await central.pool.query("SELECT count(*)::int n FROM audit.event WHERE event_code='GRANT_CHANGED' AND idempotency_key=$1",[`MEMBERSHIP:${a.org}:${change.idempotencyKey}`])).rows[0].n,0);
 await ok(http(userA,targetPath(candidate,'profile'),'PUT',change));await refresh(candidate);
 await ok(http(candidate,root+'/access'));await ok(http(candidate,appPath));
 await ok(http(candidate,targetPath(userA,'profile'),'PUT',profile('CONTRIBUTOR')),403);
 // General management powers are removed on downgrade; tasks and team stay intact.
 await ok(http(userA,targetPath(candidate,'profile'),'PUT',profile('CONTRIBUTOR',3)));await refresh(candidate);
 await ok(http(candidate,root+'/access'),403);const detail=await ok(http(candidate,appPath));assert.equal(detail.canEdit,false);
 assert.deepEqual((await a.pool.query('SELECT to_jsonb(t) row FROM opportunity_catalog.application_task t ORDER BY task_id')).rows,tasksBefore);
 const race=await Promise.all([http(userA,targetPath(tech,'profile'),'PUT',profile('FUNDING_MANAGER',3)),http(userA,targetPath(tech,'profile'),'PUT',profile('ORG_ADMIN',3))]);assert.deepEqual(race.map(r=>r.status).sort(),[200,409],JSON.stringify({race,failures:failures.slice(-2)}));
 console.log('INTERNAL_ACCESS_HTTP_POLICY_ROLLBACK_CONCURRENCY_PASS');
 await require('./browser').run({base,admin:userA,manager,candidate});
 const out=path.resolve(__dirname,'../../../output/playwright/c4g-internal-access');fs.mkdirSync(out,{recursive:true});
 fs.writeFileSync(path.join(out,'http-verification.json'),JSON.stringify({result:'PASS',synthetic:true,organizations:2,managerTechnicianAccess:true,noManagerEscalation:true,noTechnicianEscalation:true,ownAccessProtected:true,identityABPreserved:true,CAS:true,idempotency:true,atomicRollbackAfterUpdate:true,teamReadOnly:true,tasksPreserved:true},null,2));
 console.log('INTERNAL_ACCESS_HTTP_AB_PASS');
}
module.exports={run};
