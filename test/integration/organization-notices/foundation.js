'use strict';
// Repository/RLS proof only. Central authority, HTTP and UI are not composed yet.
const assert=require('node:assert/strict'),{randomUUID}=require('node:crypto');
const {parse,createNoticesRepository}=require('../../../backend/src/applications/notices');
const {createPq1UiTokens}=require('../../../backend/src/organizationalProfile/pq1UiTokens');
module.exports=async function foundation(client){
 const org=randomUUID(),otherOrg=randomUUID(),author={id:randomUUID(),membershipId:randomUUID()},member=randomUUID(),outsider=randomUUID();
 const known=new Map([[author.membershipId,'Autor de ensaio'],[member,'Destinatario de ensaio']]);
 const tokens=createPq1UiTokens({keys:{test:'x'.repeat(32)},currentKeyId:'test'});
 let manage=true,auditFailure=false,audits=0;
 const repository=createNoticesRepository({organizationId:org,actor:author,cursor:tokens,
  protect:async()=>{},canManage:async()=>manage,recipients:async ids=>(ids||[...known.keys()]).filter(id=>known.has(id)).map(id=>({membershipId:id,name:known.get(id)})),
  audit:async()=>{if(auditFailure)throw Object.assign(Error('Injected audit failure'),{code:'AUDIT_FAILED'});audits++}});
 const context=async(organizationId,membershipId,admin=false)=>{
  await client.query('SET LOCAL ROLE c4g_opportunity_tenant_runtime');
  await client.query("SELECT set_config('app.organization_id',$1,true),set_config('app.membership_id',$2,true),set_config('app.notice_admin',$3,true)",[organizationId,membershipId,String(admin)]);
 };
 const command=()=>parse('noticesSend',{title:'Aviso de ensaio',message:'Mensagem privada de ensaio',recipientMembershipIds:[member],idempotencyKey:randomUUID()});
 const rejected=async(work,code)=>{await client.query('SAVEPOINT refusal');await assert.rejects(work,{code});await client.query('ROLLBACK TO SAVEPOINT refusal');await client.query('RELEASE SAVEPOINT refusal')};
 await context(org,author.membershipId);
 const input=command(),notice=await repository.noticesSend(client,null,input);
 assert.deepEqual(await repository.noticesSend(client,null,input),notice);assert.equal(audits,1);
 await rejected(()=>repository.noticesSend(client,null,{...input,message:'Changed'}),'IDEMPOTENCY_CONFLICT');
 await rejected(()=>repository.noticesSend(client,null,{...command(),recipientMembershipIds:[member,outsider]}),'RECIPIENT_UNAVAILABLE');
 auditFailure=true;await rejected(()=>repository.noticesSend(client,null,command()),'AUDIT_FAILED');auditFailure=false;
 assert.equal((await client.query('SELECT count(*)::int AS n FROM opportunity_catalog.organization_notice')).rows[0].n,1);
 assert.equal((await client.query('SELECT count(*)::int AS n FROM opportunity_catalog.organization_notice_recipient')).rows[0].n,1);
 const detail=await repository.noticesGet(client,notice.noticeId);
 assert.deepEqual(detail.recipients,[{membershipId:member,name:known.get(member)}]);
 assert.ok(!JSON.stringify(detail).includes('read_at'));
 // No automatic sender copy. Other organization and unselected membership see nothing.
 for(const [o,m] of [[org,author.membershipId],[org,outsider],[otherOrg,member]]){
  await context(o,m);
  assert.equal((await client.query('SELECT * FROM opportunity_catalog.organization_notice')).rowCount,0);
  assert.equal((await client.query('SELECT * FROM opportunity_catalog.organization_notice_recipient')).rowCount,0);
 }
 await context(org,member);
 assert.equal((await client.query('SELECT * FROM opportunity_catalog.organization_notice')).rowCount,1);
 assert.equal((await client.query('SELECT * FROM opportunity_catalog.organization_notice_recipient')).rowCount,1);
 await rejected(()=>client.query('UPDATE opportunity_catalog.organization_notice SET message=$1',['tamper']),'42501');
 await rejected(()=>client.query('UPDATE opportunity_catalog.organization_notice_recipient SET recipient_name=$1',['tamper']),'42501');
 await rejected(()=>client.query('DELETE FROM opportunity_catalog.organization_notice'),'42501');
 await rejected(()=>client.query('DELETE FROM opportunity_catalog.organization_notice_recipient'),'42501');
 assert.equal((await client.query('UPDATE opportunity_catalog.organization_notice_recipient SET read_at=clock_timestamp() WHERE read_at IS NULL')).rowCount,1);
 await rejected(()=>client.query('UPDATE opportunity_catalog.organization_notice_recipient SET read_at=NULL'),'P0001');
 await rejected(()=>client.query('UPDATE opportunity_catalog.organization_notice_recipient SET read_at=clock_timestamp()'),'P0001');
 assert.equal((await client.query('UPDATE opportunity_catalog.organization_notice_recipient SET read_at=clock_timestamp() WHERE read_at IS NULL')).rowCount,0);
 await context(org,outsider);
 assert.equal((await client.query('UPDATE opportunity_catalog.organization_notice_recipient SET read_at=clock_timestamp()')).rowCount,0);
 await context(org,author.membershipId);manage=false;
 await rejected(()=>repository.noticesSend(client,null,command()),'NOT_AUTHORIZED');
 await rejected(()=>repository.noticesHistory(client,null,{}),'NOT_AUTHORIZED');manage=true;
 // Real PostgreSQL cursor boundary: multiple distinct microseconds within one millisecond.
 await context(org,author.membershipId,true);
 const ids=[];
 for(let i=0;i<27;i++){
  const id=randomUUID();ids.push(id);
  await client.query(`INSERT INTO opportunity_catalog.organization_notice(organization_id,notice_id,author_subject_id,author_membership_id,author_name,idempotency_key,intention_digest,title,message,recipient_count,created_at)
   VALUES($1,$2,$3,$4,'Ensaio',$5,$6,'Historico','Ensaio',1,'2026-10-18 10:00:00.123000+00'::timestamptz + $7 * interval '1 microsecond')`,[org,id,author.id,author.membershipId,randomUUID(),'a'.repeat(64),i]);
 }
 const seen=[];let cursor=null;
 do{const page=await repository.noticesHistory(client,null,{cursor});seen.push(...page.items.map(x=>x.noticeId));cursor=page.nextCursor}while(cursor);
 assert.equal(seen.length,28);assert.equal(new Set(seen).size,28);assert.ok(ids.every(id=>seen.includes(id)));
 await client.query('RESET ROLE');
 return {repositoryReplay:true,digestConflict:true,invalidRecipientAtomic:true,auditFailureRollback:true,recipientRls:true,
  organizationRls:true,noAutomaticSenderCopy:true,immutableContent:true,monotonicOwnRead:true,historyMicrosecondPagination:true,
  scope:'Foundation only; authority ports are injected, no HTTP/UI or native activation'};
};
