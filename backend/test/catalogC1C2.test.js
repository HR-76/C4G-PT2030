'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
// Preserve the rejected prototype's regression evidence, explicitly archived.
const archived=require('./support/loadRejectedCandidate.cjs');
const {nativeConstraintSql}=archived('backend/src/security/catalogConstraintQuery.js');
const schema=archived('backend/src/opportunities/catalogRead/readSchema.js');
const expr="COALESCE((to_jsonb(con)->>'conenforced')::boolean,false)";
test('archived C1 uses only the explicitly supplied supported version; next invocation observes again',async()=>{
 let calls=0;const c={query:async()=>{calls++;return {rows:[{server_version_num:'170006'}]};}};
 assert.equal(await nativeConstraintSql(c,expr,18),'COALESCE(con.conenforced,false)');assert.equal(calls,0);
 assert.equal(await nativeConstraintSql(c,expr),expr);assert.equal(calls,1);
 for(const v of [null,16,19,'18',true,NaN])await assert.rejects(nativeConstraintSql(c,expr,v));
});
test('archived C2 collects guards and projection in one fresh statement; revocation on the next call is refused',async()=>{
 let calls=0;const c={async query(sql){calls++;assert(sql.includes('AS "admissionGuards"'));assert(sql.includes('AS "memberships"'));return {rows:[{admissionGuards:{name:'reader',parents:calls===1?[{rolname:'c4g_catalog_projection_reader'}]:[],excess:false,authority:{limited:true},authorityParents:[{rolname:'c4g_catalog_projection_membership'}]},memberships:[{rolname:'c4g_catalog_projection_reader',member:'reader',admin_option:false,inherit_option:false,set_option:true},{rolname:'c4g_catalog_projection_membership',member:'member',admin_option:false,inherit_option:false,set_option:true}]}]};}};
 await assert.rejects(schema.admitReader(c,{authorityLogin:'member'}),/CATALOG_READ_SCHEMA_OR_PERMISSION_DRIFT/);assert.equal(calls,1);
 await assert.rejects(schema.admitReader(c,{authorityLogin:'member'}),/CATALOG_READER_MEMBERSHIP_INVALID/);assert.equal(calls,2);
});
test('archived C2 refuses malformed guards, direct privileges and query failures before protected reads',async()=>{
 for(const guard of [null,{}, {name:'r',parents:[{rolname:'c4g_catalog_projection_reader'}],excess:true}]){
  let count=0;await assert.rejects(schema.admitReader({query:async sql=>{count++;assert(sql.includes('admissionGuards'));return {rows:[{admissionGuards:guard}]};}}));assert.equal(count,1);
 }
 await assert.rejects(schema.admitReader({query:async()=>{throw Error('DATABASE_FAILED');}}),/DATABASE_FAILED/);
});
