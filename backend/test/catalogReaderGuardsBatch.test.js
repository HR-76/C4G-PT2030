'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {admitReader}=require('../src/opportunities/catalogRead/readSchema');
const valid={name:'limited_reader',parents:[{rolname:'c4g_catalog_projection_reader'}],excess:false,authority:{limited:true},authorityParents:[{rolname:'c4g_catalog_projection_membership'}]};
test('restored reader validates fresh guards before querying the fingerprint',async()=>{
 let calls=0;const client={query:async(sql,args)=>{calls++;if(calls===1){assert.deepEqual(args,['limited_authority']);assert(!sql.includes('admissionGuards'));return {rows:[valid]};}assert(sql.includes('AS "relations"'));throw Error('FINGERPRINT_CHECK_REACHED');}};
 await assert.rejects(admitReader(client,{authorityLogin:'limited_authority'}),/FINGERPRINT_CHECK_REACHED/);assert.equal(calls,2);
});
for(const [patch,error] of [[{parents:[]},'CATALOG_READER_MEMBERSHIP_INVALID'],[{parents:[...valid.parents,{rolname:'extra'}]},'CATALOG_READER_MEMBERSHIP_INVALID'],[{excess:true},'CATALOG_READER_DIRECT_PRIVILEGES'],[{authority:{limited:false}},'CATALOG_AUTHORITY_LOGIN_INVALID'],[{authorityParents:[]},'CATALOG_AUTHORITY_LOGIN_INVALID']]){
 test('restored guards refuse drift before metadata or protected reads: '+JSON.stringify(patch),async()=>{
  let calls=0;await assert.rejects(admitReader({query:async()=>{calls++;if(calls>1)throw Error('UNEXPECTED_QUERY');return {rows:[{...valid,...patch}]};}},{authorityLogin:'limited_authority'}),new RegExp(error));assert.equal(calls,1);
 });
}
