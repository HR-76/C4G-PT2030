'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const audit=require('../src/audit/eventCatalog');
const {createOpportunityCatalogs}=require('../src/opportunities/catalogs');
test('EU operational audit is Central and preserves the closed F12 catalog startup',()=>{
 assert.equal(createOpportunityCatalogs().eventCodes.length,11);
 for(const code of ['OPPORTUNITY_SOURCE_SUSPENSION_REQUESTED','OPPORTUNITY_SOURCE_QUIESCED','OPPORTUNITY_SOURCE_RESUMED']){
  const event=audit.resolveEvent(code);assert.equal(event.auditClass,'CRITICAL_PRE_EFFECT');
  assert.equal(event.residencyRule,'CENTRAL_AUTHORITY');
  assert.equal(audit.resolveResidence(event,{operationAuthority:'TENANT',tenantId:'unrelated'}),'CENTRAL');
  assert.equal(Object.hasOwn(audit.F12_EVENTS,code),false);
 }
});
