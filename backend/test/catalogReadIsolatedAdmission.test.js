'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createIsolatedAdmission,isIsolatedAdmission}=require('../src/opportunities/catalogRead/isolatedAdmission');
test('candidate admission requires an explicit isolated database and both dedicated logins',()=>{
 for(const config of [{},{isolated:true},{isolated:true,databaseName:'x',readerLogin:'x',authorityLogin:'x'}])assert.throws(()=>createIsolatedAdmission(config));
 const contract=createIsolatedAdmission({isolated:true,databaseName:'owned_test',readerLogin:'gcni_reader',authorityLogin:'gcni_member'});
 assert(isIsolatedAdmission(contract));assert(!isIsolatedAdmission({...contract}));assert(Object.isFrozen(contract));
});
test('candidate admission refuses a different database before schema inspection',async()=>{
 const contract=createIsolatedAdmission({isolated:true,databaseName:'owned_test',readerLogin:'gcni_reader',authorityLogin:'gcni_member'});
 await assert.rejects(contract.admit({query:async()=>({rows:[{database:'habitual',session_user:'c4g_authority_runtime',current_user:'c4g_authority_runtime'}]})}),/ISOLATED_DATABASE_REQUIRED/);
});
