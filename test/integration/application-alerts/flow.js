'use strict';
const assert=require('node:assert/strict'),{randomUUID}=require('node:crypto');
async function run({central,tenants,base,http,actor,userA,userB,failures,failAudit,loseNextCommit}){
 const [a,b]=tenants,root='/api/notifications';
 const expect=async(p,status=200)=>{const r=await p;assert.equal(r.status,status,JSON.stringify({r,failures:failures.slice(-2)}));return r.data};
 const member=await actor(a.org,['notification.read','application.read','opportunity.read']),unrelated=await actor(a.org,['notification.read','application.read','opportunity.read']);
 const app=await expect(http(userA,'/api/applications','POST',{opportunityId:a.seed.opportunityId,evaluationId:null,title:'Candidatura de ensaio — alertas',responsibleMembershipId:member.membershipId,deadline:'2026-12-31',idempotencyKey:randomUUID()}),201),url='/api/applications/'+app.applicationId;
 const teamBody={membershipId:member.membershipId,expectedRevision:1,idempotencyKey:randomUUID()};
 await expect(http(userA,url+'/work/participants','POST',teamBody));await expect(http(userA,url+'/work/participants','POST',teamBody));
 await expect(http(userA,url+'/work/participants','POST',{membershipId:userA.membershipId,expectedRevision:2,idempotencyKey:randomUUID()}));
 console.log('ALERTS_TEAM_GENERATED');
 let list=await expect(http(member,root));assert.equal(list.total,1);assert.equal(list.notifications[0].type,'APPLICATION_TEAM_ADDED');
 assert.equal((await expect(http(userA,root))).total,0);assert.equal((await expect(http(unrelated,root))).total,0);assert.equal((await expect(http(userB,root))).total,0);
 const firstId=list.notifications[0].id;await expect(http(userB,root+'/'+firstId+'/read','PATCH',{}),404);await expect(http(unrelated,root+'/'+firstId+'/read','PATCH',{}),404);
 console.log('ALERTS_RECIPIENT_ISOLATION_PASS');
 const transition={status:'PREPARATION',reason:'Preparação para ensaio',expectedRevision:1,idempotencyKey:randomUUID()};
 failAudit(true);await expect(http(userA,url+'/transitions','POST',transition),503);failAudit(false);assert.equal((await expect(http(member,root))).total,1);assert.equal((await expect(http(userA,url))).revision,1);
 loseNextCommit();await expect(http(userA,url+'/transitions','POST',transition));await expect(http(userA,url+'/transitions','POST',transition));
 console.log('ALERTS_STATE_REPLAY_PASS');
 list=await expect(http(member,root+'?limit=1'));assert.equal(list.notifications.length,1);assert.equal(list.unread_count,2);assert.equal(list.total,2);assert.equal(list.truncated,true);
 assert.equal((await expect(http(userA,root))).total,0);assert.equal((await expect(http(unrelated,root))).total,0);
 failAudit(true);await expect(http(member,root+'/'+firstId+'/read','PATCH',{}),503);failAudit(false);assert.equal((await expect(http(member,root))).unread_count,2);
 await expect(http(member,root+'/'+firstId+'/read','PATCH',{}));await expect(http(member,root+'/'+firstId+'/read','PATCH',{}));assert.equal((await expect(http(member,root))).unread_count,1);
 await expect(http(member,root+'/read-all','PATCH',{}));await expect(http(member,root+'/read-all','PATCH',{}));assert.equal((await expect(http(member,root+'?unread=true'))).total,0);
 console.log('ALERTS_READ_ACK_PASS');
 // Deadline uses the opportunity date and the confirmed responsible/team scope.
 await a.pool.query("UPDATE opportunity_catalog.opportunity SET closing_date=(clock_timestamp() AT TIME ZONE 'Europe/Lisbon')::date+7 WHERE organization_id=$1 AND opportunity_id=$2",[a.org,a.seed.opportunityId]);
 await expect(http(member,root+'/check-deadlines','POST',{}));await expect(http(member,root+'/check-deadlines','POST',{}));
 list=await expect(http(member,root));assert.equal(list.total,3);assert.equal(list.notifications[0].type,'DEADLINE_7_DAYS');assert.equal(list.unread_count,1);
 await expect(http(unrelated,root+'/check-deadlines','POST',{}));assert.equal((await expect(http(unrelated,root))).total,0);
 await expect(http({...member,request:{organizationContext:{organizationId:b.org}}},root),404);
 await expect(http(member,root+'?recipient='+userA.membershipId),400);await expect(http(member,root+'/read-all','PATCH',{organizationId:b.org}),400);
 await require('./browser').run({base,user:member,userB,applicationId:app.applicationId});
 // Current resource authorization suppresses message, title and counts after grant revocation.
 let current=await central.pool.query('SELECT authorization_version FROM public.authority_f5_state WHERE membership_id=$1',[member.membershipId]);
 await central.data.change({organizationId:a.org,membershipId:member.membershipId,expectedVersion:Number(current.rows[0].authorization_version),grants:['notification.read','application.read'].map(permission=>({permission,scope:{type:'ORGANIZATION',id:a.org,organizationId:a.org}})),assuranceRequirements:central.requirement});
 assert.equal((await expect(http(member,root))).total,0);await expect(http(member,root+'/'+firstId+'/read','PATCH',{}),404);
 // Same tenant RLS isolates recipients; a different organization returns no rows.
 const client=await a.limitedPool.connect();try{
  await client.query('BEGIN');await client.query('SET LOCAL ROLE c4g_opportunity_tenant_runtime');
  await client.query("SELECT set_config('app.organization_id',$1,true),set_config('app.membership_id',$2,true)",[a.org,unrelated.membershipId]);assert.equal((await client.query('SELECT * FROM opportunity_catalog.application_alert')).rowCount,0);
  await client.query("SELECT set_config('app.organization_id',$1,true),set_config('app.membership_id',$2,true)",[b.org,member.membershipId]);assert.equal((await client.query('SELECT * FROM opportunity_catalog.application_alert')).rowCount,0);await client.query('ROLLBACK');
  await client.query('BEGIN');await client.query('SET LOCAL ROLE c4g_opportunity_tenant_runtime');await client.query("SELECT set_config('app.organization_id',$1,true),set_config('app.membership_id',$2,true)",[a.org,member.membershipId]);
  await assert.rejects(()=>client.query('UPDATE opportunity_catalog.application_alert SET read_at=NULL WHERE alert_id=$1',[firstId]),e=>e.code==='P0001');await client.query('ROLLBACK');
  await assert.rejects(()=>client.query('DELETE FROM opportunity_catalog.application_alert'),e=>e.code==='42501');
 }finally{await client.query('ROLLBACK');client.release()}
 assert.equal((await a.pool.query('SELECT count(*)::int n FROM opportunity_catalog.application_alert')).rows[0].n,3);
 console.log('APPLICATION_ALERTS_POSTGRES_HTTP_RECIPIENTS_REPLAY_ROLLBACK_RLS_REVOCATION_PASS');
 const fs=require('node:fs'),path=require('node:path'),out=path.resolve(__dirname,'../../../output/playwright/c4g-alerts');fs.mkdirSync(out,{recursive:true});fs.writeFileSync(path.join(out,'verification.json'),JSON.stringify({result:'PASS',twoOrganizations:true,recipientDeduplication:true,actorExcluded:true,replay:true,auditRollback:true,revocation:true,rls:true},null,2));
}
module.exports={run};
