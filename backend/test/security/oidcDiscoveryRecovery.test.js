const test = require('node:test');
const assert = require('node:assert/strict');
const { OidcClient } = require('../../src/security/oidcClient');

test('discovery recovers after bounded backoff and concurrent callers share each attempt', async () => {
  let now = 0, attempts = 0, checks = 0;
  const configuration = {};
  const adapter = new OidcClient({}, { now: () => now, library: {
    async discovery() { if (++attempts < 3) throw Error('temporarily unavailable'); return configuration; },
    enableNonRepudiationChecks() { checks++; }
  } });
  for (const instant of [0, 1000]) {
    now = instant;
    const results = await Promise.allSettled([adapter.configuration(), adapter.configuration()]);
    assert(results.every(result => result.status === 'rejected'));
  }
  assert.equal(attempts, 2);
  now = 2999;
  await assert.rejects(adapter.configuration());
  assert.equal(attempts, 2);
  now = 3000;
  assert.deepEqual(await Promise.all([adapter.configuration(), adapter.configuration()]), [configuration, configuration]);
  assert.equal(attempts, 3);
  assert.equal(checks, 1);
  assert.equal(await adapter.configuration(), configuration);
  assert.equal(attempts, 3);
});

test('persistent discovery failures cap the retry delay at thirty seconds', async () => {
  let now = 0, attempts = 0;
  const adapter = new OidcClient({}, { now: () => now, library: {
    async discovery() { attempts++; throw Error('unavailable'); }
  } });
  for (const delay of [1000, 2000, 4000, 8000, 16000, 30000, 30000]) {
    await assert.rejects(adapter.configuration());
    const expected = attempts;
    now += delay - 1;
    await assert.rejects(adapter.configuration());
    assert.equal(attempts, expected);
    now++;
  }
  assert.equal(attempts, 7);
});
