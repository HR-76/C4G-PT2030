'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { configuredDeliveryHistory } = require('../src/emailTemplates/deliveryRuntime');

test('history remains disabled until explicitly selected', () => {
  assert.equal(configuredDeliveryHistory({ env: {} }), null);
  assert.throws(() => configuredDeliveryHistory({ env: { EMAIL_HISTORY_RUNTIME: 'unknown' } }), TypeError);
});
test('retention failure blocks activation; periodic failure is visible and shutdown cancels it', async () => {
  let unavailable = true, tick, cancelled = false;
  const keycloak = { async retention() { if (unavailable) throw Error('private-provider-response'); }, async history() { return { items: [] }; } };
  const pool = { async query(sql) { return { rows: sql.includes('email_platform_admin') ? [{ allowed: true }] : [] }; } };
  const runtime = configuredDeliveryHistory({ env: { EMAIL_HISTORY_RUNTIME: 'central-keycloak-v1' }, pool, keycloak,
    setIntervalImpl(callback, delay) { assert.equal(delay, 60000); tick = callback; return { unref() {} }; },
    clearIntervalImpl() { cancelled = true; } });
  await assert.rejects(runtime.ready(), { code: 'EMAIL_HISTORY_UNAVAILABLE' });
  assert.equal(tick, undefined);
  unavailable = false;
  await runtime.ready();
  const req = { user: { id: '12345678-1234-4234-8234-123456789012' }, sessionID: 's', authContext: { sessionId: 's' } };
  assert.equal((await runtime.list({}, req)).retentionHealthy, true);
  unavailable = true; tick();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal((await runtime.list({}, req)).retentionHealthy, false);
  await runtime.close();
  assert.equal(cancelled, true);
  await assert.rejects(runtime.ready(), /EMAIL_HISTORY_CLOSED/);
});
