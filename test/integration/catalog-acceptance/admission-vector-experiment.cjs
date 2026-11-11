'use strict';
const assert=require('node:assert/strict');
const {createHash}=require('node:crypto');
const fs=require('node:fs'),path=require('node:path');
const baseline=require('../../../backend/test/support/admissionQueriesBaseline.json');
const fields=['tables','columns','constraints','indexes','triggers','triggerFunctions','authoritySequence','authority_security','catalog_reader'];
const sha=value=>createHash('sha256').update(value).digest('hex');
async function build(){let reader;const stop=Error('CAPTURE');try{await require('../../../backend/src/security/catalogReaderSecurity').catalogReaderSnapshot({query:async sql=>{reader=sql;throw stop;}});}catch(e){if(e!==stop)throw e;}
 const normalized=baseline.core.replace(') AS catalog_row) AS "constraints"',()=>`) AS catalog_row WHERE constraint_type IS DISTINCT FROM 'n' OR (definition COLLATE "C" ~ '^NOT NULL [a-z_][a-z_0-9]*$') IS NOT TRUE) AS "constraints"`);
 assert.notEqual(normalized,baseline.core);
 const combined=normalized+",CASE WHEN EXISTS(SELECT 1 FROM pg_sequence WHERE seqrelid=to_regclass('public.authority_epoch_seq')) THEN ("+baseline.authority+") ELSE NULL END AS authority_security,("+reader+") AS catalog_reader";
 const sql='SELECT '+fields.map(f=>`encode(sha256(convert_to(q."${f}"::text,'UTF8')),'hex') AS "${f}"`).join(',')+' FROM ('+combined+') q';
 return {sql,combined,fields};
}
async function diagnose(pool){
 const core=require('../../../backend/src/security/centralSchemaManifest'),{sql,combined}=await build();
 const c=await pool.connect();try{
  await c.query('BEGIN READ ONLY');const expected=await core.centralSchemaSnapshot(c);
  const raw=(await c.query(combined,['c4g_catalog_reader'])).rows[0];
  for(const f of fields)assert.deepEqual(raw[f],expected[({authority_security:'authoritySecurity',catalog_reader:'catalogReader'})[f]||f]);
  const expectedDigests=(await c.query(sql,['c4g_catalog_reader'])).rows[0];
  const samples=[];for(let i=0;i<12;i++)for(const arm of i%2?['B','A']:['A','B']){
   const start=performance.now();
   if(arm==='A')assert.equal(core.schemaFingerprint(await core.centralSchemaSnapshot(c)),core.schemaFingerprint(expected));
   else assert.deepEqual((await c.query(sql,['c4g_catalog_reader'])).rows[0],expectedDigests);
   samples.push({arm,executionMs:performance.now()-start});
  }
  const sources=['security/centralSchemaManifest.js','security/authoritySecurityManifest.js','security/catalogReaderSecurity.js','security/postgresCatalogCompatibility.js'];
  return {component:'completeCore',variant:'fieldDigests',identical:true,legacyFingerprint:core.schemaFingerprint(expected),authorityFingerprint:require('../../../backend/src/security/authoritySecurityManifest').digest(expected.authoritySecurity),expectedDigests,querySha256:sha(sql),sourceSha256:Object.fromEntries(sources.map(f=>[f,sha(fs.readFileSync(path.join(__dirname,'../../../backend/src',f)))])),legacyBytes:Buffer.byteLength(JSON.stringify(expected)),digestBytes:Buffer.byteLength(JSON.stringify(expectedDigests)),samples};
 }finally{await c.query('ROLLBACK');c.release();}
}
module.exports={build,diagnose};
