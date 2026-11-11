'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {temporalState,validateTemporal}=require('../src/opportunities/temporal');
const now='2026-10-28T12:00:00Z';
test('temporal window is independent from administrative state and future opening is not open',()=>{
 assert.equal(temporalState({lifecycleState:'ACTIVE',openingDate:'2026-11-01',closingDate:'2026-12-01'},now).state,'UPCOMING');
 assert.equal(temporalState({openingDate:'2026-01-01',closingDate:'2026-10-28'},now).state,'OPEN');
 assert.equal(temporalState({closingDate:'2026-10-27'},now).state,'CLOSED');
 assert.equal(temporalState({},now).state,'UNKNOWN');
});
test('explicit instants expire at the exact deadline; offsets and DST are preserved',()=>{
 const fields={closingDate:'2026-10-28',sourceTemporal:{status:'OPEN',deadlines:['2026-10-28T13:00:00+01:00'],openings:[]}};
 assert.equal(temporalState(fields,'2026-10-28T11:59:59Z').state,'OPEN');
 assert.equal(temporalState(fields,now).state,'CLOSED');
 assert.equal(temporalState({...fields,sourceTemporal:{...fields.sourceTemporal,deadlines:['2026-10-25T02:00:00+02:00']}},'2026-10-25T00:00:00Z').state,'CLOSED');
});
test('all rounds remain available and the next deadline advances without rewriting the revision',()=>{
 const fields={closingDate:'2026-09-01',sourceTemporal:{status:'OPEN',deadlines:['2026-09-01','2026-11-15','2027-02-01'],openings:[]}};
 assert.equal(temporalState(fields,now).nextDeadline,'2026-11-15');
 assert.equal(temporalState(fields,now).state,'OPEN');
 assert.equal(fields.closingDate,'2026-09-01');
 assert.equal(temporalState(fields,now,{closingDate:'2026-09-01'}).state,'CLOSED');
});
test('published closure/cancellation overrides dates; unsupported publication stays unknown',()=>{
 for(const status of ['CLOSED','CANCELLED'])assert.equal(temporalState({closingDate:'2028-01-01',sourceTemporal:{status,deadlines:[],openings:[]}},now).state,status);
 assert.equal(temporalState({sourceTemporal:{status:'UPCOMING',deadlines:[],openings:[]}},now).state,'UPCOMING');
 assert.equal(temporalState({sourceTemporal:{status:'UNKNOWN',deadlines:[],openings:[]}},now).state,'UNKNOWN');
});
test('temporal payload is bounded, preserves source precision, and rejects invalid dates and unknown keys',()=>{
 const value={status:'OPEN',statusCode:'31094502',deadlines:['2026-10-28T17:00:00.000+0000'],openings:['2026-01-01']};
 assert.deepEqual(validateTemporal(value),value);
 for(const changed of [{deadlines:['2026-02-30']},{status:'invented'},{secret:'x'},{deadlines:Array(65).fill('2026-01-01')},{deadlines:['2026-10-28T17:00:00']}])assert.throws(()=>validateTemporal({...value,...changed}));
});
test('source schedule updates do not override a corrected civil deadline',()=>{
 const {mergeSource}=require('../src/fundingTenders/merge');
 const previousSource={closingDate:'2026-11-01'},current={closingDate:'2026-10-01'};
 const merged=mergeSource({previousSource,current,incoming:{closingDate:'2027-01-01',sourceTemporal:{status:'OPEN',deadlines:['2027-01-01T17:00:00Z'],openings:[]}}});
 assert.equal(merged.fields.closingDate,'2026-10-01');assert.deepEqual(merged.conflicts,['closingDate']);
 assert.equal(temporalState(merged.fields,now,merged.corrections).state,'CLOSED');
 assert.equal(temporalState(merged.fields,now,merged.corrections,'CONFLICT').state,'UNKNOWN');
});
