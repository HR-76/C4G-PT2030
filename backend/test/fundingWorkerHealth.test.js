'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {workerHealth}=require('../src/fundingTenders/workerHealth');
const now=Date.parse('2026-10-28T12:00:00Z');
const heartbeat={at:now-1000,installationId:'local',mode:'PROCESSING',lastPollAt:now-2000,consecutiveFailures:0};
const read=(value,options={})=>workerHealth(value,{now,installationId:'local',...options});
test('only a fresh processing heartbeat with progress is ready',()=>{
 assert.equal(read(heartbeat).state,'PROCESSING');assert.equal(read(heartbeat).ready,true);
 for(const value of [null,{}, {...heartbeat,at:now-10001},{...heartbeat,at:now+1},{...heartbeat,installationId:'other'}])assert.equal(read(value).ready,false);
 assert.equal(read({...heartbeat,mode:'STANDBY'}).state,'STANDBY');
 assert.equal(read({...heartbeat,lastPollAt:now-180001}).state,'STALLED');
 assert.equal(read({...heartbeat,consecutiveFailures:3}).state,'DEGRADED');
 assert.equal(read({...heartbeat,lastPollAt:undefined}).state,'UNKNOWN');
});
test('health projects no installation, pid, raw errors or secrets',()=>{
 const result=read({...heartbeat,pid:42,error:'private',installationId:'local'});
 assert.equal(JSON.stringify(result).includes('private'),false);assert.equal('pid'in result,false);assert.equal('installationId'in result,false);
 assert.equal(result.lastHeartbeatAt,new Date(heartbeat.at).toISOString());
});
