'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { fundingWorkerTarget } = require('../src/config/fundingTendersWorker');

test('live local worker cannot use another database, host, port, production or lack approval', () => {
  const env = {
    FUNDING_TENDERS_RUNTIME: 'central', FUNDING_TENDERS_SOURCE: 'live-local',
    NODE_ENV: 'development', FUNDING_TENDERS_REHEARSAL_APPROVED: 'five-public-records',
    CENTRAL_DATABASE_URL: 'postgresql://test@localhost:5432/c4g_central_dev'
  };
  assert.equal(fundingWorkerTarget(env).live, true);
  for (const delta of [
    { NODE_ENV: 'production' }, { FUNDING_TENDERS_REHEARSAL_APPROVED: '' },
    { CENTRAL_DATABASE_URL: env.CENTRAL_DATABASE_URL.replace('localhost', 'external.invalid') },
    { CENTRAL_DATABASE_URL: env.CENTRAL_DATABASE_URL.replace('5432', '5561') },
    { CENTRAL_DATABASE_URL: env.CENTRAL_DATABASE_URL.replace('c4g_central_dev', 'c4g_tenant_dev') },
    { OPPORTUNITY_IMPORTS_RUNTIME: 'f12-xlsx' }
  ]) assert.throws(() => fundingWorkerTarget({ ...env, ...delta }));
});
