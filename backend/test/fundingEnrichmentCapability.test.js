'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {coverageConfig}=require('../src/fundingTenders/coverageConfig');
const {workerHealth}=require('../src/fundingTenders/workerHealth');
test('P3 is opt-in and requires complete coverage plus P2 resolution schema',()=>{
 const version='035_funding_source_resolution';
 assert.equal(coverageConfig('durable-v1',version).enrichmentEnabled,undefined);
 assert.equal(coverageConfig('durable-v1',version,'verified-v1').enrichmentEnabled,true);
 for(const args of [['durable-v1',version,'yes'],['disabled',version,'verified-v1'],['durable-v1','034_funding_temporal_refresh','verified-v1']])assert.throws(()=>coverageConfig(...args));
});
test('P3 capability comes only from the matching worker installation',()=>{
 const now=Date.parse('2026-10-29T00:00:00Z'),heartbeat={at:now,installationId:'local',mode:'PROCESSING',lastPollAt:now,consecutiveFailures:0,enrichmentSupported:true};
 assert.equal(workerHealth(heartbeat,{now,installationId:'local'}).enrichmentSupported,true);
 assert.equal(workerHealth(heartbeat,{now,installationId:'other'}).enrichmentSupported,undefined);
});
