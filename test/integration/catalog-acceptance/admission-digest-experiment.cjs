'use strict';
const assert=require('node:assert/strict');
const baseline=require('../../../backend/test/support/admissionQueriesBaseline.json');
const canonical=`jsonb_build_object('tables',q.tables,'columns',q.columns,'constraints',
 (SELECT COALESCE(jsonb_agg(value ORDER BY ordinal),'[]'::jsonb)
 FROM json_array_elements(q.constraints) WITH ORDINALITY AS e(value,ordinal)
 WHERE value->>'constraint_type' IS DISTINCT FROM 'n'
 OR ((value->>'definition') ~ '^NOT NULL [a-z_][a-z_0-9]*$') IS NOT TRUE),'indexes',q.indexes)
 || CASE WHEN json_array_length(q."authoritySequence")>0 THEN jsonb_build_object('authoritySequence',q."authoritySequence",'authoritySecurity',q.authority_security) ELSE '{}'::jsonb END
 || CASE WHEN json_array_length(q.triggers)>0 THEN jsonb_build_object('triggers',q.triggers) ELSE '{}'::jsonb END
 || CASE WHEN json_array_length(q."triggerFunctions")>0 THEN jsonb_build_object('triggerFunctions',q."triggerFunctions") ELSE '{}'::jsonb END
 || CASE WHEN q.catalog_reader IS NOT NULL THEN jsonb_build_object('catalogReader',q.catalog_reader) ELSE '{}'::jsonb END`;
async function build(){let reader;const stop=Error('CAPTURE');try{await require('../../../backend/src/security/catalogReaderSecurity').catalogReaderSnapshot({query:async sql=>{reader=sql;throw stop;}});}catch(e){if(e!==stop)throw e;}
 const combined=baseline.core+",CASE WHEN EXISTS(SELECT 1 FROM pg_sequence WHERE seqrelid=to_regclass('public.authority_epoch_seq')) THEN ("+baseline.authority+") ELSE NULL END AS authority_security,("+reader+") AS catalog_reader";
 const snapshot='SELECT '+canonical+' AS snapshot FROM ('+combined+') q';
 return {snapshot,combined,sql:"SELECT encode(sha256(convert_to(snapshot::text,'UTF8')),'hex') AS digest FROM ("+snapshot+") canonical"};
}
async function buildCompact(){
 const {combined}=await build();
 const snapshot=`SELECT json_build_object('tables',q.tables,'columns',q.columns,'constraints',
 (SELECT COALESCE(json_agg(value ORDER BY ordinal),'[]'::json) FROM json_array_elements(q.constraints) WITH ORDINALITY AS e(value,ordinal)
 WHERE value->>'constraint_type' IS DISTINCT FROM 'n' OR ((value->>'definition') ~ '^NOT NULL [a-z_][a-z_0-9]*$') IS NOT TRUE),
 'indexes',q.indexes,'authoritySequence',q."authoritySequence",'authoritySecurity',q.authority_security,
 'triggers',q.triggers,'triggerFunctions',q."triggerFunctions",'catalogReader',q.catalog_reader) AS snapshot FROM (${combined}) q`;
 return {snapshot,sql:"SELECT encode(sha256(convert_to(snapshot::text,'UTF8')),'hex') AS digest FROM ("+snapshot+") canonical"};
}
async function diagnose(pool,compact=false){
 const core=require('../../../backend/src/security/centralSchemaManifest'),{snapshot,sql}=await (compact?buildCompact():build());
 const c=await pool.connect();try{
  await c.query('BEGIN READ ONLY');const expected=await core.centralSchemaSnapshot(c);
  assert.deepEqual((await c.query(snapshot,['c4g_catalog_reader'])).rows[0].snapshot,expected);
  const expectedDigest=(await c.query(sql,['c4g_catalog_reader'])).rows[0].digest;
  const samples=[];for(let i=0;i<12;i++)for(const arm of i%2?['B','A']:['A','B']){
   const start=performance.now();
   if(arm==='A')assert.equal(core.schemaFingerprint(await core.centralSchemaSnapshot(c)),core.schemaFingerprint(expected));
   else assert.equal((await c.query(sql,['c4g_catalog_reader'])).rows[0].digest,expectedDigest);
   samples.push({arm,executionMs:performance.now()-start});
  }
  return {component:'completeCore',variant:compact?'fixedShapeJsonDigest':'databaseDigest',identical:true,legacyFingerprint:core.schemaFingerprint(expected),expectedDigest,legacyBytes:Buffer.byteLength(JSON.stringify(expected)),digestBytes:64,samples};
 }finally{await c.query('ROLLBACK');c.release();}
}
module.exports={build,buildCompact,diagnose};
