'use strict';
const assert=require('node:assert/strict');
async function verify({tenant,client,http,central,check,report}){
 const blocker=await tenant.pool.connect();let reading,revoking,committed=false,locked=false;
 const memberships=require('../../../backend/src/security/membershipRepository').createMembershipRepository(central.pool,central.coordinator);
 try{
  await blocker.query('BEGIN');await blocker.query('LOCK TABLE opportunity_catalog.application IN ACCESS EXCLUSIVE MODE');locked=true;
  reading=http(client,'/api/applications/browse');
  const deadline=Date.now()+9000;let waiting=false,blockedAt=null;
  while(Date.now()<deadline){
   const row=(await tenant.pool.query("SELECT query FROM pg_stat_activity WHERE datname=current_database() AND usename=$1 AND wait_event_type='Lock' LIMIT 1",[tenant.credentials.login])).rows[0];
   waiting=Boolean(row);blockedAt=row?(row.query.startsWith('WITH names AS')?'application-selection':'tenant-admission'):null;
   if(waiting)break;await new Promise(r=>setTimeout(r,50));
  }
  assert(waiting,'real tenant request reaches a PostgreSQL lock');
  revoking=memberships.changeStatus({membershipId:tenant.owner.membershipId,status:'SUSPENDED',reason:'Synthetic concurrent HTTP proof'}).then(value=>{committed=true;return value;});
  revoking.catch(()=>{});
  // Observe the durable writer registration, without changing its protocol.
  const writerDeadline=Date.now()+3000;let registered=false;
  while(Date.now()<writerDeadline){
   registered=(await central.pool.query("SELECT EXISTS(SELECT 1 FROM public.authority_write_request WHERE state='WAITING' AND $1=ANY(scope_keys)) waiting",['MEMBER:'+tenant.owner.membershipId])).rows[0].waiting;
   if(registered||committed)break;await new Promise(r=>setTimeout(r,25));
  }
  // Decompiling schema metadata can acquire the relation lock before the data
  // selection. At that boundary no commit guard exists yet: complete revocation
  // before releasing the real lock and prove the later admission fails closed.
  if(blockedAt==='tenant-admission')await revoking;
  const committedBeforeRelease=committed;
  await blocker.query('COMMIT');locked=false;
  const result=await reading;await revoking;
  assert(!committedBeforeRelease||result.status!==200,'revoked authority cannot publish a stale successful read');
  report.concurrentRevocation={databaseReadBlocked:true,blockedAt,writerRegistered:registered,committedBeforeRelease,readStatus:result.status,readMs:Math.round(result.ms)};
  check('concurrent membership revocation prevents a stale real tenant read');
 }finally{if(locked)await blocker.query('ROLLBACK');blocker.release();if(reading)await reading;if(revoking)await revoking;}
 assert([401,403].includes((await http(client,'/api/applications/browse')).status));
 check('revoked central membership denies subsequent real HTTP reads');
}
module.exports={verify};
