'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {parse,read}=require('../src/applications/myWork');
const {compileReadAuthority}=require('../src/applications/readAuthority');
const {validateProductionAuthorizationBootstrap}=require('../src/authorization/productionAuthorization');
const {createPq1UiTokens}=require('../src/organizationalProfile/pq1UiTokens');
const id=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
function fixture(){
 const actor={type:'HUMAN',id:id(1),organizationId:id(2),membershipId:id(3),membershipVersion:1,authorizationVersion:1};
 const args={catalogs:validateProductionAuthorizationBootstrap(),policyVersion:'test',recentMfaRequirement:{mfa:false,maxAgeSeconds:300},context:{actor},membership:{id:id(3),globalUserId:id(1),organizationId:id(2),membershipVersion:1,status:'ACTIVE',validUntil:Infinity},snapshot:{organizationId:id(2),membershipVersion:1,authorizationVersion:1,profileCode:'CONTRIBUTOR',grants:[],sodRules:[],supportGrant:null},now:new Date('2026-11-11T12:00:00Z'),includeWork:true};
 const authority=compileReadAuthority(args),calls=[];
 const rows=Array.from({length:26},(_,i)=>({task_id:id(100+i),application_id:id(4+i%2),application_title:'Candidatura',title:'Tarefa '+i,deadline:'2026-11-11',status:'OPEN',bucket:'today'}));
 let digest='first';
 const options={organizationId:id(2),actor,authority,clock:{now:()=>args.now},cursor:createPq1UiTokens({keys:{test:'x'.repeat(32)},currentKeyId:'test'})};
 const client={async query(sql,params){calls.push({sql,params});return {rows:[{items:params[20]?rows.slice(25):rows,total:26,counts:{today:26},digest}]}}};
 return {args,options,client,calls,revoke:()=>{digest='revoked'}};
}
test('strict query accepts filters but rejects client identity, arrays and invalid states',()=>{
 assert.deepEqual(parse({}),{q:'',applicationQ:'',status:'OPEN',period:'all',cursor:null});
 for(const input of [{membershipId:id(8)},{organizationId:id(2)},{q:['x']},{status:'unknown'},{period:'yesterday'},{cursor:[]}])assert.throws(()=>parse(input));
});
test('compiled work authority retains team restriction and source requirements; expired membership fails closed',()=>{
 const f=fixture(),a=f.options.authority;
 assert.equal(a.teamOnly,true);assert.equal(a.membershipId,id(3));assert.equal(a.work.all,true);assert.equal(a.opportunity.all,true);
 f.args.membership.validUntil=0;assert.throws(()=>compileReadAuthority(f.args));
});
test('SQL scopes tenant, participation, app/work and sources before assignment, filters and pagination',async()=>{
 const f=fixture();const result=await read(f.client,f.options,parse({q:' orçamento ',applicationQ:'energia'}));
 const {sql,params}=f.calls[0];
 for(const pattern of [/a.organization_id=\$1/,/p.membership_id=\$3 AND p.active/,/a.application_id=ANY\(\$5::uuid\[\]\)/,/a.opportunity_id,a.organization_id\)=ANY\(\$7::uuid\[\]\)/,/a.evaluation_id=ANY\(\$9::uuid\[\]\)/,/a.application_id=ANY\(\$14::uuid\[\]\)/,/t.responsible_membership_id=\$15::uuid/,/t.organization_id=a.organization_id/,/ORDER BY deadline,task_id LIMIT 26/])assert.match(sql,pattern);
 assert.equal(params[14],id(3));assert.notEqual(params[14],id(1));assert.equal(params[15],'orçamento');assert.equal(params[16],'energia');
 assert.equal(result.items.length,25);assert.equal(result.total,26);assert.equal(result.counts.today,26);assert.equal(result.today,'2026-11-11');
 const next=await read(f.client,f.options,parse({q:'orçamento',applicationQ:'energia',cursor:result.nextCursor}));assert.equal(next.items.length,1);assert.equal(next.nextCursor,null);
});
test('cursor cannot cross user, organization, filter, authority or revoked result set',async()=>{
 const f=fixture(),page=await read(f.client,f.options,parse({})),input=parse({cursor:page.nextCursor});
 for(const options of [{...f.options,organizationId:id(9)},{...f.options,actor:{...f.options.actor,id:id(9)}},{...f.options,authority:{...f.options.authority,version:[2,2]}}])await assert.rejects(read(f.client,options,input));
 await assert.rejects(read(f.client,f.options,{...input,status:'COMPLETED'}));
 f.revoke();await assert.rejects(read(f.client,f.options,input),{code:'INVALID_CURSOR'});
});
test('missing membership fails before any tenant query; Lisbon day handles UTC midnight boundary',async()=>{
 const f=fixture();await assert.rejects(read(f.client,{...f.options,actor:{...f.options.actor,membershipId:null}},parse({})));assert.equal(f.calls.length,0);
 f.args.now=new Date('2026-07-01T23:30:00Z');assert.equal((await read(f.client,f.options,parse({}))).today,'2026-07-02');
});
test('HTTP my-work uses the collection operation, strict filters and uncached organization authorization',async()=>{
 const express=require('express'),{createApplicationSliceRouter}=require('../src/routes/applicationSliceRoutes');
 const {APPLICATION_OPERATIONS}=require('../src/applications/composition');
 assert.deepEqual(APPLICATION_OPERATIONS.workMine,{code:'APPLICATION_WORK_READ',access:'read'});
 const app=express(),next=(_req,_res,n)=>n(),calls=[];let allowed=true;
 app.use('/applications',createApplicationSliceRouter({express,authenticate:next,organizationMiddleware:{requireServerSession:next,resolveOrganizationContext:next,requireOrganizationContext(req,res,n){if(allowed)n();else res.status(403).end();}},service:{async execute(method,raw,applicationId){calls.push({method,applicationId});parse(raw);return {items:[],total:0,counts:{},nextCursor:null};}}}));
 const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
 try{
  const root=`http://127.0.0.1:${server.address().port}/applications/my-work`;
  const response=await fetch(root+'?status=OPEN');assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'no-store');assert.equal((await response.json()).total,0);
  assert.deepEqual(calls,[{method:'workMine',applicationId:undefined}]);
  assert.equal((await fetch(root+'?membershipId='+id(9))).status,400);
  allowed=false;const before=calls.length;assert.equal((await fetch(root)).status,403);assert.equal(calls.length,before);
 }finally{await new Promise(resolve=>server.close(resolve));}
});
