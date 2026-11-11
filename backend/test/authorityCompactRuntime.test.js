'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const {createRequire}=require('node:module'),{createHash}=require('node:crypto');
const filename=path.join(__dirname,'../src/security/authoritySecurityManifest.js');
const realRequire=createRequire(filename),version='synthetic';
const snapshot={roles:[],functions:[{definition:'CREATE FUNCTION sample() RETURNS int',grantee:'PUBLIC'}]};
const fingerprint=createHash('sha256').update(JSON.stringify(snapshot)).digest('hex');
function load(){const module={exports:{}};const source=process.env.METADATA_REGRESSION_REFERENCE==='1'?path.join(__dirname,'../../test/integration/metadata-remediation/authority.before.cjs.txt'):filename;
 vm.runInNewContext(fs.readFileSync(source,'utf8'),{module,exports:module.exports,require(name){
 if(name==='./centralMigrationManifest')return {manifest:[{version}],knownManifest:[{version,authoritySecurityFingerprint:fingerprint}]};
 if(name==='./memberEmailAdmission')return {admits:()=>false};
 return realRequire(name);
}});return module.exports;}
test('runtime verification uses compact transport, restores exact fingerprint and observes subsequent drift',async()=>{
 const api=load();let calls=0,body=snapshot.functions[0].definition;
 const client={async query(sql){calls++;assert.match(sql,/AS definitions$/);
  return {rows:[{snapshot:{roles:[],functions:[{definition:null,grantee:'PUBLIC',_definition_id:123}]},definitions:{123:body}}]};}};
 assert.equal(JSON.stringify(await api.assertAuthoritySecurity(client,version)),JSON.stringify(snapshot));
 body='changed';await assert.rejects(api.assertAuthoritySecurity(client,version),{code:'AUTHORITY_SECURITY_DRIFT'});
 assert.equal(calls,2);
});
test('runtime refuses malformed compact definitions without a legacy fallback',async()=>{
 let calls=0;await assert.rejects(load().assertAuthoritySecurity({query:async()=>{calls++;return {rows:[{snapshot:{roles:[],functions:[{definition:null,_definition_id:123}]},definitions:{}}]};}},version),/AUTHORITY_SECURITY_SNAPSHOT_INVALID/);
 assert.equal(calls,1);
});
