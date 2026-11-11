'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const candidate=require('../src/security/opportunityInterestMigrationCandidate');
const {parseArguments}=require('../../test/integration/opportunity-interests/gate');

test('isolated gate refuses missing flag, external targets and unknown arguments before any work',()=>{
 for(const args of [[],['--verify'],['--isolated','postgres://elsewhere'],['--isolated','--url','x'],['--isolated','--isolated']])assert.throws(()=>parseArguments(args));
 assert.deepEqual(parseArguments(['--isolated']),{verify:false});
 assert.deepEqual(parseArguments(['--isolated','--verify']),{verify:true});
 assert.deepEqual(parseArguments(['--isolated','--historical-030']),{verify:true,historical:true});
 assert.throws(()=>parseArguments(['--historical-030']));
 assert.throws(()=>parseArguments(['--isolated','--historical-030','--verify']));
});

test('candidate source is checksummed without admitting an invented schema fingerprint',()=>{
 const before=require('../src/security/tenantMigrationManifest').manifest;
 assert.equal(candidate.baseline().at(-1).version,candidate.BASELINE);
 assert.match(candidate.source().checksum,/^[a-f0-9]{64}$/);
 for(const fingerprint of [undefined,null,'',candidate.baseline().at(-1).schemaFingerprint])assert.throws(()=>candidate.measuredCandidate(fingerprint));
 assert.equal(require('../src/security/tenantMigrationManifest').manifest,before);
});

test('candidate SQL extends both F7 event allowlists and gate fixtures build real audit events',()=>{
 const {fixture,auditCandidate}=require('../../test/integration/opportunity-interests/proof');
 const {isUuidV7}=require('../src/audit/uuidV7');
 const {randomUUID}=require('node:crypto');
 const sql=candidate.source().sql,f=fixture();
 assert.match(sql,/FOREACH tab IN ARRAY ARRAY\['event','event_identity'\]/);
 assert.match(sql,/event_event_code_check/);
 assert.match(sql,/event_identity_event_code_check/);
 for(const [eventCode,operationCode] of [
  ['OPPORTUNITY_INTEREST_REGISTERED','OPPORTUNITY_INTEREST_REGISTER'],
  ['OPPORTUNITY_INTEREST_CHANGED','OPPORTUNITY_INTEREST_MANAGE'],
  ['OPPORTUNITY_INTEREST_ARCHIVED','OPPORTUNITY_INTEREST_MANAGE'],
  ['APPLICATION_CREATED','APPLICATION_CREATE'],['APPLICATION_CHANGED','APPLICATION_WORK_EDIT']]){
  if(eventCode.startsWith('OPPORTUNITY_INTEREST_'))assert(sql.includes(`''${eventCode}''`));
  const event=auditCandidate(f,f.orgA,{eventCode,operationCode,resourceId:randomUUID(),idempotencyKey:randomUUID()}).event;
  assert.equal(event.eventCode,eventCode);assert.equal(event.ledgerLocation,'TENANT');assert.equal(isUuidV7(event.correlationId),true);
 }
});
