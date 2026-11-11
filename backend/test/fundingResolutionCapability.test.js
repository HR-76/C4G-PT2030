'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {workerHealth}=require('../src/fundingTenders/workerHealth');
const {coverageConfig}=require('../src/fundingTenders/coverageConfig');

test('resolution capability is advertised only by the same valid worker installation',()=>{
 const now=Date.parse('2026-10-28T12:00:00Z');
 const heartbeat={at:now-100,installationId:'local',mode:'PROCESSING',lastPollAt:now-200,consecutiveFailures:0,resolutionSupported:true};
 assert.equal(workerHealth(heartbeat,{now,installationId:'local'}).resolutionSupported,true);
 assert.equal(workerHealth({...heartbeat,installationId:'other'},{now,installationId:'local'}).resolutionSupported,undefined);
 assert.equal(workerHealth({...heartbeat,resolutionSupported:undefined},{now,installationId:'local'}).resolutionSupported,undefined);
});

test('resolution mode requires the exact admitted migration and leaves P2 unchanged',()=>{
 assert.deepEqual(coverageConfig('durable-v1','034_funding_temporal_refresh'),{supported:true,enabled:true,temporalSupported:true});
 assert.deepEqual(coverageConfig('durable-v1','035_funding_source_resolution'),{supported:true,enabled:true,temporalSupported:true,resolutionSupported:true});
 assert.throws(()=>coverageConfig('durable-v1','999_future'),/FUNDING_COVERAGE_SCHEMA_REQUIRED/);
});
