'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { fundingWorkerTarget } = require('../src/config/fundingTendersWorker');
const { collectionPolicy, STAGING_APPROVALS } = require('../src/fundingTenders/programmes');

const staging = Object.freeze({
  FUNDING_TENDERS_RUNTIME: 'central', FUNDING_TENDERS_SOURCE: 'live-staging', NODE_ENV: 'production',
  FUNDING_TENDERS_REHEARSAL_APPROVED: 'staging-eu-funding-tenders-5',
  CENTRAL_DATABASE_URL: 'postgresql://worker:secret@c4g-postgres:5432/c4g_central_staging?sslmode=verify-full'
});

test('staging collection is admitted only for the staging Central, over verified TLS, with a named approval', () => {
  const admitted = fundingWorkerTarget(staging);
  assert.equal(admitted.live, true);
  assert.equal(admitted.target.hostname, 'c4g-postgres');
  for (const delta of [
    { NODE_ENV: 'development' }, { NODE_ENV: undefined },
    { FUNDING_TENDERS_REHEARSAL_APPROVED: undefined }, { FUNDING_TENDERS_REHEARSAL_APPROVED: 'five-public-records' },
    { FUNDING_TENDERS_REHEARSAL_APPROVED: 'staging-eu-funding-tenders-1000' },
    { CENTRAL_DATABASE_URL: staging.CENTRAL_DATABASE_URL.replace('c4g-postgres', 'localhost') },
    { CENTRAL_DATABASE_URL: staging.CENTRAL_DATABASE_URL.replace('c4g-postgres', 'db.example.com') },
    { CENTRAL_DATABASE_URL: staging.CENTRAL_DATABASE_URL.replace('5432', '5433') },
    { CENTRAL_DATABASE_URL: staging.CENTRAL_DATABASE_URL.replace('c4g_central_staging', 'c4g_tenant_staging') },
    { CENTRAL_DATABASE_URL: staging.CENTRAL_DATABASE_URL.replace('c4g_central_staging', 'c4g_central_dev') },
    { CENTRAL_DATABASE_URL: staging.CENTRAL_DATABASE_URL.replace('?sslmode=verify-full', '') },
    { CENTRAL_DATABASE_URL: staging.CENTRAL_DATABASE_URL.replace('verify-full', 'disable') },
    { OPPORTUNITY_IMPORTS_RUNTIME: 'f12-xlsx' }, { FUNDING_TENDERS_RUNTIME: 'disabled' }
  ]) assert.throws(() => fundingWorkerTarget({ ...staging, ...delta }), undefined, JSON.stringify(delta));
});

test('staging does not widen what the local rehearsal admits', () => {
  // The same staging database is still refused by the local modes, and a local database by the staging mode.
  for (const source of ['live-local', 'live-demo', 'live-rehearsal', 'fixture']) {
    assert.throws(() => fundingWorkerTarget({ ...staging, FUNDING_TENDERS_SOURCE: source, FUNDING_TENDERS_REHEARSAL_APPROVED: 'five-public-records' }));
  }
  assert.throws(() => fundingWorkerTarget({ ...staging, CENTRAL_DATABASE_URL: 'postgresql://t@localhost:5432/c4g_central_dev', NODE_ENV: 'development' }));
});

test('staging collection policy: EU Funding & Tenders only, with the results the approval names', () => {
  assert.deepEqual(Object.keys(STAGING_APPROVALS).sort(), ['staging-eu-funding-tenders-100', 'staging-eu-funding-tenders-5']);
  assert.deepEqual(collectionPolicy('live-staging', 'staging-eu-funding-tenders-5'), { sources: ['EU_FUNDING_TENDERS'], limits: { results: 5, pageSize: 5, pages: 1 } });
  assert.deepEqual(collectionPolicy('live-staging', 'staging-eu-funding-tenders-100'), { sources: ['EU_FUNDING_TENDERS'], limits: { results: 100, pageSize: 100, pages: 1 } });
  for (const approval of [undefined, '', 'central-programmes-100', 'central-official-sources-100', 'toString', '__proto__']) {
    assert.throws(() => collectionPolicy('live-staging', approval), { code: 'FUNDING_STAGING_APPROVAL_INVALID' });
  }
  // Other modes keep their behaviour: the local approvals do not unlock anything under the staging name and vice versa.
  assert.deepEqual(collectionPolicy('live-local', 'staging-eu-funding-tenders-100'), { sources: ['EU_FUNDING_TENDERS'], limits: { results: 5, pageSize: 5, pages: 1 } });
  assert.deepEqual(collectionPolicy('unconfigured').sources, ['EU_FUNDING_TENDERS']);
});
