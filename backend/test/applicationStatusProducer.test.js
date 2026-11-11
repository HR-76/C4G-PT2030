'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createProducer}=require('../src/applications/statusEmails/producer');
const {load}=require('../src/applications/statusEmails/migration');
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const snapshot={organizationId:id(1),applicationId:id(2),revision:2,actorUserId:id(3),actorEmail:null,occurredAt:'2026-11-02T12:00:00.000Z',organizationName:'Org',title:'Title',fromStatus:'INTENTION',toStatus:'PREPARATION',candidateMembershipIds:[id(4)]};
const change={kind:'TRANSITION',application:{organization_id:id(1),application_id:id(2),title:'Title',status:'PREPARATION'},revision:2,fromStatus:'INTENTION'};
test('disabled producer performs no capture or SQL; real activation refused',async()=>{await createProducer()({query(){throw Error('SQL')}},change);assert.throws(()=>createProducer({mode:'real'}));});
test('isolated producer uses the same client and reference-only envelope',async()=>{
 const queries=[];const client={query:async(sql,args)=>{queries.push({sql,args});return {rows:[]}}};let seen;
 const producer=createProducer({mode:'isolated',isolated:true,capture:async c=>{assert.equal(c,client);return snapshot},outbox:{enqueue:async(c,input)=>{assert.equal(c,client);seen=input}}});
 await producer(client,change);assert.equal(queries.length,2);assert.deepEqual(Object.keys(seen.envelope.payload),['deliveryId']);assert.ok(!JSON.stringify(seen.envelope).includes('Title'));assert.equal(seen.organizationId,id(1));
});
test('capture failure, conflicting tenant and outbox failure propagate to transaction owner',async()=>{
 const client={query:async()=>({rows:[]})};
 for(const capture of [async()=>{throw Error('unavailable')},async()=>({...snapshot,organizationId:id(9)})])await assert.rejects(createProducer({mode:'isolated',isolated:true,capture})(client,change));
 await assert.rejects(createProducer({mode:'isolated',isolated:true,capture:async()=>snapshot,outbox:{enqueue:async()=>{throw Error('outbox')}}})(client,change),/outbox/);
});
test('migration checksum is pinned and includes organization isolation',()=>{assert.match(load().sql,/FORCE ROW LEVEL SECURITY/)});

test('repository records transition before receipt, propagates producer failure',async()=>{
 const {createApplicationRepository}=require('../src/applications/repository');
 const row={organization_id:id(1),application_id:id(2),opportunity_id:id(7),evaluation_id:null,title:'Title',responsible_membership_id:id(4),deadline:'2026-12-31',status:'INTENTION',revision:1,created_at:new Date(),updated_at:new Date()};
 const input={status:'PREPARATION',reason:'Ready',expectedRevision:1,idempotencyKey:id(8)};
 let calls=[],broken=false;
 const client={query:async(sql,args)=>{
 calls.push(sql);
 if(sql.startsWith('SELECT a.*'))return {rows:[row]};
 if(sql.startsWith('SELECT * FROM opportunity_catalog.application_receipt'))return {rows:[]};
 if(sql.startsWith('UPDATE opportunity_catalog.application SET'))return {rows:[{...row,status:'PREPARATION',revision:2}]};
 return {rows:[]};}};
 const repo=createApplicationRepository({organizationId:id(1),actor:{id:id(3)},protect:async()=>{},audit:async()=>{},recordStatusEmail:async(c,e)=>{assert.equal(c,client);assert.equal(e.revision,2);calls.push('PRODUCER');if(broken)throw Error('producer failed')}});
 await repo.transition(client,id(2),input);
 assert.ok(calls.indexOf('PRODUCER')<calls.findIndex(q=>q.startsWith('INSERT INTO opportunity_catalog.application_receipt')));
 calls=[];broken=true;await assert.rejects(repo.transition(client,id(2),input),/producer failed/);
 assert.ok(!calls.some(q=>q.startsWith('INSERT INTO opportunity_catalog.application_receipt')));
});
