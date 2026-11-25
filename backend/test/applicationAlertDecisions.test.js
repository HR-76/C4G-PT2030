'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createAlertsRepository}=require('../src/applications/alerts');
const id=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
const org=id(1),membership=id(2),appA=id(10),appB=id(11),oppA=id(20),oppB=id(21);
const alert=(n,application,opportunity)=>({alert_id:id(100+n),application_id:application,type:'APPLICATION_STATUS_CHANGED',deadline:null,
 created_at:new Date(Date.UTC(2026,10,14,12,0,n)),read_at:null,application_title:'Candidatura',opportunity_id:opportunity,evaluation_id:null,status:'PREPARATION',current_deadline:null});
function fixture(rows,{deny=[],fail=null}={}){
 const calls=[],state={reuses:0};
 const client={async query(sql,values){
  if(/to_regclass\('opportunity_catalog\.application_alert'\)/.test(sql))return {rows:[{ready:true}]};
  if(/to_regclass\('opportunity_catalog\.organization_notice'\)/.test(sql))return {rows:[{ready:false}]};
  if(/FROM opportunity_catalog\.application_alert n JOIN opportunity_catalog\.application a/.test(sql))return {rows};
  if(/SELECT n\.alert_id,n\.title,n\.message/.test(sql))return {rows:rows.filter(row=>values[2].includes(row.alert_id)).map(row=>({alert_id:row.alert_id,title:'Título',message:'Mensagem'}))};
  throw new Error('Unexpected SQL: '+sql.slice(0,80));
 }};
 const repository=createAlertsRepository({organizationId:org,actor:{membershipId:membership},protect:async()=>({}),activeRecipients:async()=>[],audit:async()=>{},
  onDecisionReuse:()=>{state.reuses++;},
  authorize:async(operation,target)=>{calls.push(`${operation}:${target.id}`);if(fail===`${operation}:${target.id}`)throw Object.assign(Error('unavailable'),{code:'SERVICE_UNAVAILABLE'});return !deny.includes(target.id);}});
 return {client,repository,calls,state};
}
test('alerts of the same application are authorized once per operation and reused decisions are revalidated',async()=>{
 const rows=[alert(1,appA,oppA),alert(2,appA,oppA),alert(3,appA,oppA),alert(4,appB,oppB)];
 const {client,repository,calls,state}=fixture(rows);
 const result=await repository.alertsList(client,null,{unread:false,limit:100});
 assert.equal(result.notifications.length,4);assert.equal(result.unread_count,4);
 assert.deepEqual(calls.sort(),[`APPLICATION_READ:${appA}`,`APPLICATION_READ:${appB}`,`OPPORTUNITY_READ:${oppA}`,`OPPORTUNITY_READ:${oppB}`].sort());
 assert.equal(state.reuses,4,'every reused decision passes through the current-authority check');
});
test('a refusal applies to every alert of that application and hides only those',async()=>{
 const rows=[alert(1,appA,oppA),alert(2,appA,oppA),alert(3,appB,oppB)];
 const {client,repository,calls}=fixture(rows,{deny:[appA]});
 const result=await repository.alertsList(client,null,{unread:false,limit:100});
 assert.deepEqual(result.notifications.map(item=>item.related_application_id),[appB]);
 assert.equal(calls.filter(call=>call===`APPLICATION_READ:${appA}`).length,1);
 assert.ok(!calls.includes(`OPPORTUNITY_READ:${oppA}`),'the opportunity is not consulted after the application is refused');
});
test('an unavailable decision fails the read and is never kept as an answer',async()=>{
 const rows=[alert(1,appA,oppA),alert(2,appA,oppA)];
 const {client,repository,calls}=fixture(rows,{fail:`APPLICATION_READ:${appA}`});
 await assert.rejects(repository.alertsList(client,null,{unread:false,limit:100}),{code:'SERVICE_UNAVAILABLE'});
 await assert.rejects(repository.alertsList(client,null,{unread:false,limit:100}),{code:'SERVICE_UNAVAILABLE'});
 assert.equal(calls.length,2,'each attempt asks again');
});
test('without the reuse port the repository still authorizes once per application',async()=>{
 const rows=[alert(1,appA,oppA),alert(2,appA,oppA)];
 const calls=[];
 const {client}=fixture(rows);
 const repository=createAlertsRepository({organizationId:org,actor:{membershipId:membership},protect:async()=>({}),activeRecipients:async()=>[],audit:async()=>{},
  authorize:async(operation,target)=>{calls.push(`${operation}:${target.id}`);return true;}});
 assert.equal((await repository.alertsList(client,null,{unread:false,limit:100})).notifications.length,2);
 assert.equal(calls.length,2);
});
