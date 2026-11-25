'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {memberWorkerEmailConfiguration}=require('../src/platformOnboarding/memberWorkerEmail');
const email={apiKey:'synthetic-private-api-key',from:'C4G <test@example.invalid>',origin:'https://app.example.invalid'};
test('private worker email uses exact declared credentials and never falls back to HTTP-process env',()=>{
 const result=memberWorkerEmailConfiguration({email},{PUBLIC_APP_URL:email.origin,RESEND_API_KEY:'wrong',ACTIVATION_EMAIL_FROM:'wrong',ACTIVATION_PUBLIC_URL:'wrong'});
 assert.deepEqual(result,email);assert.ok(Object.isFrozen(result));assert.notEqual(result,email);
});
test('absent private email preserves existing local and staging environment configuration',()=>{
 const env={RESEND_API_KEY:'legacy-key',ACTIVATION_EMAIL_FROM:'legacy@example.invalid',ACTIVATION_PUBLIC_URL:'https://localhost:8443'};
 assert.deepEqual(memberWorkerEmailConfiguration({},env),{apiKey:env.RESEND_API_KEY,from:env.ACTIVATION_EMAIL_FROM,origin:env.ACTIVATION_PUBLIC_URL});
 assert.deepEqual(memberWorkerEmailConfiguration({},{}),{apiKey:undefined,from:undefined,origin:undefined});
});
test('explicit malformed, foreign-origin or incomplete email refuses without leaking private input',()=>{
 for(const bad of [null,{},[],{...email,unknown:'synthetic-secret'}, {...email,apiKey:''},{...email,apiKey:'key\nforged'}, {...email,from:'test\r\nheader'}, {...email,origin:'http://app.example.invalid'}, {...email,origin:'https://other.example.invalid'}, {...email,origin:'https://app.example.invalid/path'}, {...email,origin:'https://secret@app.example.invalid'}])
  assert.throws(()=>memberWorkerEmailConfiguration({email:bad},{PUBLIC_APP_URL:email.origin}),error=>error.message==='MEMBER_EMAIL_CONFIGURATION_INVALID');
});
