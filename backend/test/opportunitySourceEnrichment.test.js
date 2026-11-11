'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {validateSourceEnrichment,semanticEnrichment,retainEnrichmentObservation,fitEnrichment,jsonbBytes,safePublicUrl,FIELDS}=require('../src/opportunities/sourceEnrichment');
const at='2026-10-29T00:00:00.000Z';
function sample(){return {schemaVersion:1,mappingVersion:'eu-framework-2026-10-29',observedAt:at,fields:Object.fromEntries(FIELDS.map(key=>[key,{status:'NOT_FOUND',items:[],truncated:false}]))};}
function item(value){return {value,evidence:{url:'https://ec.europa.eu/example',locator:'metadata.budget',excerpt:'Published amount',observedAt:at}};}
test('P3 validates exact financial facts with unknown currency, immutable public evidence',()=>{
 const value=sample();value.fields.budget={status:'PUBLISHED',items:[item({amount:'9007199254740993.01',currency:null,period:'2026',scope:'CALL',group:null,action:null})],truncated:false};
 const out=validateSourceEnrichment(value);assert.equal(out.fields.budget.items[0].value.amount,'9007199254740993.01');assert.equal(out.fields.budget.items[0].value.currency,null);assert.ok(Object.isFrozen(out.fields.budget.items));
});
test('P3 closed schema refuses malformed values, timestamps, credentials, local links and unknown states',()=>{
 for(const mutate of [v=>v.secret='x',v=>v.fields.rate.status='CONFIRMED',v=>v.observedAt='2026-02-30T00:00:00.000Z',v=>v.fields.conditions.items.push(item({text:'unexpected'})),v=>v.fields.programme.items.push(item({id:'123',code:null,label:'Unknown'}))]){const v=sample();mutate(v);assert.throws(()=>validateSourceEnrichment(v));}
 for(const link of ['http://ec.europa.eu/a','https://user:password@ec.europa.eu/a','https://127.0.0.1/a','https://localhost/a','https://foo.local/a','https://ec.europa.eu/a?token=secret','javascript:alert(1)'])assert.equal(safePublicUrl(link),null);
 assert.equal(safePublicUrl('https://ec.europa.eu/a?lang=en'),'https://ec.europa.eu/a?lang=en');
});
test('P3 support never accepts a negative or zero placeholder, reversed range or invented numeric coercion',()=>{
 for(const [minimum,maximum] of [['0',null],['-1','3'],['5','4'],[2,'3'],['1e3',null],[null,null]]){const v=sample();v.fields.support={status:'PUBLISHED',items:[item({minimum,maximum,currency:null,unit:'PER_PROJECT',action:null})],truncated:false};assert.throws(()=>validateSourceEnrichment(v));}
});
test('P3 repeat observations keep first evidence per unchanged field but preserve changed facts',()=>{
 const previous=sample();previous.fields.instrument={status:'PUBLISHED',items:[item({text:'Grant'})],truncated:false};
 const incoming=structuredClone(previous);incoming.observedAt='2026-10-30T00:00:00.000Z';incoming.fields.instrument.items[0].evidence.observedAt=incoming.observedAt;
 assert.deepEqual(semanticEnrichment(previous),semanticEnrichment(incoming));assert.deepEqual(retainEnrichmentObservation(previous,incoming),previous);
 incoming.fields.conditions={status:'PUBLISHED',items:[item({text:'New terms'})],truncated:false};incoming.fields.conditions.items[0].evidence.observedAt=incoming.observedAt;
 const result=retainEnrichmentObservation(previous,incoming);assert.equal(result.fields.instrument.items[0].evidence.observedAt,at);assert.equal(result.observedAt,incoming.observedAt);
});
test('P3 JSONB limit counts spaces and unicode; fitting is deterministic and explicit',()=>{
 assert.equal(jsonbBytes({a:[1,2],b:'á'}),Buffer.byteLength('{"a": [1, 2], "b": "á"}'));
 const v=sample();v.fields.conditions={status:'PUBLISHED',items:[item({text:'Condição '.repeat(350)})],truncated:false};v.fields.documents={status:'PUBLISHED',items:Array.from({length:8},(_,i)=>item({title:'Documento '+i,url:'https://ec.europa.eu/'+('a'.repeat(1200))+i})),truncated:false};
 assert.throws(()=>validateSourceEnrichment(v));const fitted=fitEnrichment(v,4500);assert.ok(jsonbBytes(fitted)<=4500);assert.ok(Object.values(fitted.fields).some(f=>f.truncated));assert.deepEqual(fitEnrichment(v,4500),fitted);validateSourceEnrichment(fitted);
});
test('P3 hostile getter/proxy is rejected without evaluation',()=>{
 const v=sample();let invoked=false;Object.defineProperty(v,'observedAt',{get(){invoked=true;return at;}});assert.throws(()=>validateSourceEnrichment(v));assert.equal(invoked,false);assert.throws(()=>validateSourceEnrichment(new Proxy(sample(),{})));
});
