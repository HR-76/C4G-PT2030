'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createOpportunityInterestRepository}=require('../src/opportunityInterests/repository');
const id=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
const org=id(1),actor={id:id(2),membershipId:id(3)};
const interest=n=>({organization_id:org,interest_id:id(100+n),central_opportunity_id:id(200+n),central_revision_id:id(300+n),central_snapshot:{title:'Aviso '+n},
 title:'Aviso '+n,notes:null,status:'ACTIVE',revision:1,transversal:true,created_by:actor.id,created_membership_id:actor.membershipId,created_at:new Date('2026-11-01T10:00:00Z'),updated_at:new Date('2026-11-01T10:00:00Z')});
function fixture(rows,options={}){
 const calls=[],state={reuses:0};
 const client={async query(sql){
  if(/FROM opportunity_catalog\.opportunity_interest i/.test(sql))return {rows};
  if(/FROM opportunity_catalog\.interest_unit/.test(sql))return {rows:[]};
  throw new Error('Unexpected SQL: '+sql.slice(0,90));
 }};
 const repository=createOpportunityInterestRepository({organizationId:org,actor,protect:async()=>({}),audit:async()=>{},
  cursor:{cursor:()=>'next',openCursor:()=>{throw new Error('no cursor expected');}},
  authorize:async(operation,target)=>{calls.push(`${operation}:${target.resourceType}:${target.id}`);return !(options.deny||[]).includes(target.id);},
  onDecisionReuse:()=>{state.reuses++;},...options.ports});
 return {client,repository,calls,state};
}
const count=(calls,prefix)=>calls.filter(call=>call.startsWith(prefix)).length;
test('a list read decides once the permissions that do not depend on the row',async()=>{
 const rows=[interest(1),interest(2),interest(3)];
 const {client,repository,calls,state}=fixture(rows,{ports:{reuseDecisions:true}});
 const result=await repository.list(client,{q:'',status:'ACTIVE',unitId:null,cursor:null});
 assert.equal(result.items.length,3);
 assert.ok(result.items.every(item=>item.capabilities.canManage&&item.capabilities.canCreateApplication&&item.capabilities.canRegister));
 assert.deepEqual(result.capabilities,{canRegister:true,canManage:true,canCreateApplication:true,canIncludeResponsibleInTeam:true});
 for(const operation of ['OPPORTUNITY_INTEREST_REGISTER','APPLICATION_CREATE','OPPORTUNITY_READ','APPLICATION_WORK_EDIT'])assert.equal(count(calls,operation+':'),1,operation);
 // What depends on the row is still asked for each row: reading it and managing it.
 for(const row of rows)assert.equal(calls.filter(call=>call.endsWith(':'+row.interest_id)).length,2,row.interest_id);
 assert.ok(state.reuses>0,'reused decisions pass through the current-authority check');
});
test('without reuse (writes) every question is asked again',async()=>{
 const rows=[interest(1),interest(2),interest(3)];
 const {client,repository,calls,state}=fixture(rows);
 await repository.list(client,{q:'',status:'ACTIVE',unitId:null,cursor:null});
 assert.equal(count(calls,'APPLICATION_CREATE:'),4);assert.equal(state.reuses,0);
});
test('a refusal of one interest does not leak into the others and a refused permission is reused as a refusal',async()=>{
 const rows=[interest(1),interest(2)];
 const {client,repository,calls}=fixture(rows,{deny:[rows[0].interest_id],ports:{reuseDecisions:true}});
 const result=await repository.list(client,{q:'',status:'ACTIVE',unitId:null,cursor:null});
 assert.deepEqual(result.items.map(item=>item.interestId),[rows[1].interest_id]);
 assert.equal(calls.filter(call=>call.endsWith(':'+rows[0].interest_id)).length,1);
});
