'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto');
const {query}=require('../src/applications/contracts');
const {createApplicationRepository}=require('../src/applications/repository');
const org=randomUUID(),privateId=randomUUID(),centralId=randomUUID(),emptyId=randomUUID();
const id=i=>`00000000-0000-4000-8000-${String(i).padStart(12,'0')}`;
function repository(extra={}){return createApplicationRepository({organizationId:org,actor:{id:randomUUID()},protect:()=>{},authorize:()=>true,centralOrigin:()=>{},...extra})}
test('summary accepts 1–25 distinct UUIDs and rejects authority or malformed input',()=>{
 const ids=Array.from({length:25},()=>randomUUID());
 assert.deepEqual(query('opportunitySummaries',{opportunityIds:ids.join(',')}),{opportunityIds:ids});
 for(const input of [{},{opportunityIds:[]},{opportunityIds:''},{opportunityIds:'bad'},{opportunityIds:`${ids[0]},${ids[0]}`},{opportunityIds:[...ids,randomUUID()].join(',')},{opportunityIds:ids[0],organizationId:org}])assert.throws(()=>query('opportunitySummaries',input),{code:'INVALID_INPUT'});
});
test('summary completes all pages and counts only authorized private/central applications in the selected tenant',async()=>{
 const rows=Array.from({length:103},(_,i)=>({application_id:id(i+1),opportunity_id:i<101?privateId:null,central_opportunity_id:i<101?null:centralId,status:i===102?'PREPARATION':'INTENTION'}));
 const guards=[],checks=[];let queries=0;
 const repo=repository({protect:input=>guards.push(input),authorize:(op,target)=>{checks.push([op,target]);return target.id!==id(1)&&target.id!==id(102)}});
 const input={opportunityIds:[privateId,centralId,emptyId]};
 const result=await repo.opportunitySummaries({query:async(sql,params)=>{
  queries++;assert.match(sql,/WHERE organization_id=\$1/);assert.match(sql,/central_opportunity_id=ANY\(\$3::uuid\[\]\)/);
  assert.equal(params[0],org);assert.deepEqual(params[2],input.opportunityIds);
  return {rows:rows.filter(row=>!params[1]||row.application_id>params[1]).slice(0,100)};
 }},input);
 assert.equal(queries,2);assert.equal(guards[0].operationCode,'APPLICATION_READ');assert.equal(guards[0].additionalAuthorizations.length,0);
 assert(checks.every(([,target])=>target.organizationId===org));
 assert.deepEqual(result.items,[{opportunityId:privateId,count:100,statuses:{IDENTIFIED:100},applicationId:null},
  {opportunityId:centralId,count:1,statuses:{PREPARATION:1},applicationId:id(103)},
  {opportunityId:emptyId,count:0,statuses:{},applicationId:null}]);
});
test('refused authority and incomplete scans fail instead of reporting no applications',async()=>{
 let reads=0;
 await assert.rejects(repository({protect:()=>{throw Object.assign(new Error(),{code:'NOT_AUTHORIZED'})}}).opportunitySummaries({query:()=>{reads++}},{opportunityIds:[privateId]}),{code:'NOT_AUTHORIZED'});
 assert.equal(reads,0);
 await assert.rejects(repository({authorize:()=>false}).opportunitySummaries({query:async()=>({rows:Array.from({length:100},(_,i)=>({application_id:id(++reads),opportunity_id:privateId,status:'INTENTION'}))})},{opportunityIds:[privateId]}),{code:'LIMIT_EXCEEDED'});
 assert.equal(reads,10000);
 await assert.rejects(repository().opportunitySummaries({query:async()=>{throw new Error('offline')}},{opportunityIds:[privateId]}),/offline/);
});
test('private-only composition never queries optional central columns',async()=>{
 await repository({centralOrigin:null}).opportunitySummaries({query:async(sql)=>{assert.doesNotMatch(sql,/central_opportunity_id/);return{rows:[]}}},{opportunityIds:[privateId]});
});
test('mixed opportunity selections return zero for inaccessible applications without opening their sources',async()=>{
 const checked=[];const repo=repository({authorize:(operation,target)=>{checked.push([operation,target.id]);return operation==='APPLICATION_READ'||target.id===privateId}});
 const rows=[{application_id:id(201),opportunity_id:privateId,status:'INTENTION'},{application_id:id(202),opportunity_id:emptyId,status:'INTENTION'}];
 const result=await repo.opportunitySummaries({query:async()=>({rows})},{opportunityIds:[privateId,emptyId]});
 assert.deepEqual(result.items.map(r=>r.count),[1,0]);assert(checked.some(([op,target])=>op==='OPPORTUNITY_READ'&&target===emptyId));
});
