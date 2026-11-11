'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {buildProjection,emptyExtension,stableId}=require('../src/opportunities/catalogRead/model');
const source=require('../../test/integration/catalog-read/snapshot-v2.json');
const {summarize,createIndex}=require('../src/opportunities/catalogRead/readIndex');
function compact(p){const s=p.inputs.snapshot,e=p.inputs.extension;return {version:p.version,summary:p.detail.summary,calendar:{publication:s.publication,status:s.status,schedule:s.schedule},extension:{windows:e.windows,conflicts:e.conflicts},relationships:p.collections.relationships.map(x=>x.targetId)};}
test('compact index agrees with full projection at exact and uncertain calendar boundaries',()=>{
 for(const at of [{precision:'INSTANT',value:'2027-02-01T12:00:00.000Z',originalTimezone:'+00:00'},{precision:'DATE',value:'2027-02-01'}]){
 const s=structuredClone(source);s.schedule.deadlines.value=[{at,phase:null}];const e=emptyExtension(s,{opportunityId:stableId('i'),revisionId:stableId('r'),extensionId:stableId('e'),acceptanceDigest:'a'.repeat(64),recordedAt:'2027-01-20T00:00:00.000Z'});
 const p=buildProjection(s,e,{asOf:'2027-01-20T00:00:00.000Z'}),row=compact(p),index=createIndex([row]);
 for(const asOf of ['2027-01-31T23:59:59.999Z','2027-02-01T00:00:00.000Z','2027-02-01T11:59:59.999Z','2027-02-01T12:00:00.000Z','2027-02-01T23:59:59.999Z','2027-02-02T00:00:00.000Z']){
 assert.deepEqual(summarize(row,asOf),buildProjection(s,e,{asOf}).detail.summary);assert.deepEqual(index.summaries(asOf)[0],buildProjection(s,e,{asOf}).detail.summary);
 }
 }
});
module.exports={compact};

test('bounded index query cache preserves filters, ordering and old snapshot interval',()=>{
 const s=structuredClone(source),e=emptyExtension(s,{opportunityId:stableId('q'),revisionId:stableId('qr'),extensionId:stableId('qe'),acceptanceDigest:'a'.repeat(64),recordedAt:'2027-01-20T00:00:00.000Z'});
 const p=buildProjection(s,e,{asOf:e.recordedAt}),index=createIndex([compact(p)]);
 const first=index.select({},'title',p.asOf);assert.equal(first.length,1);assert(Object.isFrozen(first));assert(Object.isFrozen(first[0].deadline));assert.throws(()=>{first[0].title.value='cache poisoning'},TypeError);assert.strictEqual(index.select({},'title',p.asOf),first);
 assert.equal(index.select({q:'nonexistent-query'},'title',p.asOf).length,0);
 assert.throws(()=>index.select({programme:'unknown'},'title',p.asOf),{code:'FILTER_VALUE_UNKNOWN'});
 for(let i=0;i<12;i++)index.select({q:'query-'+i},'title',p.asOf);
 assert.deepEqual(index.select({},'title',p.asOf),first);
});
