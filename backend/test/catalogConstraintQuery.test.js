'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const core=require('../src/security/centralSchemaManifest');
function fixture(versions){
 const sql=[],rows={tables:[],columns:[],constraints:[],indexes:[],triggers:[],triggerFunctions:[],authoritySequence:[]};
 return {sql,rows,client:{async query(text){sql.push(text);if(text.includes('server_version_num'))return {rows:[{server_version_num:versions.shift()}]};if(text.includes('AS "tables"'))return {rows:[structuredClone(rows)]};return {rows:[{snapshot:null}]};}}};
}
test('native constraint checks query the version and fresh metadata on every invocation',async()=>{
 const f=fixture(['180003','180003']);
 await core.centralSchemaSnapshot(f.client,{compact:true,nativeConstraints:true});
 f.rows.constraints=[['t','positive','c','CHECK (id > 0)']];
 const changed=await core.centralSchemaSnapshot(f.client,{compact:true,nativeConstraints:true});
 assert.equal(f.sql.filter(s=>s.includes('server_version_num')).length,2);
 const queries=f.sql.filter(s=>s.includes('AS "tables"'));assert.equal(queries.length,2);
 for(const q of queries){assert(q.includes('OR COALESCE(con.conenforced,false)=false'));assert(!q.includes('to_jsonb(con)'));}
 const legacy=fixture([]);await core.centralSchemaSnapshot(legacy.client,{compact:true});
 assert.equal(queries[0],legacy.sql.find(s=>s.includes('AS "tables"')).replace("COALESCE((to_jsonb(con)->>'conenforced')::boolean,false)",'COALESCE(con.conenforced,false)'));
 assert.equal(changed.constraints.length,1);
});
test('native query transformation refuses a changed or ambiguous SQL template',async()=>{
 const {nativeConstraintSql}=require('../src/security/catalogConstraintQuery');
 for(const sql of ['SELECT 1',"COALESCE((to_jsonb(con)->>'conenforced')::boolean,false) COALESCE((to_jsonb(con)->>'conenforced')::boolean,false)"]){
  const f=fixture(['180003']);await assert.rejects(nativeConstraintSql(f.client,sql),/QUERY_SHAPE_CHANGED/);
 }
});
test('PostgreSQL17 keeps the exact compatible query and malformed/unsupported versions fail closed',async()=>{
 const legacy=fixture([]),pg17=fixture(['170006']);
 await core.centralSchemaSnapshot(legacy.client,{compact:true});
 await core.centralSchemaSnapshot(pg17.client,{compact:true,nativeConstraints:true});
 assert.equal(pg17.sql.find(s=>s.includes('AS "tables"')),legacy.sql.find(s=>s.includes('AS "tables"')));
 for(const version of [null,'','bogus','160000','190000']){
  const f=fixture([version]);await assert.rejects(core.centralSchemaSnapshot(f.client,{compact:true,nativeConstraints:true}));
  assert(!f.sql.some(s=>s.includes('AS "tables"')));
 }
});
test('native constraints still reject noncanonical NOT NULL metadata',async()=>{
 const f=fixture(['180003']);f.rows.constraints=[['t','required','n','UNSUPPORTED_NOT_NULL']];
 await assert.rejects(core.centralSchemaSnapshot(f.client,{compact:true,nativeConstraints:true}),/UNSUPPORTED_NOT_NULL/);
});
