'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
test('F4 runtime metadata restores the session login with RESET ROLE and verifies it',()=>{
 const source=fs.readFileSync(path.resolve(__dirname,'../src/security/tenantRuntimeMetadata.js'),'utf8');
 assert.match(source,/await client\.query\('RESET ROLE'\)/);
 assert.match(source,/restored!==previous/);
 assert.doesNotMatch(source,/SET LOCAL ROLE "\$\{previous\}"/);
});
