'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),{randomBytes,randomUUID}=require('node:crypto');
const {createEditorialUiTokens}=require('../src/organizationalProfile/editorialUiTokens');
const {createPq1UiTokens}=require('../src/organizationalProfile/pq1UiTokens');

for(const [name,create] of [['editorial',createEditorialUiTokens],['pq1',createPq1UiTokens]]){
 test(`${name}: independent clocks reject future issue and expiry exactly`,()=>{
  const issued=1800000000000;let readerTime=issued;
  const keys={test:randomBytes(32).toString('hex')};
  const writer=create({keys,currentKeyId:'test',clock:()=>issued});
  const reader=create({keys,currentKeyId:'test',clock:()=>readerTime});
  const binding={subjectId:randomUUID(),organizationId:randomUUID(),resourceId:randomUUID(),operation:'APPROVE',expectedDigest:randomBytes(32).toString('hex')};
  const token=writer.issue(binding).concurrencyToken;
  readerTime=issued-1000;assert.throws(()=>reader.verify(token,binding),{code:'CONCURRENCY_TOKEN_INVALID'});
  readerTime=issued;reader.verify(token,binding);
  readerTime=issued+299000;reader.verify(token,binding);
  readerTime=issued+300000;assert.throws(()=>reader.verify(token,binding),{code:'CONCURRENCY_TOKEN_EXPIRED'});
 });
}
