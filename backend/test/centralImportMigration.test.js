'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const m=require('../src/security/centralMigrationManifest'),pkg=require('../src/security/centralImportMigrationPackage');
const ledger=require('../src/opportunities/catalogRead/ledgerContract');
const rows=entries=>entries.map(e=>({version:e.version,checksum_sha256:e.acceptedChecksums[0],irreversible:e.irreversible}));
test('central import is explicit, additive, pinned and irreversible; catalog installer remains at 048',()=>{
 assert.equal(m.manifest.at(-1).version,'035_funding_source_resolution');
 assert.equal(m.catalogReadManifest.at(-1).version,pkg.CENTRAL_BASELINE);
 assert.equal(m.centralImportManifest.at(-1),pkg.entry);
 const migration=m.migrationSql(pkg.entry.version,'up');assert.equal(migration.checksum,pkg.entry.upChecksum);
 assert.throws(()=>m.migrationSql(pkg.entry.version,'down'),/irreversible/);
 assert.throws(()=>m.migrationSql(pkg.entry.version,'up',()=>migration.sql+'\n-- tamper'),/checksum mismatch/);
});
test('catalog admits exact 048 and 049 ledgers and rejects missing, duplicate, tampered and future rows',()=>{
 const before=rows(ledger.requirements),after=[...before,{version:pkg.entry.version,checksum_sha256:pkg.entry.upChecksum,irreversible:true}];
 ledger.assertLedgerRows(before);ledger.assertLedgerRows(after);
 for(const invalid of [after.slice(1),[...after,after.at(-1)],[...before,{...after.at(-1),checksum_sha256:'0'.repeat(64)}],[...after,{version:'050_unregistered',checksum_sha256:'a'.repeat(64),irreversible:true}]])assert.throws(()=>ledger.assertLedgerRows(invalid),/CATALOG_READ_LEDGER_DRIFT/);
});
test('unregistered central import package is rejected before a connection is opened',async()=>{
 await assert.rejects(require('../scripts/runCentralMigrations').applyRegisteredCentralImportPackage({connect(){assert.fail('connection forbidden')}},'unknown'),/CENTRAL_IMPORT_PACKAGE_NOT_REGISTERED/);
});
