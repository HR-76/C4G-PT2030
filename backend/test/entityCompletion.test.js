'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto');
const {command}=require('../src/entityAdmission/completionService');
test('completion migration preserves the running lease invariant and removes only the old completion ban',()=>{
 const sql=require('../src/security/centralMigrationManifest').migrationSql('025_entity_admission_completion','up').sql;
 assert.match(sql,/DROP CONSTRAINT entity_admission_status_check1/);assert.doesNotMatch(sql,/DROP CONSTRAINT entity_admission_check;/);
 assert.match(sql,/PRIMARY KEY\(country,nif\)/);assert.match(sql,/CHECK\(\(status='COMPLETE'\)=\(phase='COMPLETE'\)\)/);
});
test('completion command accepts a saved revision only and rejects fields, bindings and roles',()=>{
 const value={expectedRevision:1,requestId:randomUUID()};assert.deepEqual(command(value),value);
 for(const extra of ['fields','organizationId','role','database','country'])assert.throws(()=>command({...value,[extra]:'forged'}));
 for(const revision of [0,-1,1.5,'1',null])assert.throws(()=>command({...value,expectedRevision:revision}));
});
test('limited boundary allows exact completion routes only when composed',async()=>{
 const {createAdmissionBoundary}=require('../src/entityAdmission/http'),id=randomUUID();
 async function check(path,method,enabled){return new Promise(resolve=>{const res={set(){return this},status(n){this.code=n;return this},json(){resolve(this.code)}};createAdmissionBoundary({service:{context:async()=>({limited:true}),...(enabled?{submit(){}}:{})},authenticate:(req,res,next)=>next()})({path,method,session:{auth:{}}},res,()=>resolve(200));});}
 assert.equal(await check(`/api/admissions/${id}/submit`,'POST',true),200);assert.equal(await check(`/api/admissions/${id}/status`,'GET',true),200);
 for(const [p,m] of [[`/api/admissions/${id}/submit`,'GET'],[`/api/admissions/${id}/status`,'POST'],[`/api/admissions/${id}/prepare`,'POST'],[`/api/admissions/${id}/status/extra`,'GET']])assert.equal(await check(p,m,true),403);
 assert.equal(await check(`/api/admissions/${id}/submit`,'POST',false),403);
});
test('durable worker isolates failed jobs and prevents overlapping local runs',async()=>{
 let release,started;const ready=new Promise(r=>started=r),hold=new Promise(r=>release=r),seen=[];
 const worker=require('../src/entityAdmission/completionWorker').createCompletionWorker({pending:async()=>['a','b'],prepare:async id=>{seen.push(id);if(id==='a'){started();await hold;throw Error('retry')}}});
 const first=worker.runOnce();await ready;assert.deepEqual(await worker.runOnce(),[]);release();assert.deepEqual(await first,[{id:'a',confirmed:false},{id:'b',confirmed:true}]);assert.deepEqual(seen,['a','b']);
});
