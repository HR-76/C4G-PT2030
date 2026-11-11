'use strict';
const assert=require('node:assert/strict');
const original=require('../../../backend/test/support/admissionQueriesBaseline.json').authority;
const sql=original.replace('pg_get_functiondef(p.oid) definition,p.prosecdef security_definer','NULL::text AS definition,p.prosecdef security_definer,p.oid::bigint AS _definition_id')
 .replace(') AS snapshot',`) AS snapshot,(SELECT jsonb_object_agg(p.oid::text,pg_get_functiondef(p.oid)) FROM protected_functions p WHERE EXISTS(SELECT 1 FROM function_privileges a WHERE a.function_oid=p.oid)) AS definitions`);
function restore(row){
 const snapshot=row.snapshot;
 if(!snapshot)return snapshot;
 for(const f of snapshot.functions||[]){f.definition=row.definitions[String(f._definition_id)];delete f._definition_id;}
 return snapshot;
}
async function diagnose(pool){
 const core=require('../../../backend/src/security/centralSchemaManifest');const c=await pool.connect();try{
  await c.query('BEGIN READ ONLY');const expected=await core.centralSchemaSnapshot(c);
  const raw=(await c.query(sql)).rows[0],bytes=Buffer.byteLength(JSON.stringify(raw));
  assert.equal(JSON.stringify(restore(raw)),JSON.stringify(expected.authoritySecurity));
  const compressedClient={async query(text,args){if(text===original)return {rows:[{snapshot:restore((await c.query(sql,args)).rows[0])}]};return c.query(text,args);}};
  const samples=[];for(let i=0;i<12;i++)for(const arm of i%2?['B','A']:['A','B']){
   const start=performance.now();const actual=await core.centralSchemaSnapshot(arm==='A'?c:compressedClient);assert.equal(JSON.stringify(actual),JSON.stringify(expected));samples.push({arm,executionMs:performance.now()-start});
  }
  return {component:'completeCore',variant:'compactAuthorityDefinitions',identical:true,legacyAuthorityBytes:Buffer.byteLength(JSON.stringify(expected.authoritySecurity)),compactAuthorityBytes:bytes,coreBytes:Buffer.byteLength(JSON.stringify(expected)),samples};
 }finally{await c.query('ROLLBACK');c.release();}
}
module.exports={sql,restore,diagnose};
