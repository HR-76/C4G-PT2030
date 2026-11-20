'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {createDeletionIdentity}=require('../src/platformDirectory/deletionIdentity');
const issuer='https://identity.example.invalid/realms/c4g';
const subject='10000000-0000-4000-8000-000000000001';
function adapter(responses){const calls=[];return {calls,port:createDeletionIdentity({issuer,accessToken:async()=>'private',fetchImpl:async(url,options)=>{calls.push({url,options});const status=responses.shift();return {status,ok:status>=200&&status<300,json:async()=>({id:subject})};}})};}
test('deletes only an exact identity and verifies absence',async()=>{
 const {port,calls}=adapter([204,404]);
 assert.deepEqual(await port.remove({issuer,subject}),{issuer,subject,deleted:true});
 assert.deepEqual(calls.map(c=>c.options.method),['DELETE','GET']);
 assert.ok(calls.every(c=>c.url===issuer.replace('/realms/','/admin/realms/')+'/users/'+subject));
 assert.ok(calls.every(c=>c.options.redirect==='error'));
});
test('retries deletion after a lost response without adopting another identity',async()=>{
 const {port}=adapter([404,404]);assert.equal((await port.remove({issuer,subject})).deleted,true);
});
test('does not treat authorization or provider failure as deleted',async()=>{
 for(const status of [401,403,429,500]){const {port}=adapter([status]);await assert.rejects(port.remove({issuer,subject}),{code:'IDENTITY_DELETION_UNCONFIRMED'});}
 const {port}=adapter([204,200]);await assert.rejects(port.remove({issuer,subject}),{code:'IDENTITY_DELETION_UNCONFIRMED'});
});
test('rejects a different issuer and invalid subjects before sending requests',async()=>{
 const {port,calls}=adapter([]);
 for(const value of [{issuer:'https://other.invalid/realms/c4g',subject},{issuer,subject:'../admin'},{issuer,subject:''}])await assert.rejects(port.remove(value));
 assert.equal(calls.length,0);
});
