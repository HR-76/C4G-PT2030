'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {listLogs}=require('../src/platformDirectory/logs');

test('platform logs use fixed pages of 15 after filters',async()=>{
 const calls=[];
 const client={async query(sql,values){
  calls.push({sql,values});
  if(sql.startsWith('SELECT count(*)'))return {rows:[{total:31}]};
  if(sql.startsWith('SELECT e.id'))return {rows:[{id:'event-16',code:'LOGIN'}]};
  return {rows:[{applied_at:'2026-10-18T09:00:00Z'}]};
 }};
 const result=await listLogs(client,{q:'Ana',type:'LOGIN',page:'2'},{status:()=>({failedEvents:0})});
 assert.equal(result.page,2);
 assert.equal(result.pageSize,15);
 assert.equal(result.total,31);
 assert.deepEqual(calls[1].values,['Ana','LOGIN',15,15]);
 assert.match(calls[1].sql,/ORDER BY e\.occurred_at DESC,e\.id DESC LIMIT \$3 OFFSET \$4/);
});
