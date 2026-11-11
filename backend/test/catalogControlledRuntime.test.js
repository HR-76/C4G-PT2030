'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{randomUUID,randomBytes}=require('node:crypto');
const {createControlledReadRuntime}=require('../src/opportunities/catalogRead/controlledRuntime');
test('monitor failure prevents opening, while rollback and withdrawal remain available',async()=>{
 let offline=false;const pool={connect:async()=>{throw Error('No SQL expected')}};
 const runtime=createControlledReadRuntime({isolated:true,express:{Router:()=>({use(){}})},catalogPool:pool,authorityPool:pool,authorityLogin:'isolated_membership',policyVersion:'test',key:randomBytes(32),sink:()=>{if(offline)throw Error('offline')}});
 const org=randomUUID();offline=true;runtime.monitor.heartbeat();await assert.rejects(runtime.operator.enable({expectedRevision:0,organizations:[org]}),/CONTROL_MONITOR_NOT_READY/);
 assert.equal((await runtime.operator.status()).revision,0);await runtime.operator.disable({expectedRevision:0});await runtime.operator.withdraw({expectedRevision:1,generationId:randomUUID()});
 offline=false;assert(runtime.monitor.heartbeat());await runtime.operator.enable({expectedRevision:2,organizations:[org]});assert.equal((await runtime.operator.status()).blockedGenerations,1);
});
