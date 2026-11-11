'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {assertApplicationSnapshotFits}=require('../src/applications/opportunitySnapshot');
const {validateSnapshotV2}=require('../src/opportunities/v2');
const {parseArgs}=require('../../test/integration/opportunity-v2/gate.cjs');
function large(){const value=structuredClone(require('../../context/references/opportunity-v2/examples/eu-11145.json'));for(let n=0;n<20;n++)value.provenance.evidence.push({...value.provenance.evidence[0],id:'s6-large-'+n,excerpt:'x'.repeat(2000)});return validateSnapshotV2(value);}
test('S6 application storage expands only a validated v2 snapshot after server schema capability',()=>{
 const snapshot=large();assert.throws(()=>assertApplicationSnapshotFits(snapshot),{code:'SCHEMA_UPGRADE_REQUIRED'});
 assert.doesNotThrow(()=>assertApplicationSnapshotFits(snapshot,{v2:true}));
 assert.throws(()=>assertApplicationSnapshotFits({schemaVersion:1,title:'x'.repeat(40000)},{v2:true}),{code:'SCHEMA_UPGRADE_REQUIRED'});
 assert.throws(()=>assertApplicationSnapshotFits({...snapshot,extra:'x'.repeat(300000)},{v2:true}),{code:'SCHEMA_UPGRADE_REQUIRED'});
});
test('S6 disposable gate refuses endpoints and implicit activation arguments without side effects',()=>{
 for(const args of [[],['--production'],['--isolated','postgres://live'],['--isolated','--activate'],['--isolated','--temporal-only','extra']])assert.throws(()=>parseArgs(args));
 assert.deepEqual(parseArgs(['--isolated']),{temporalOnly:false,bootstrapOnly:false});
 assert.equal(parseArgs(['--isolated','--temporal-only']).temporalOnly,true);
});
module.exports={large};
