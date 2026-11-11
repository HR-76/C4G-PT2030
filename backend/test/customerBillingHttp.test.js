'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const express=require('express');
const {createCustomerBillingRouter}=require('../src/customerBilling/http');
test('customer HTTP routes authenticate, require organization and reject mutations and hostile shapes',async t=>{
  const calls=[],middleware=[];
  const pass=name=>(req,res,next)=>{middleware.push(name);next()};
  const app=express();app.use(express.json());
  app.use('/api/billing',createCustomerBillingRouter({express,service:{execute:async(...args)=>{calls.push(args);return {ok:true}}},authenticate:pass('auth'),organizationMiddleware:{requireServerSession:pass('session'),resolveOrganizationContext:pass('resolve'),requireOrganizationContext:pass('organization')}}));
  const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
  const root=`http://127.0.0.1:${server.address().port}/api/billing`;
  const response=await fetch(root+'/invoices?q=FT');assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'no-store');assert.deepEqual(middleware,['auth','session','resolve','organization']);assert.equal(calls[0][0],'list');
  for(const method of ['POST','PUT','DELETE','HEAD'])assert.equal((await fetch(root+'/invoices',{method})).status,405);
  for(const path of ['/summary?organizationId=other','/access?q=other','/invoices/id?x=1'])assert.equal((await fetch(root+path)).status,400);
  assert.equal(calls.length,1);
});
