'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto');
const {parse}=require('../src/organizationDirectory/contracts');
const base=()=>({biography:'Bio',keywords:'k',areaIds:[],expectedRevision:0,idempotencyKey:randomUUID()});
const person=(extra={})=>({...base(),name:'Ana Técnica',functionLabel:'Técnica de projetos',unitIds:[],primaryUnitId:null,...extra});

test('the own profile keeps working without the name, function and unit fields',()=>{
 const legacy=base();assert.deepEqual(parse('selfEdit',legacy),legacy);
});
test('the person can change her own name, function and units, with one primary unit among them',()=>{
 const u1=randomUUID(),u2=randomUUID();
 const out=parse('selfEdit',person({unitIds:[u2,u1],primaryUnitId:u1}));
 assert.equal(out.name,'Ana Técnica');assert.equal(out.functionLabel,'Técnica de projetos');
 assert.deepEqual(out.unitIds,[u1,u2].sort());assert.equal(out.primaryUnitId,u1);
});
test('the email and the active state are never accepted from the own profile',()=>{
 assert.throws(()=>parse('selfEdit',person({email:'x@c4g.invalid'})));
 assert.throws(()=>parse('selfEdit',person({active:false})));
});
test('unit selections must be valid, unique and consistent with the primary unit',()=>{
 const u=randomUUID();
 assert.throws(()=>parse('selfEdit',person({unitIds:[u,u],primaryUnitId:u})));
 assert.throws(()=>parse('selfEdit',person({unitIds:[u],primaryUnitId:null})));
 assert.throws(()=>parse('selfEdit',person({unitIds:[],primaryUnitId:u})));
 assert.throws(()=>parse('selfEdit',person({unitIds:['not-a-uuid'],primaryUnitId:'not-a-uuid'})));
});
test('a name is required and must be a valid label; the function has a length limit',()=>{
 assert.throws(()=>parse('selfEdit',person({name:''})));
 assert.throws(()=>parse('selfEdit',person({functionLabel:'x'.repeat(257)})));
});
