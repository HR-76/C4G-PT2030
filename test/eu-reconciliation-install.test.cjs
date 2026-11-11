'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const i=require('../scripts/eu-reconciliation-install.cjs'),pkg=require('../backend/src/security/opportunityEuReconciliationMigrationPackage');
const id='42188168-9e32-4928-bf44-6d38e94388b7',actor='e933bc9c-3ba0-40bc-bdb0-59359604be18';
test('installer accepts only install-only plus one current plan and local approval filename',()=>{
 const argv=['--install-only','--plan='+id,'--approval=approval-'+id+'.json'];assert.deepEqual(i.args(argv),{planId:id,approvalFile:'approval-'+id+'.json'});
 for(const bad of [[...argv,'--resume'],['--execute',...argv.slice(1)],[argv[0],argv[1],'--approval=../approval.json'],[argv[0],'--plan=bad',argv[2]]])assert.throws(()=>i.args(bad));
});
test('installation approval is same plan, digest, actor and live OIDC assurance with replay evidence',()=>{
 const plan={planId:id,previewDigest:'a'.repeat(64),expiresAt:new Date(Date.now()+300000).toISOString()},loaded={plan};
 const a={scope:'RECONCILIATION_ONLY',planId:id,previewDigest:plan.previewDigest,actorId:actor,eventId:id,eventHash:'b'.repeat(64),expiresAt:plan.expiresAt};
 const r={kind:'eu-expired-reconciliation-authenticated-approval-v1',status:'PASS',scope:'RECONCILIATION_ONLY',sessionFabricated:false,credentialsExported:false,authentication:{provider:'OIDC',administrator:true,actorId:actor},planId:id,previewDigest:plan.previewDigest,result:{approval:a,replayVerified:true,sourceUnchanged:true}};
 assert.equal(i.validateApproval(r,loaded),a);
 for(const edit of [v=>v.sessionFabricated=true,v=>v.credentialsExported=true,v=>v.authentication.administrator=false,v=>v.authentication.provider='LOCAL',v=>v.result.sourceUnchanged=false,v=>v.result.replayVerified=false,v=>v.result.approval.actorId=id,v=>v.result.approval.previewDigest='c'.repeat(64),v=>v.result.approval.eventHash='bad',v=>v.scope='RESUME']){const v=structuredClone(r);edit(v);assert.throws(()=>i.validateApproval(v,loaded));}
 const expired=structuredClone(r),past=new Date(Date.now()-1000).toISOString();expired.result.approval.expiresAt=past;assert.throws(()=>i.validateApproval(expired,{plan:{...plan,expiresAt:past}}),/EXPIRED/);
});
test('preservation hashes explicit old columns and all rows except ledger entries after043',async()=>{
 const client={query:async(sql)=>{if(sql.includes('pg_class'))return {rows:[{nspname:'public',relname:'c4g_schema_migration'},{nspname:'opportunity_catalog',relname:'funding_run'},{nspname:'async_exec',relname:'outbox'}]};if(sql.includes('information_schema.columns'))return {rows:[{column_name:'version'},{column_name:'value'}]};return {rows:[{count:3,digest:'a'.repeat(64)}]};}};
 const result=await i.capture(client,{central:true});assert.equal(result.length,3);assert.deepEqual(result[0].values,[pkg.CENTRAL_BASELINE]);assert.match(result[0].sql,/WHERE version<=\$1/);
 for(const r of result){assert.match(r.sql,/SELECT "version","value"/);assert.equal(r.count,3);assert.doesNotMatch(r.sql,/SELECT \*/);}
 for(const r of result.slice(1)){assert.deepEqual(r.values,[]);assert.doesNotMatch(r.sql,/ WHERE /);}
});

test('immutable audit read locks are released before acquiring authority locks across policy DDL',async()=>{
 const now=Date.now(),plan={planId:id,previewDigest:'a'.repeat(64),expiresAt:new Date(now+300000).toISOString()},loaded={plan},policy='c4g-user-mfa-v1';
 const event={eventId:id,sequence:1,previousHash:'0'.repeat(64),actor:{type:'HUMAN',id:actor},eventCode:'SENSITIVE_ACTION_ALLOWED',resource:{type:'EU_EXPIRED_RECONCILIATION',id},payload:{detailCode:'EU_EXPIRED_RECONCILIATION_APPROVED',semanticDigest:require('../backend/src/opportunities/v2/euRunReconciliationPlan').hash(plan),scopeDigest:plan.previewDigest}};
 const hash=require('../backend/src/audit/integrity').eventHash(event),receipt={scope:'RECONCILIATION_ONLY',planId:id,previewDigest:plan.previewDigest,actorId:actor,eventId:id,eventHash:hash,expiresAt:plan.expiresAt};
 const report={kind:'eu-expired-reconciliation-authenticated-approval-v1',status:'PASS',scope:'RECONCILIATION_ONLY',sessionFabricated:false,credentialsExported:false,authentication:{provider:'OIDC',administrator:true,actorId:actor},planId:id,previewDigest:plan.previewDigest,result:{approval:receipt,replayVerified:true,sourceUnchanged:true}};
 const requirement=require('../backend/src/security/authConfig').RECOGNIZED_ASSURANCE_POLICIES[policy].policy['recent-auth'];
 let auditLock=false,authorityLock=false,savedAuthority=false,forged=false;const statements=[];
 const client={async query(sql){statements.push(sql);if(sql.startsWith('SAVEPOINT ')){savedAuthority=authorityLock;return {rows:[]};}if(sql.startsWith('SELECT event_data')){auditLock=true;return {rows:[{event_data:event,event_hash:forged?'f'.repeat(64):hash}]};}
  if(sql.startsWith('ROLLBACK TO SAVEPOINT')){assert.equal(authorityLock,savedAuthority,'existing authority locks must survive audit savepoint rollback');auditLock=false;return {rows:[]};}
  if(sql.startsWith('SELECT s.sid')){assert.equal(auditLock,false,'AUDIT_READ_LOCK_WOULD_BLOCK_POLICY_DDL');return {rows:[{sid:'synthetic-reconciliation-session'}]};}
  if(sql.startsWith('SELECT authority')){authorityLock=true;return {rows:[{authority:{userId:actor,storedUserId:actor,revocationVersion:1,storedRevocationVersion:1,policyVersion:policy,nowSeconds:now/1000,expiresAt:now+300000,absoluteExpiresAt:now+300000,cookieExpires:null,evidence:{authTime:now/1000,acr:requirement.acceptedAcr[0],amr:requirement.acceptedAmr,policyVersion:policy}}}]};}
  return {rows:[]};}};
 const proof=await i.verifyApprovalInDatabase(client,report,loaded);assert.equal(proof.recentAdministrator,true);assert.equal(auditLock,false);assert.equal(authorityLock,true);
 await i.verifyApprovalInDatabase(client,report,loaded);assert.equal(auditLock,false);assert.equal(authorityLock,true);assert.equal(statements.filter(s=>s.startsWith('RELEASE SAVEPOINT ')).length,2);
 const authorizationCount=statements.filter(s=>s.startsWith('SELECT authority')).length;forged=true;await assert.rejects(i.verifyApprovalInDatabase(client,report,loaded),/RECONCILIATION_AUDIT_CHAIN/);assert.equal(auditLock,false);assert.equal(authorityLock,true);assert.equal(statements.filter(s=>s.startsWith('SELECT authority')).length,authorizationCount);assert(!statements.includes('COMMIT')&&!statements.includes('ROLLBACK'));
});
