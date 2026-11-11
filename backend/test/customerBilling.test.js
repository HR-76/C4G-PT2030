'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');
const {canRead,createCustomerBillingService}=require('../src/customerBilling/service');
const {customerDetail,filters,createCustomerBillingRepository,statements}=require('../src/customerBilling/repository');
const org=randomUUID(),other=randomUUID();
test('financial access requires this organization and admin or exact explicit grant',()=>{
  const snapshot={organizationId:org,profileCode:'ORG_ADMIN',grants:[]};
  assert.equal(canRead(snapshot,org),true);assert.equal(canRead(snapshot,other),false);
  for(const profileCode of ['FUNDING_MANAGER','CONTRIBUTOR','VIEWER','C4G_ADMIN'])assert.equal(canRead({...snapshot,profileCode},org),false);
  const grant={permission:'billing.read',scope:{type:'ORGANIZATION',id:org,organizationId:org}};
  assert.equal(canRead({...snapshot,profileCode:'VIEWER',grants:[grant]},org),true);
  for(const scope of [{type:'UNIT',id:org,organizationId:org},{type:'ORGANIZATION',id:other,organizationId:org},{type:'ORGANIZATION',id:org,organizationId:other}])assert.equal(canRead({...snapshot,profileCode:'VIEWER',grants:[{...grant,scope}]},org),false);
  assert.equal(canRead({...snapshot,profileCode:'VIEWER',grants:[{...grant,resourceId:org}]},org),false);
});
test('customer payload excludes internal notes, authors, source references and commands',()=>{
  const result=customerDetail({cycleId:randomUUID(),cycleNotes:'SECRET',timeline:[{actorId:'SECRET'}],allowedActions:{recordPayment:true},accountSnapshot:{legalName:'Client',notes:'SECRET',externalCustomerRef:'SECRET'},documents:[{id:'d',number:'FT 1',externalDocumentId:'SECRET',allowedActions:{cancel:true}}],payments:[{id:'p',effectiveOn:'2026-11-01',createdAt:'2026-11-02T10:00:00Z',note:'SECRET',createdBy:'SECRET'}]});
  assert.ok(!JSON.stringify(result).includes('SECRET'));assert.equal(result.payments[0].effectiveOn,'2026-11-01');assert.equal(result.payments[0].createdAt,'2026-11-02T10:00:00Z');
  assert.equal(result.origin,'MANUAL_C4G');assert.equal(Object.hasOwn(result.documents[0],'pdfAvailable'),false);
});
test('client cannot choose organization or expose drafts through filters',()=>{
  for(const raw of [{organizationId:other},{cycleStatus:'DRAFT'},{page:'0'},{from:'2026-12-01',to:'2026-01-01'},{q:['x']},{currency:'xx'}])assert.throws(()=>filters(raw));
  assert.equal(filters({q:'FT',page:'2'}).page,2);
});
test('detail scope is checked before reading fiscal data',async()=>{
  let reads=0;const repo=createCustomerBillingRepository({billing:{cycleDetail(){reads++;}}});
  await assert.rejects(()=>repo.detail({query:async(sql,args)=>{assert.equal(sql,statements.visible);assert.equal(args[1],org);return {rows:[]}}},org,randomUUID(),'2026-11-06'),{code:'RESOURCE_NOT_AVAILABLE'});
  assert.equal(reads,0);
});
function harness({profile='ORG_ADMIN',revoke=false,header=org}={}){
  let resolved=0,reads=0;
  const actor={organizationId:org,membershipId:randomUUID()};
  const service=createCustomerBillingService({centralPool:{connect:async()=>({query:async()=>({rows:[]}),release(){}})},coordinator:{withAuthority:fn=>fn(),pool:{}},authority:{captureAuthenticatedRequest:async()=>({}),resolve:async()=>{resolved++;if(revoke&&resolved>1)throw Object.assign(new Error(),{code:'AUTHORITY_REQUIRED'});return {actor}}},authorizationDataPort:{load:async()=>({organizationId:org,profileCode:profile,grants:[]})},repository:{summary:async(_client,scope)=>{reads++;assert.equal(scope,org);return {currencies:[]}}}});
  return {run:method=>service.execute(method,{},null,{headers:{'x-c4g-organization':header}}),reads:()=>reads};
}
test('service denies ordinary members and header forgery before financial reads',async()=>{
  for(const setup of [{profile:'CONTRIBUTOR'},{header:other}]){const h=harness(setup);await assert.rejects(()=>h.run('summary'));assert.equal(h.reads(),0)}
});
test('revocation during a read discards the result',async()=>{
  const h=harness({revoke:true});await assert.rejects(()=>h.run('summary'),{code:'AUTHORITY_REQUIRED'});assert.equal(h.reads(),1);
});
test('authorized read returns scoped data and access probe has no financial reads',async()=>{
  const h=harness();assert.deepEqual(await h.run('summary'),{currencies:[]});
  const denied=harness({profile:'VIEWER'});assert.deepEqual(await denied.run('access'),{canRead:false});assert.equal(denied.reads(),0);
});
test('list uses bound organization and filters, deterministic pagination and scoped summary',async()=>{
  const calls=[];const repo=createCustomerBillingRepository();
  const client={query:async(sql,args)=>{calls.push([sql,args]);return {rows:sql===statements.count?[{total:26}]:[]}}};
  assert.deepEqual(await repo.list(client,org,{q:"' OR true --",page:'2'},'2026-11-06'),{items:[],total:26,page:2,pageSize:25,origin:'MANUAL_C4G'});
  assert.equal(calls[0][1][0],org);assert.equal(calls[1][1][7],25);assert.ok(!calls[0][0].includes("' OR true --"));
  await repo.summary(client,org,'2026-11-06');assert.deepEqual(calls[2][1],[org,'2026-11-06']);
});

test('Express query objects are accepted without weakening filter validation',()=>{
  const express=require('express');const app=express();const req=Object.create(app.request);
  req.url='/invoices?q=FT&page=2';
  assert.equal(filters(req.query).page,2);
  req.url='/invoices?q=x&q=y';assert.throws(()=>filters(req.query));
  req.url='/invoices?organizationId=other';assert.throws(()=>filters(req.query));
});
