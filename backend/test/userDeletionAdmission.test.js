'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{createHash}=require('node:crypto');
const admission=require('../src/security/userDeletionAdmission');
test('admits only the measured 053 account deletion variant',()=>{
 for(const kind of ['schema','authority']){
  assert.equal(admission.admits(admission.version,kind,admission.fingerprints[kind]),true);
  assert.equal(admission.admits('052_central_runtime_read',kind,admission.fingerprints[kind]),false);
  assert.equal(admission.admits(admission.version,kind,'0'.repeat(64)),false);
 }
 assert.equal(admission.admits(admission.version,'arbitrary',undefined),false);
});
test('billing extension admits only the independently measured combined variant',()=>{
 const version='054_billing_account_validation';
 for(const kind of ['schema','authority']){
  assert.equal(admission.admits(version,kind,admission.later[version][kind]),true);
  assert.equal(admission.admits(version,kind,admission.fingerprints[kind]),false);
  assert.equal(admission.admits(admission.version,kind,admission.later[version][kind]),false);
  assert.equal(admission.admits('055_unknown',kind,admission.later[version][kind]),false);
  assert.equal(admission.admits(version,kind,'0'.repeat(64)),false);
 }
 assert.equal(admission.admits(version,'arbitrary',undefined),false);
});
test('candidate admits exactly the deletion statements with their hashes',()=>{
 const sql=fs.readFileSync(path.join(__dirname,'../database/central/candidates/platform_user_deletion.up.sql'),'utf8');
 const queries=Object.values(require('../src/platformDirectory/deletionSql'));
 for(const query of queries){const digest=createHash('sha256').update(query).digest('hex');assert.ok(sql.includes(`WHEN '${digest}' THEN statement:='${query.replaceAll("'","''")}';`));}
 assert.equal((sql.match(/ WHEN '[a-f0-9]{64}' THEN/g)||[]).length,queries.length);
});
