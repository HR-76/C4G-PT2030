'use strict';
const assert=require('node:assert/strict');
const original=require('../../../backend/test/support/admissionQueriesBaseline.json').core;
const authority=require('./authority-compact-experiment.cjs');
const keys={tables:['table_name'],columns:['table_name','ordinal','column_name','data_type','not_null','identity_kind','generated_kind','default_expression'],constraints:['table_name','constraint_name','constraint_type','definition'],indexes:['table_name','index_name','definition'],triggers:['table_name','trigger_name','definition'],triggerFunctions:['function_schema','function_name','identity_arguments','language','definition','volatility','is_strict','security_definer','parallel_safety','configuration'],authoritySequence:['seqstart','seqincrement','seqmin','seqmax','seqcache','seqcycle']};
let index=0;const layouts=Object.values(keys);
const sql=original.replace(/json_agg\(catalog_row\)/g,()=>`json_agg(json_build_array(${layouts[index++].map(k=>'catalog_row.'+k).join(',')}))`);assert.equal(index,7);
function restore(row){return Object.fromEntries(Object.entries(keys).map(([field,names])=>[field,row[field].map(values=>Object.fromEntries(names.map((name,i)=>[name,values[i]])))]));}
async function diagnose(pool){
 const core=require('../../../backend/src/security/centralSchemaManifest'),authorityOriginal=require('../../../backend/test/support/admissionQueriesBaseline.json').authority;
 const c=await pool.connect();try{
  await c.query('BEGIN READ ONLY');const expected=await core.centralSchemaSnapshot(c);
  const before=(await c.query(original)).rows[0],after=(await c.query(sql)).rows[0];assert.equal(JSON.stringify(restore(after)),JSON.stringify(before));
  const compact={async query(text,args){if(text===original)return {rows:[restore((await c.query(sql,args)).rows[0])]};if(text===authorityOriginal)return {rows:[{snapshot:authority.restore((await c.query(authority.sql,args)).rows[0])}]};return c.query(text,args);}};
  const samples=[];for(let i=0;i<12;i++)for(const arm of i%2?['B','A']:['A','B']){
   const start=performance.now();const actual=await core.centralSchemaSnapshot(arm==='A'?c:compact);assert.equal(JSON.stringify(actual),JSON.stringify(expected));samples.push({arm,executionMs:performance.now()-start});
  }
  return {component:'completeCore',variant:'compactRowsAndAuthority',identical:true,legacyCatalogBytes:Buffer.byteLength(JSON.stringify(before)),compactCatalogBytes:Buffer.byteLength(JSON.stringify(after)),samples};
 }finally{await c.query('ROLLBACK');c.release();}
}
module.exports={sql,restore,keys,diagnose};
