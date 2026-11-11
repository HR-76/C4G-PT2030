'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {loadFundingTendersWorker}=require('../src/config/fundingTendersWorker');
test('central source maps the verified CEF programme code without the legacy DIGITAL alias',()=>{
 const {normalizeRecord}=require('../src/fundingTenders/source');
 assert.equal(normalizeRecord({content:'CEF opportunity',metadata:{identifier:['CEF-DEMO'],frameworkProgramme:['43251567']}}).fields.programmeName,'CEF');
});
test('real demo worker cannot target another database, host, port or production',async()=>{
 const env={FUNDING_TENDERS_RUNTIME:'central',FUNDING_TENDERS_SOURCE:'live-demo',NODE_ENV:'development',FUNDING_TENDERS_REHEARSAL_APPROVED:'five-public-records',CENTRAL_DATABASE_URL:'postgresql://local@127.0.0.1:5561/c4g_f13_authority_synthetic_central'};
 for(const delta of [{CENTRAL_DATABASE_URL:'postgresql://local@example.invalid:5561/c4g_f13_authority_synthetic_central'},{CENTRAL_DATABASE_URL:'postgresql://local@127.0.0.1:5433/c4g_f13_authority_synthetic_central'},{CENTRAL_DATABASE_URL:'postgresql://local@127.0.0.1:5561/other'},{NODE_ENV:'production'},{FUNDING_TENDERS_REHEARSAL_APPROVED:''},{OPPORTUNITY_IMPORTS_RUNTIME:'f12-xlsx'}])await assert.rejects(()=>loadFundingTendersWorker({env:{...env,...delta}}));
});
