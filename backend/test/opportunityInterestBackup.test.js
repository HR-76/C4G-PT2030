'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {args,assertCopy,ownedCluster}=require('../scripts/localPlatform/backupOpportunityInterests');
test('restore supplement accepts only missing explicit owner ACLs on the two known policy tables',()=>{
 const {aclSupplement}=require('../scripts/localPlatform/backupOpportunityInterests');
 const row={object_name:'band_policy',grantee:'c4g_organization_profile_owner',privilege_type:'SELECT',is_grantable:false};
 assert.match(aclSupplement([row],[]),/GRANT SELECT/);
 assert.equal(aclSupplement([row],[row]),'');
 for(const changed of [{...row,object_name:'other'},{...row,grantee:'public'},{...row,is_grantable:true},{...row,privilege_type:'BOGUS'}])assert.throws(()=>aclSupplement([changed],[]));
 assert.throws(()=>aclSupplement([],[row]));
});
test('backup accepts only its fixed backup and isolated restore mode',()=>{
 args(['--backup-and-restore']);
 for(const argv of [[],['--apply'],['--backup-and-restore','--host=remote']])assert.throws(()=>args(argv));
});
test('restore verification refuses missing rows, changed digests and sequence drift',()=>{
 const before={data:{t:{count:2,digest:'exact'}},sequences:{s:{last_value:'3',is_called:true}}};
 assertCopy(before,structuredClone(before));
 for(const mutate of [x=>x.data.t.count++,x=>x.data.t.digest='changed',x=>delete x.data.t,x=>x.sequences.s.last_value='4']){
  const after=structuredClone(before);mutate(after);assert.throws(()=>assertCopy(before,after));
 }
});
test('cluster cleanup refuses a path outside its owned backup folder',()=>{
 assert.throws(()=>ownedCluster('C:/backup','C:/existing/restore-cluster','marker'));
 assert.throws(()=>ownedCluster('C:/backup','C:/backup/existing','marker'));
});
