'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {requirements,assertLedgerRows,verifyLedgerArtifact}=require('../src/opportunities/catalogRead/ledgerContract');
const base=require('../src/security/centralMigrationManifest');
const valid=()=>requirements.map(e=>({version:e.version,checksum_sha256:e.acceptedChecksums[0],irreversible:e.irreversible}));
test('ledger expectations are deeply immutable and every supplied database ledger is validated afresh',()=>{
 assert(Object.isFrozen(requirements));assert(Object.isFrozen(requirements[0]));assert(Object.isFrozen(requirements[0].acceptedChecksums));
 assertLedgerRows(valid());
 for(const change of [a=>a.pop(),a=>a.push(a[0]),a=>a[0].version='unknown',a=>a[0].checksum_sha256='0'.repeat(64),a=>a[0].irreversible=!a[0].irreversible]){
  const rows=valid();change(rows);assert.throws(()=>assertLedgerRows(rows),/CATALOG_READ_LEDGER_DRIFT/);
 }
 assertLedgerRows(valid());
});
test('startup artifact verification rejects changed SQL checksums and changed membership of the package',()=>{
 verifyLedgerArtifact();
 assert.throws(()=>verifyLedgerArtifact({load:version=>({...base.migrationSql(version,'up'),acceptedChecksums:['0'.repeat(64)]})}),/CATALOG_LEDGER_ARTIFACT_MISMATCH/);
 assert.throws(()=>verifyLedgerArtifact({entries:base.knownManifest.slice(1)}),/CATALOG_LEDGER_ARTIFACT_MISMATCH/);
});
test('historical CRLF acceptance remains exactly the pinned set',()=>{
 const rows=valid();const index=requirements.findIndex(e=>e.acceptedChecksums.length>1);assert(index>=0);rows[index].checksum_sha256=requirements[index].acceptedChecksums[1];assertLedgerRows(rows);
});
