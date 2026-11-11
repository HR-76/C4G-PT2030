"use strict";
const test=require('node:test'),assert=require('node:assert/strict');
const core=require('../src/security/centralSchemaManifest');
test('compact core collection reconstructs the same records on every checkpoint',async()=>{
 let calls=0;const row={tables:[['sample']],columns:[['sample',1,'ação','text',true,'','','']],constraints:[],indexes:[],triggers:[],triggerFunctions:[],authoritySequence:[]};
 const c={async query(sql){if(sql.includes('AS "tables"')){calls++;assert(sql.includes('json_build_array(catalog_row.table_name)'));return {rows:[structuredClone(row)]};}return {rows:[{snapshot:null}]};}};
 const a=await core.centralSchemaSnapshot(c,{compact:true});assert.deepEqual(a.tables,[{table_name:'sample'}]);assert.equal(a.columns[0].column_name,'ação');assert.equal(a.columns[0].not_null,true);
 row.columns[0][7]="'new'::text";const z=await core.centralSchemaSnapshot(c,{compact:true});assert.notEqual(core.schemaFingerprint(a),core.schemaFingerprint(z));assert.equal(calls,2);
});
test('compact catalog rejects missing, extra or malformed tuple fields',()=>{
 const {decodeCatalog,layouts}=require('../src/security/catalogMetadataTransport');
 const row=()=>Object.fromEntries(Object.keys(layouts).map(k=>[k,[]]));
 for(const change of [r=>delete r.columns,r=>r.extra=[],r=>r.columns=null,r=>r.columns=[{}],r=>r.columns=[['too short']],r=>r.tables=[['a','extra']]]){const r=row();change(r);assert.throws(()=>decodeCatalog(r),/CENTRAL_SCHEMA_SNAPSHOT_INVALID/);}
 assert(Object.isFrozen(layouts));assert(Object.isFrozen(layouts.columns));
});
test('authority transport restores duplicated definitions without changing serialized property order',()=>{
 const {decodeAuthority}=require('../src/security/catalogMetadataTransport');
 const f={owner:'owner',definition:'body\nwith Unicode ação',signature:'arg text',grantee:'a'};
 const expected={roles:[],functions:[f,{...f,grantee:'b'}]};
 const row={snapshot:{roles:[],functions:expected.functions.map(x=>({...x,definition:null,_definition_id:12}))},definitions:{12:f.definition}};
 assert.equal(JSON.stringify(decodeAuthority(row)),JSON.stringify(expected));
 assert.deepEqual(decodeAuthority({snapshot:{functions:null},definitions:null}),{functions:null});
});
test('authority transport rejects missing, unused and malformed definition references',()=>{
 const {decodeAuthority}=require('../src/security/catalogMetadataTransport');
 const row=()=>({snapshot:{functions:[{definition:null,_definition_id:12}]},definitions:{12:'body'}});
 for(const change of [r=>delete r.definitions[12],r=>r.definitions[13]='unused',r=>r.definitions[12]=null,r=>delete r.snapshot.functions[0]._definition_id,r=>r.snapshot.functions[0]._definition_id='12',r=>r.snapshot.functions[0].definition='unexpected',r=>r.snapshot.functions=null,r=>r.snapshot.functions={}]){const r=row();change(r);assert.throws(()=>decodeAuthority(r),/AUTHORITY_SECURITY_SNAPSHOT_INVALID/);}
});
test('compact core still rejects noncanonical NOT NULL metadata',async()=>{
 const row={tables:[],columns:[],constraints:[['t','nn','n','UNSUPPORTED_NOT_NULL']],indexes:[],triggers:[],triggerFunctions:[],authoritySequence:[]};
 await assert.rejects(core.centralSchemaSnapshot({query:async()=>({rows:[row]})},{compact:true}),/UNSUPPORTED_NOT_NULL_CONSTRAINT/);
});

test('function references use an explicit JSON numeric type rather than PostgreSQL OID text',()=>{
 const {compactAuthoritySql}=require('../src/security/catalogMetadataTransport');
 assert.match(compactAuthoritySql(require('../src/security/authoritySecurityManifest').SQL),/p\.oid::bigint AS _definition_id/);
});
