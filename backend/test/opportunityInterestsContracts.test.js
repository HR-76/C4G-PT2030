'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');
const {parse}=require('../src/opportunityInterests/contracts');

test('registration is a light organizational signal with normalized distinct unit IDs',()=>{
 const input={opportunityId:randomUUID(),centralRevisionId:randomUUID(),unitIds:[randomUUID(),randomUUID()],idempotencyKey:randomUUID()};
 assert.deepEqual(parse('register',input),{...input,unitIds:[...input.unitIds].sort()});
 assert.deepEqual(parse('register',{...input,unitIds:[]}).unitIds,[]);
 for(const extra of [{organizationId:randomUUID()},{title:'Project'},{responsibleMembershipId:randomUUID()},{deadline:'2027-01-01'},{status:'ACTIVE'}])
  assert.throws(()=>parse('register',{...input,...extra}),{code:'INVALID_INPUT'});
 for(const unitIds of [null,[input.unitIds[0],input.unitIds[0]],Array.from({length:51},randomUUID),['invalid']])
  assert.throws(()=>parse('register',{...input,unitIds}),{code:'INVALID_INPUT'});
});

test('management uses exact CAS commands and bounded notes/archive reason',()=>{
 const edit={notes:null,unitIds:[],expectedRevision:2,idempotencyKey:randomUUID()};
 assert.deepEqual(parse('edit',edit),edit);
 assert.equal(parse('edit',{...edit,notes:'a'.repeat(10000)}).notes.length,10000);
 for(const extra of [{notes:'a'.repeat(10001)},{expectedRevision:0},{unitIds:[randomUUID(),null]},{actorId:randomUUID()}])
  assert.throws(()=>parse('edit',{...edit,...extra}),{code:'INVALID_INPUT'});
 const archive={reason:'No longer relevant',expectedRevision:2,idempotencyKey:randomUUID()};
 assert.deepEqual(parse('archive',archive),archive);
 for(const reason of ['', ' padded ', 'a'.repeat(501)])assert.throws(()=>parse('archive',{...archive,reason}),{code:'INVALID_INPUT'});
});

test('interest reads bound filters, purposes, cursor and summary IDs',()=>{
 assert.deepEqual(parse('list',{}),{q:'',unitId:null,status:'ACTIVE',cursor:null});
 assert.equal(parse('list',{unitId:'NONE',status:'ALL'}).unitId,'NONE');
 assert.equal(parse('units',{purpose:'FILTER'}).purpose,'FILTER');
 assert.equal(parse('units',{purpose:'ASSIGN'}).purpose,'ASSIGN');
 for(const input of [{purpose:'ALL'},{purpose:'ASSIGN',organizationId:randomUUID()},{}])assert.throws(()=>parse('units',input),{code:'INVALID_INPUT'});
 for(const input of [{q:'x'.repeat(201)},{unitId:'all'},{status:'UNKNOWN'},{cursor:'x'.repeat(4001)},{limit:'10000'}])assert.throws(()=>parse('list',input),{code:'INVALID_INPUT'});
 const ids=Array.from({length:25},randomUUID);
 assert.equal(parse('summaries',{opportunityIds:ids.join(',')}).opportunityIds.length,25);
 for(const opportunityIds of ['',ids.concat(randomUUID()).join(','),[ids[0],ids[0]].join(',')])assert.throws(()=>parse('summaries',{opportunityIds}),{code:'INVALID_INPUT'});
 assert.throws(()=>parse('get',{cursor:'x'}),{code:'INVALID_INPUT'});
});
