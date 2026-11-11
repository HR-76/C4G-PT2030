'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const gate=require('../../test/integration/opportunity-v2/registered-package-gate.cjs');
test('Registered migration gate requires explicit isolated package mode and refuses arbitrary targets',()=>{
 assert.doesNotThrow(()=>gate.parseArgs(['--isolated','--registered-package']));
 for(const args of [[],['--registered-package'],['--isolated'],['--isolated','--registered-package','--apply'],['--isolated','postgresql://localhost/example'],['--isolated','--registered-package','--database=live']])assert.throws(()=>gate.parseArgs(args),/REGISTERED_PACKAGE_EXPLICIT_ISOLATED_INVOCATION_REQUIRED/);
});
test('Registered gate baseline selection preserves manifest entries and cannot silently select a missing version',()=>{
 const {prefix}=require('../../test/integration/opportunity-v2/registered-package-proof.cjs');
 const entries=Object.freeze([Object.freeze({version:'baseline'}),Object.freeze({version:'registered'})]);
 const selected=prefix(entries,'baseline');assert.deepEqual(selected,[entries[0]]);assert(Object.isFrozen(selected));assert.equal(entries.length,2);assert.throws(()=>prefix(entries,'unknown'));
});
