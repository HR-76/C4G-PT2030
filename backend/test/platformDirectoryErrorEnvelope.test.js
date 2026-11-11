'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createPlatformDirectoryRouter}=require('../src/routes/platformDirectoryRoutes');
function fakeExpress(){const routers=[];return {routers,Router(){const routes=[];const r={routes,use(){return r},get(path,fn){routes.push(['get',path,fn]);return r},post(path,fn){routes.push(['post',path,fn]);return r},put(path,fn){routes.push(['put',path,fn]);return r}};routers.push(r);return r}}}
test('platform directory error preserves code and provides correlation id',async()=>{
 const express=fakeExpress(),error=Object.assign(new Error('private detail'),{code:'C4G_ADMIN_REQUIRED'}),router=createPlatformDirectoryRouter({express,service:{entities:async()=>{throw error}},authenticate(){}})
 const handler=router.routes.find(([method,path])=>method==='get'&&path==='/entities')[2];let status,body;const res={status(n){status=n;return this},json(value){body=value;return this}}
 await handler({query:{},body:{}},res);assert.equal(status,403);assert.equal(body.error.code,'C4G_ADMIN_REQUIRED');assert.match(body.correlationId,/^[0-9a-f-]{36}$/);assert(!JSON.stringify(body).includes('private detail'))
})


test('registration validation retains fields and request correlation',async()=>{
 const express=fakeExpress(),error=Object.assign(new Error('private'),{code:'REGISTRATION_FIELDS_INVALID',fields:{name:'required'}}),router=createPlatformDirectoryRouter({express,service:{entity:async()=>({})},registration:{saveForPlatform:async()=>{throw error}},authenticate(){}})
 const handler=router.routes.find(([method,path])=>method==='put'&&path==='/entities/:id/registration')[2];let status,body;const res={status(n){status=n;return this},json(value){body=value;return this}}
 const {runWithContext}=require('../src/observability/context');await runWithContext({correlationId:'01234567-89ab-4cde-8fab-0123456789ab'},()=>handler({params:{id:'entity'},query:{},body:{}},res));assert.equal(status,400);assert.deepEqual(body.error,{code:'REGISTRATION_FIELDS_INVALID',fields:{name:'required'}});assert.equal(body.correlationId,'01234567-89ab-4cde-8fab-0123456789ab')
})
