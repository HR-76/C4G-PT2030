'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto');
const {input}=require('../src/entityAdmission/service');
const {createAdmissionBoundary}=require('../src/entityAdmission/http');
test('admission error boundary preserves CSRF rejection without exposing details',()=>{
 const handler=require('../src/app').createErrorHandler({nodeEnv:'development'});
 const res={status(n){this.code=n;return this;},set(){return this;},json(body){this.body=body;return this;}};
 handler({code:'CSRF_INVALID',statusCode:403,message:'private'}, {originalUrl:'/api/admin/directory/admissions'},res,()=>{});
 assert.equal(res.code,403);assert.deepEqual(res.body,{error:{code:'CSRF_INVALID'}});
});
test('admission router preserves anonymous OIDC entry and protects its own endpoints',async t=>{
 const express=require('express'),app=express();
 app.use('/api',require('../src/entityAdmission/http').createAdmissionRoutes({express,service:{},authenticate:(req,res)=>res.sendStatus(401)}));
 app.get('/api/auth/oidc/login',(req,res)=>res.sendStatus(200));
 const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
 const origin='http://127.0.0.1:'+server.address().port;
 assert.equal((await fetch(origin+'/api/auth/oidc/login')).status,200);
 assert.equal((await fetch(origin+'/api/admissions/mine')).status,401);
 assert.equal((await fetch(origin+'/api/admin/directory/admissions',{method:'POST'})).status,401);
});
test('invitation contract excludes tenant, roles and public registration fields',()=>{
 const value={name:' Pessoa ',email:'PERSON@example.invalid',requestId:randomUUID()};assert.equal(input(value).adminEmail,'person@example.invalid');assert.equal(input(value).adminName,'Pessoa');
 for(const changed of [{...value,role:'C4G_ADMIN'},{...value,organizationId:randomUUID()},{...value,name:'\n'},{...value,email:'invalid'}])assert.throws(()=>input(changed));
});
async function check(path,method,context,failed=false){
 return new Promise(resolve=>{
  const res={statusCode:200,status(n){this.statusCode=n;return this;},set(){return this;},json(body){resolve({status:this.statusCode,body});}};
  const boundary=createAdmissionBoundary({service:{context:async()=>{if(failed)throw Error();return context;}},authenticate:(req,res,next)=>next()});
  boundary({path,method,session:{auth:{user:{id:randomUUID()}}}},res,()=>resolve({status:200}));
 });
}
test('limited session uses method/path allowlist; new and disguised routes denied',async()=>{
 for(const [path,method] of [['/api/central-opportunities','GET'],['/api/admin/directory/entities','GET'],['/api/admissions/mine/../other','GET'],['/api/admissions/mine','POST'],['/api/new-service','GET']])assert.equal((await check(path,method,{limited:true})).status,403);
 for(const path of ['/api/admissions/mine','/api/auth/session','/api/auth/account-security'])assert.equal((await check(path,'GET',{limited:true})).status,200);
});
test('existing membership remains governed by original routes; authority failures deny',async()=>{
 assert.equal((await check('/api/central-opportunities','GET',{limited:false})).status,200);
 assert.equal((await check('/api/central-opportunities','GET',null,true)).status,503);
 assert.equal((await check('/api/auth/logout','POST',null,true)).status,200);
});
test('admission identity adapter rejects membership bindings and preserves existing account',async()=>{
 const {createKeycloakAdapter}=require('../src/platformOnboarding/keycloakAdapter');const subject=randomUUID();let writes=0;
 const adapter=createKeycloakAdapter({issuer:'https://identity.example.invalid/realms/c4g',purpose:'ADMISSION',accessToken:async()=>'synthetic',ownershipKey:'x'.repeat(32),fetchImpl:async(url,opts)=>{if(opts.method!=='GET')writes++;return {ok:true,status:200,headers:{get:()=>null},json:async()=>({id:subject,enabled:true})};}});
 const x={purpose:'ADMISSION',operationId:randomUUID(),globalUserId:randomUUID(),input:{expectedSubject:subject}};
 const result=await adapter.ensure(x);assert.equal(result.purpose,'ADMISSION');assert.equal(result.organizationId,undefined);assert.equal(writes,0);
 await assert.rejects(()=>adapter.ensure({...x,organizationId:randomUUID()}));await assert.rejects(()=>adapter.ensure({...x,purpose:'MEMBERSHIP'}));
});
