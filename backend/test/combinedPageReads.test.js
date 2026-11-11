'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createAlertsRepository,parse}=require('../src/applications/alerts');
const {createApplicationRepository}=require('../src/applications/repository');
const {query}=require('../src/applications/contracts');
const org='00000000-0000-4000-8000-000000000001',member='00000000-0000-4000-8000-000000000002';
test('notification dependency only admits the exact sync/read pair on the same organization inbox',()=>{
 const allows=require('../src/security/notificationAuthorityDependencies').allowsNotificationReadDependency;
 const resource={id:org,organizationId:org,resourceType:'NOTIFICATION_INBOX'},item={operationCode:'NOTIFICATION_READ',resource},intent={operation:'NOTIFICATION_REFRESH_LIST'};
 assert(allows('NOTIFICATION_SYNC',intent,resource,item,org));
 for(const op of ['NOTIFICATION_READ','NOTIFICATION_ACK','APPLICATION_READ'])assert(!allows(op,intent,resource,item,org));
 for(const input of [null,{}, {operation:'OTHER'}])assert(!allows('NOTIFICATION_SYNC',input,resource,item,org));
 for(const input of [{...item,operationCode:'APPLICATION_READ'},{...item,resource:{...resource,id:member}},{...item,resource:{...resource,organizationId:member}},{...item,resource:{...resource,resourceType:'APPLICATION'}}])assert(!allows('NOTIFICATION_SYNC',intent,resource,input,org));
 assert(!allows('NOTIFICATION_SYNC',intent,{...resource,id:member},item,org));
 assert(!allows('NOTIFICATION_SYNC',intent,resource,item,member));
});
function alerts({deny=false,failRead=false,failAudit=false}={}){
 const calls=[],guards=[];
 const client={async query(sql){calls.push(sql);if(sql.includes('to_regclass'))return {rows:[{ready:true}]};
  if(sql.includes("a.status='PREPARATION'"))return {rows:[{application_id:org,title:'Due',days_left:1,closing_day:'2026-11-07'}]};
  if(sql.startsWith('INSERT'))return {rowCount:1,rows:[]};
  if(failRead&&sql.includes('SELECT n.alert_id'))throw Error('read failed');return {rows:[]};}};
 const repo=createAlertsRepository({organizationId:org,actor:{id:member,membershipId:member},protect:async value=>{guards.push(value);if(deny)throw Error('denied')},authorize:async()=>true,audit:async()=>{if(failAudit)throw Error('audit failed')}});
 return {repo,client,calls,guards};
}
test('combined alerts validate input and protect sync plus inbox read before generating once',async()=>{
 assert.deepEqual(parse('alertsRefreshList',{unread:true,limit:1}),{unread:true,limit:1});
 for(const input of [{organizationId:org},{limit:101},{unread:'1'}])assert.throws(()=>parse('alertsRefreshList',input));
 const f=alerts(),result=await f.repo.alertsRefreshList(f.client,null,{unread:true,limit:1});
 assert.equal(f.guards.length,1);assert.equal(f.guards[0].operationCode,'NOTIFICATION_SYNC');
 assert.equal(f.guards[0].intention.operation,'NOTIFICATION_REFRESH_LIST');
 assert.deepEqual(f.guards[0].additionalAuthorizations.map(a=>a.operationCode),['NOTIFICATION_READ']);
 assert.equal(f.guards[0].additionalAuthorizations[0].resource.id,org);
 assert.equal(f.calls.filter(s=>s.startsWith('INSERT')).length,1);
 assert.deepEqual(result,{notifications:[],unread_count:0,total:0,truncated:false});
});
for(const fault of ['deny','failRead','failAudit'])test(`combined alerts ${fault} returns no partial result`,async()=>{
 const f=alerts({[fault]:true});await assert.rejects(f.repo.alertsRefreshList(f.client,null,{unread:true,limit:1}));
 if(fault==='deny')assert.equal(f.calls.length,0);
});
test('combined browse keeps filters, authority and one guard for list and unit options',async()=>{
 const guards=[],calls=[];let broken=false;
 const client={async query(sql,values){calls.push({sql,values});if(sql.includes('to_regclass'))return {rows:[{available:true}]};
  if(sql.includes('SELECT s.scope_id')){if(broken)throw Error('units failed');return {rows:[{scope_id:member,label:'Unit',parent_scope_id:null,lifecycle:'ACTIVE'}]};}
  return {rows:[{total:0,items:[],counts:{},fingerprint:'same'}]};}};
 const repo=createApplicationRepository({organizationId:org,actor:{id:member},protect:async value=>guards.push(value),
  readAuthority:async()=>({teamOnly:true,membershipId:member,application:{all:false,ids:[org]},opportunity:{all:false,ids:[org]},evaluation:{all:false,ids:[]}}),
  responsibleDirectory:async()=>new Map(),transitionCapability:async()=>false,cursor:{cursor:()=>null}});
 const input=query('browsePage',{q:'solar',unitId:'NONE'}),result=await repo.browsePage(client,input);
 assert.equal(guards.length,1);assert.equal(result.total,0);assert.equal(result.units[0].unitId,member);
 assert(calls.some(c=>c.values?.includes('solar')));assert(calls.some(c=>c.sql.includes('JOIN visible')));
 broken=true;await assert.rejects(repo.browsePage(client,input),/units failed/);
});
