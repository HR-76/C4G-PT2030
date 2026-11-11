'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const rows=require('./fixtures/tenant030HistoricalLedger.json');
const {isHistoricalOwnershipLedger}=require('../src/security/tenantHistoricalOwnership');
const {validateTenantLedger,manifest}=require('../src/security/tenantMigrationManifest');
const canonicalRow=entry=>({migration_id:entry.version,ordinal:entry.ordinal,checksum_sha256:entry.sqlChecksum,irreversible:entry.irreversible,resulting_fingerprint:entry.schemaFingerprint});

test('canonical historical baseline selection and appended 031 through 033 preserve the original ledger',()=>{
 for(const ordinal of [30,31,32,33]){
  const entries=Object.freeze(manifest.filter(entry=>entry.ordinal<=ordinal));
  const ledger=[...structuredClone(rows),...entries.filter(entry=>entry.ordinal>30).map(canonicalRow)];
  const before=JSON.stringify(ledger);
  assert.equal(validateTenantLedger(ledger,entries).currentVersion,entries.at(-1).version);
  assert.equal(validateTenantLedger(ledger).currentVersion,entries.at(-1).version);
  assert.equal(JSON.stringify(ledger),before);
 }
});
test('historical exception never accepts corrupted suffixes or alternate manifest entries',()=>{
 const ledger=[...structuredClone(rows),...manifest.filter(entry=>entry.ordinal>30).map(canonicalRow)];
 for(let i=30;i<ledger.length;i++)for(const field of ['migration_id','ordinal','checksum_sha256','irreversible','resulting_fingerprint']){
  const changed=structuredClone(ledger);changed[i][field]=field==='ordinal'?999:field==='irreversible'?!changed[i][field]:'0'.repeat(64);
  assert.throws(()=>validateTenantLedger(changed));
 }
 const changed=structuredClone(ledger);changed[5].resulting_fingerprint='0'.repeat(64);assert.throws(()=>validateTenantLedger(changed));
 const alternate=Object.freeze(manifest.map(entry=>Object.freeze({...entry})));assert.throws(()=>validateTenantLedger(ledger,alternate));
});
test('exact historical 030 ledger is admitted without mutating its evidence',()=>{
  const before=JSON.stringify(rows);
  assert.equal(isHistoricalOwnershipLedger(rows),true);
  assert.equal(validateTenantLedger(rows).currentVersion,'030_organization_notices');
  assert.equal(JSON.stringify(rows),before);
});
test('every row and historical field is pinned, including order and length',()=>{
  for(let i=0;i<rows.length;i++)for(const field of ['migration_id','ordinal','checksum_sha256','irreversible','resulting_fingerprint']){
    const changed=structuredClone(rows);
    changed[i][field]=field==='ordinal'?999:field==='irreversible'?!changed[i][field]:'0'.repeat(64);
    assert.equal(isHistoricalOwnershipLedger(changed),false);
    assert.throws(()=>validateTenantLedger(changed));
  }
  for(const changed of [rows.slice(1),rows.slice(0,-1),[...rows,rows.at(-1)],[...rows].reverse()]){
    assert.equal(isHistoricalOwnershipLedger(changed),false);
    assert.throws(()=>validateTenantLedger(changed));
  }
});
test('unknown or malformed historical baselines are not admitted',()=>{
  for(const value of [null,[],Array(30).fill(null)])assert.equal(isHistoricalOwnershipLedger(value),false);
});
