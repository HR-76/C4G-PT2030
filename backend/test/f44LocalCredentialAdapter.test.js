'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { bindingDigest, createLocalTenantCredentialAdapter } = require('../src/security/localTenantCredentialAdapter');
const { createTenantCredentialProvider } = require('../src/security/tenantCredentialProvider');
const { inspectReachable, staticSpecifiers, violations } = require('../../test/integration/f12/source-guard');

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const api = Object.freeze({ credentialRef:'synthetic.a.api.v1',tenantId:A,workload:'API',connectionVersion:1,database:'tenant_a',login:'probe_a_api' });
const worker = Object.freeze({ credentialRef:'synthetic.a.worker.v1',tenantId:A,workload:'WORKER',connectionVersion:1,database:'tenant_a',login:'probe_a_worker' });

function fakeConnection(identity) { return { identity, async query(){}, async end(){} }; }

test('local credential adapter resolves only the complete registered tuple', async () => {
  const opened=[];
  const provider=createTenantCredentialProvider(createLocalTenantCredentialAdapter({entries:[api,worker],connect:async identity=>{opened.push(identity);return fakeConnection(identity);}}));
  const lease=await provider.resolve({...api,correlationId:'exact'});
  assert.equal(lease.material.resolution.login,api.login);
  assert.equal(opened.length,1);
  await lease.dispose();
  for(const change of [
    {credentialRef:worker.credentialRef},{tenantId:B},{workload:'WORKER'},{connectionVersion:2}
  ]) await assert.rejects(provider.resolve({...api,...change,correlationId:'mismatch'}),error=>error.internalCode==='CREDENTIAL_UNAVAILABLE');
  assert.equal(opened.length,1);
});

test('local credential adapter refuses shared references and binding covers every non-secret field', () => {
  assert.throws(()=>createLocalTenantCredentialAdapter({entries:[api,{...worker,credentialRef:api.credentialRef}],connect:async()=>fakeConnection({})}),/shared/);
  const baseline=bindingDigest(api);
  for(const change of [{credentialRef:'synthetic.changed'},{tenantId:B},{workload:'WORKER'},{connectionVersion:2},{database:'tenant_b'},{login:'other_login'}])assert.notEqual(bindingDigest({...api,...change}),baseline);
  assert.equal(baseline.includes('secret'),false);
});

test('source guard follows static local imports, cycles and rejects indirect migration bypasses', t => {
  const root=fs.mkdtempSync(path.join(__dirname,'c4g-f12-guard-'));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const write=(name,source)=>{const target=path.join(root,name);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,source);};
  write('entry.js',"require('./sub/helper'); require('./cycle-a');");
  write('cycle-a.js',"require('./cycle-b');");write('cycle-b.js',"require('./cycle-a');");
  write('sub/helper.js',"const fs=require('node:fs'); module.exports=()=>fs.promises.readFile('./migration.sql','utf8');");
  const inspected=inspectReachable(root,['entry.js']);
  assert.equal(inspected.graph.files.length,4);assert.ok(inspected.findings.some(value=>value.includes('unapproved file read')));
  const negatives=[
    "installSchemaVersion(client)",
    "import('./migration-loader.js')",
    "import(target)",
    "migrationSql('005','up').sql",
    "client.query('CREATE FUNCTION hidden() RETURNS void LANGUAGE sql AS $$ SELECT 1 $$')",
    "client.query('UPDATE c4g_system.schema_migration SET ordinal=1')",
    "({fingerprint:process.argv[2]})",
    "({applied:scope})",
    "try { work() } catch(error) { if(error.message==='table does not exist') client.query('SELECT repair()') }"
  ];
  for(const source of negatives)assert.ok(violations(path.join(root,'helper.js'),source).length,source);
  assert.equal(violations(path.join(root,'safe.js'),"// client.query('CREATE TABLE ignored()')\nconst text='DROP TABLE ignored'; client.query('SELECT * FROM item WHERE id=$1',[id]);").length,0);
  assert.deepEqual(staticSpecifiers("import value from './value.js'; export * from './other.js';").found,['./value.js','./other.js']);
});
