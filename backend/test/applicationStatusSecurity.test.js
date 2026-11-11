'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createHash}=require('node:crypto');
const {SQL}=require('../src/applications/statusEmails/capture');
const protocol=require('../src/security/authorityProtocolQueries');
const {load}=require('../src/applications/statusEmails/securityPackage');
test('closed protocol and SQL candidate agree on the admitted hash',async()=>{
 const hash=createHash('sha256').update(protocol.normalize(SQL)).digest('hex');
 assert.ok(protocol.queries.includes(SQL));assert.ok(load('central').sql.includes(hash));
 let calls=0;await protocol.execute({query:async(sql,args)=>{calls++;assert.equal(args[0],hash);return {rows:[{result:{rows:[],rowCount:0}}]}}},SQL,['org','actor',[]]);assert.equal(calls,1);
 await assert.rejects(protocol.execute({query:()=>assert.fail()},SQL+' LIMIT 1',[]),{code:'42501'});
});
test('outbox package grants only a closed function to runtime, never table DML',()=>{
 const sql=load('tenant').sql;
 assert.ok(sql.includes('SECURITY DEFINER SET search_path=pg_catalog'));
 assert.ok(!/GRANT (SELECT|INSERT|UPDATE|DELETE).*TO c4g_opportunity_tenant_runtime/.test(sql));
 assert.ok(sql.includes('FROM PUBLIC'));assert.ok(sql.includes('STATUS_OUTBOX_CONTEXT_DENIED'));
});
