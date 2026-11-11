'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),express=require('express');
const {createPrivateOpportunityRouter}=require('../src/routes/privateOpportunityRoutes');
test('client opportunity routes preserve reads but reject all catalog mutations despite old grants',async t=>{
 let writes=0;const pass=(_q,_s,n)=>n();const service={list:async()=>({items:[],permissions:{create:true}}),get:async()=>({snapshot:{title:'Historical'},permissions:{edit:true,archive:true}}),create:async()=>{writes++;},update:async()=>{writes++;},archive:async()=>{writes++;}};
 const app=express();app.use(express.json());app.use(createPrivateOpportunityRouter({express,service,authenticate:pass,organizationMiddleware:{requireServerSession:pass,resolveOrganizationContext:pass,requireOrganizationContext:pass}}));
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));t.after(()=>new Promise(r=>{server.close(r);server.closeAllConnections();}));
 const url='http://127.0.0.1:'+server.address().port;
 for(const [method,path] of [['POST','/'],['PUT','/id'],['POST','/id/archive']])assert.equal((await fetch(url+path,{method,headers:{'content-type':'application/json'},body:'{}'})).status,403);
 assert.equal(writes,0);assert.equal((await (await fetch(url)).json()).permissions.create,false);
 const detail=await(await fetch(url+'/id')).json();assert.equal(detail.snapshot.title,'Historical');assert.deepEqual(detail.permissions,{edit:false,archive:false});
});
