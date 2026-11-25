'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {archiveSynthetic} = require('../scripts/staging/archiveSyntheticPt2030');
function fixture({database='c4g_central_staging',state='ACTIVE',version=1,receipts=1}={}) {
  const calls=[];
  const row={title:'TESTE SINTÉTICO — STAGING — NÃO É UM AVISO REAL',current_revision_id:'8b81b819-9d3c-41fe-8b5c-510aa3a25c69',
    current_schema_version:2,lifecycle_state:state,row_version:version,archived_at:state==='ARCHIVED'?'2026-11-15':null};
  const client={release(){calls.push('release');},async query(sql) {
    calls.push(sql);
    if (sql.startsWith('SELECT current_database')) return {rows:[{name:database}]};
    if (sql.startsWith('SELECT o.*')) return {rows:[row]};
    if (sql.includes('count(*)')) return {rows:[{revisions:1,receipts,identities:1}]};
    return {rows:[],rowCount:1};
  }};
  return {calls,pool:{async connect(){return client;}},audit:async()=>{calls.push('audit');}};
}
test('dry run only reads the exact fixture',async()=>{
  const f=fixture();assert.equal((await archiveSynthetic(f.pool)).status,'READY_TO_ARCHIVE');
  assert.ok(f.calls.includes('BEGIN READ ONLY'));assert.equal(f.calls.some(s=>s.startsWith('UPDATE')),false);
});
test('archive audits before the update and preserves the revision and acceptance receipt',async()=>{
  const f=fixture();const result=await archiveSynthetic(f.pool,{apply:true,audit:f.audit});
  assert.equal(result.status,'ARCHIVED');assert.equal(result.revisions,1);assert.equal(result.receipts,1);
  assert.ok(f.calls.indexOf('audit')<f.calls.findIndex(s=>s.startsWith('UPDATE')));
  assert.ok(f.calls.includes('COMMIT'));assert.equal(f.calls.some(s=>/DELETE|UPDATE.*revision\b/.test(s)),false);
});
test('repeat performs no update or duplicate audit',async()=>{
  const f=fixture({state:'ARCHIVED',version:2});assert.equal((await archiveSynthetic(f.pool,{apply:true,audit:f.audit})).status,'ALREADY_ARCHIVED');
  assert.equal(f.calls.includes('audit'),false);assert.equal(f.calls.some(s=>s.startsWith('UPDATE')),false);
});
test('wrong database, changed version or missing history abort before mutation',async()=>{
  for(const options of [{database:'production'},{version:3},{receipts:0}]) {
    const f=fixture(options);await assert.rejects(archiveSynthetic(f.pool,{apply:true,audit:f.audit}));
    assert.ok(f.calls.includes('ROLLBACK'));assert.equal(f.calls.includes('audit'),false);assert.equal(f.calls.some(s=>s.startsWith('UPDATE')),false);
  }
});
test('audit failure rolls back before lifecycle change',async()=>{
  const f=fixture();await assert.rejects(archiveSynthetic(f.pool,{apply:true,audit:async()=>{throw Error('AUDIT_UNAVAILABLE');}}));
  assert.ok(f.calls.includes('ROLLBACK'));assert.equal(f.calls.some(s=>s.startsWith('UPDATE')),false);
});
