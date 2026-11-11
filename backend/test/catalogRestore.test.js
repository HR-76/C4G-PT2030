'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const core=require('../src/security/centralSchemaManifest');
const {nativeConstraintSql}=require('../src/security/catalogConstraintQuery');
test('restored collector always observes version even if stale candidate options are supplied',async()=>{
 let calls=0;const c={query:async()=>{calls++;return {rows:[{server_version_num:'170006'}]};}};
 const expr="COALESCE((to_jsonb(con)->>'conenforced')::boolean,false)";
 assert.equal(await nativeConstraintSql(c,expr,18),expr);assert.equal(calls,1);
 await nativeConstraintSql(c,expr,18);assert.equal(calls,2);
});
test('historical comparator refuses the restored runtime before creating an experiment',()=>{
 assert.throws(()=>require('../../test/integration/catalog-acceptance/alternating-selector.cjs').install(),/HISTORICAL_COMPARATOR_RUNTIME_MISMATCH/);
});
test('restored core does not accept a remembered version in place of fresh observation',async()=>{
 let versions=0;const row={tables:[],columns:[],constraints:[],indexes:[],triggers:[],triggerFunctions:[],authoritySequence:[]};
 const c={query:async sql=>{if(sql.includes('server_version_num')){versions++;return {rows:[{server_version_num:'180003'}]};}if(sql.includes('AS "tables"'))return {rows:[structuredClone(row)]};return {rows:[{snapshot:null}]};}};
 await core.centralSchemaSnapshot(c,{compact:true,nativeConstraints:true,constraintVersion:18});await core.centralSchemaSnapshot(c,{compact:true,nativeConstraints:true,constraintVersion:18});assert.equal(versions,2);
});
