'use strict';
const assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');
const {createSqlBrowse}=require('../../../backend/src/applications/browseSql');
const {createPq1UiTokens}=require('../../../backend/src/organizationalProfile/pq1UiTokens');
const {parse}=require('../../../backend/src/applications/browse');
const {currentStatus}=require('../../../backend/src/applications/contracts');
module.exports=async function proof(client,tenant,authority,report){
 const org=tenant.organizationId,subject=tenant.owner.id;
 const tokens=createPq1UiTokens({keys:{proof:'synthetic-proof-key-'.repeat(3)},currentKeyId:'proof'});
 let current=authority,allowed=true;
 const make=(organizationId=org,subjectId=subject)=>createSqlBrowse({org:organizationId,actor:{id:subjectId},cursor:tokens,
  guarded:async()=>{if(!allowed)throw Object.assign(new Error(),{code:'NOT_AUTHORIZED'});},readAuthority:async()=>current,
  responsibleDirectory:async()=>new Map([[tenant.owner.membershipId,'Synthetic owner']]),transitionCapability:async()=>true,
  project:row=>({...row,applicationId:row.application_id,status:currentStatus(row.status)})});
 const browse=make(),first=await browse(client,parse({}));assert(first.nextCursor);
 const second=await browse(client,parse({cursor:first.nextCursor}));assert.equal(second.page,2);
 assert(first.items.every(a=>!second.items.some(b=>a.applicationId===b.applicationId)));
 for(const input of [{cursor:first.nextCursor+'x'},{cursor:first.nextCursor,q:'other'},{cursor:first.nextCursor,sort:'totalBudget'}])
  await assert.rejects(browse(client,parse(input)),{code:'INVALID_CURSOR'});
 await assert.rejects(make(org,randomUUID())(client,parse({cursor:first.nextCursor})),{code:'INVALID_CURSOR'});
 await assert.rejects(make(randomUUID())(client,parse({cursor:first.nextCursor})),{code:'INVALID_CURSOR'});
 current={...authority,application:{all:false,ids:first.items.map(x=>x.applicationId)}};
 await assert.rejects(browse(client,parse({cursor:first.nextCursor})),{code:'INVALID_CURSOR'});current=authority;
 allowed=false;await assert.rejects(browse(client,parse({})),{code:'NOT_AUTHORIZED'});allowed=true;
 await client.query('SAVEPOINT cursor_change');
 try{
  const outside=(await client.query('SELECT application_id FROM opportunity_catalog.application WHERE organization_id=$1 ORDER BY title DESC LIMIT 1',[org])).rows[0].application_id;
  await client.query("UPDATE opportunity_catalog.application SET notes='Synthetic cursor proof' WHERE organization_id=$1 AND application_id=$2",[org,outside]);
  await assert.rejects(browse(client,parse({cursor:first.nextCursor})),{code:'INVALID_CURSOR'});
 }finally{await client.query('ROLLBACK TO SAVEPOINT cursor_change');}
 const denied={...authority,teamOnly:true,membershipId:randomUUID()};current=denied;assert.equal((await browse(client,parse({}))).total,0);
 report.checks.push({signedCursor:'PASS',binding:['actor','organization','filters'],tampering:'DENIED',offPageChange:'DENIED',permissionChange:'DENIED',guardFailure:'DENIED',noTeam:'EMPTY',limit:'Authority entry is synthetic; no concurrent central revocation claim.'});
};
