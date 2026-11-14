'use strict';
const base=require('../../security/centralMigrationManifest');
const candidate=require('./readPackage.schema.json');
const requirements=Object.freeze(require('./ledgerContract.json').map(e=>Object.freeze({...e,acceptedChecksums:Object.freeze([...e.acceptedChecksums])})));
// Immutable executable-package expectations, not a cached admission decision.
// Verify source files once when this runtime artifact is loaded. The migration
// installer still reads and validates SQL for every actual migration execution.
function verifyLedgerArtifact({entries=base.prearchiveManifest,load=v=>base.migrationSql(v,'up')}={}){
 const observed=[...entries.map(e=>({version:e.version,irreversible:e.irreversible,acceptedChecksums:load(e.version).acceptedChecksums})),...candidate.entries.map(e=>({version:e.version,irreversible:e.irreversible,acceptedChecksums:[e.upChecksum]}))];
 if(JSON.stringify(observed)!==JSON.stringify(requirements))throw Error('CATALOG_LEDGER_ARTIFACT_MISMATCH');
}
verifyLedgerArtifact();
function assertLedgerRows(rows){
 const addition=require('../../security/centralImportMigrationPackage').entry;
 let expected=rows?.some(r=>r.version===addition.version)?[...requirements,{version:addition.version,irreversible:true,acceptedChecksums:[addition.upChecksum]}]:requirements;

 const pdf=require('../../security/billingPdfMigrationPackage').entry;
 if(rows?.some(r=>r.version===pdf.version)){if(!rows.some(r=>r.version===addition.version))throw Error('CATALOG_READ_LEDGER_DRIFT');expected=[...expected,{version:pdf.version,irreversible:true,acceptedChecksums:[pdf.upChecksum]}];}
 const email=require('../../security/emailTemplateMigrationPackage').entry;
 if(rows?.some(r=>r.version===email.version)){if(!rows.some(r=>r.version===pdf.version))throw Error('CATALOG_READ_LEDGER_DRIFT');expected=[...expected,{version:email.version,irreversible:true,acceptedChecksums:[email.upChecksum]}];}
 const runtimeRead=require('../../security/centralRuntimeReadPackage').entry;
 if(rows?.some(r=>r.version===runtimeRead.version)){if(!rows.some(r=>r.version===email.version))throw Error('CATALOG_READ_LEDGER_DRIFT');expected=[...expected,{version:runtimeRead.version,irreversible:false,acceptedChecksums:[runtimeRead.upChecksum]}];}
 if(!Array.isArray(rows)||rows.length!==expected.length)throw Error('CATALOG_READ_LEDGER_DRIFT');
 const records=new Map(rows.map(r=>[r.version,r]));
 if(records.size!==expected.length||expected.some(e=>{const r=records.get(e.version);return !r||!e.acceptedChecksums.includes(r.checksum_sha256)||r.irreversible!==e.irreversible;}))throw Error('CATALOG_READ_LEDGER_DRIFT');
}
module.exports={requirements,assertLedgerRows,verifyLedgerArtifact};
