'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {config}=require('./recovery.cjs');
const env={CIA_R2_TEST_ISOLATED:'YES',CIA_R2_ENDPOINT:'https://fixture.eu.r2.cloudflarestorage.com',CIA_R2_SOURCE_BUCKET:'c4g-test-source',CIA_R2_BACKUP_BUCKET:'c4g-test-backup',CIA_R2_QUARANTINE_BUCKET:'c4g-test-quarantine',CIA_R2_ACCESS_KEY_ID:'fixture-key',CIA_R2_SECRET_ACCESS_KEY:'fixture-secret'};
test('accepts only an explicitly identified EU test configuration with three distinct buckets',()=>{
 assert.deepEqual(config(env).buckets,['c4g-test-source','c4g-test-backup','c4g-test-quarantine']);
 for(const change of [{CIA_R2_TEST_ISOLATED:'NO'},{CIA_R2_ENDPOINT:'https://example.invalid'},{CIA_R2_ENDPOINT:env.CIA_R2_ENDPOINT+'/path'},{CIA_R2_SOURCE_BUCKET:'production-documents'},{CIA_R2_BACKUP_BUCKET:env.CIA_R2_SOURCE_BUCKET},{CIA_R2_SECRET_ACCESS_KEY:''}])assert.throws(()=>config({...env,...change}),{code:'ISOLATED_CONFIG_REQUIRED'});
});
