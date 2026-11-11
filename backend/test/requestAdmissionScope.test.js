'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const preflight = require('../src/security/centralMigrationPreflight');
const { knownManifest } = require('../src/security/centralMigrationManifest');
const { assertAuthorityAdmission } = require('../src/security/authoritySecurityManifest');
const { createRequestAdmissionScope, requestAdmissionMiddleware, runInRequestAdmissionScope } = require('../src/security/requestAdmissionScope');

const admitted = knownManifest.findLast(entry => entry.authoritySecurityFingerprint).version;
function client({ login = 'c4g_authority_runtime', database = 'central' } = {}) {
  const identities = [];
  return { host: 'localhost', port: 5432, database, identities,
    async query(sql) { identities.push(sql); return { rows: [{ session_user: login, current_user: login }] }; } };
}
// The real preflight needs PostgreSQL; only its invocation count and outcome matter here.
async function withPreflight(result, work) {
  const original = preflight.preflightCentral; let calls = 0;
  preflight.preflightCentral = async () => { calls++; const value = typeof result === 'function' ? result(calls) : result; if (value instanceof Error) throw value; return value; };
  try { return await work(() => calls); } finally { preflight.preflightCentral = original; }
}
const schema = Object.freeze({ currentVersion: admitted, fingerprint: 'f'.repeat(64) });

test('outside a request every authority admission runs the Central preflight', async () => {
  await withPreflight(schema, async calls => {
    await assertAuthorityAdmission(client()); await assertAuthorityAdmission(client());
    assert.equal(calls(), 2);
  });
});

test('one request runs the Central preflight once and still checks the login of every connection', async () => {
  await withPreflight(schema, async calls => {
    const first = client(), second = client();
    await runInRequestAdmissionScope(async () => {
      assert.equal(await assertAuthorityAdmission(first), schema);
      assert.equal(await assertAuthorityAdmission(second), schema);
    });
    assert.equal(calls(), 1);
    assert.deepEqual([first.identities.length, second.identities.length], [1, 1]);
  });
});

test('requests never share admission evidence, including concurrent ones', async () => {
  await withPreflight(schema, async calls => {
    await Promise.all([1, 2, 3].map(() => runInRequestAdmissionScope(async () => {
      await assertAuthorityAdmission(client()); await assertAuthorityAdmission(client());
    })));
    assert.equal(calls(), 3);
  });
});

test('the Express middleware scopes the rest of the request', async () => {
  await withPreflight(schema, async calls => {
    await new Promise((resolve, reject) => requestAdmissionMiddleware({}, {}, () => {
      assertAuthorityAdmission(client()).then(() => assertAuthorityAdmission(client())).then(resolve, reject);
    }));
    assert.equal(calls(), 1);
  });
});

test('a failed preflight is never retained', async () => {
  await withPreflight(call => call === 1 ? new Error('Central schema drift detected') : schema, async calls => {
    await runInRequestAdmissionScope(async () => {
      await assert.rejects(assertAuthorityAdmission(client()), /drift/);
      assert.equal(await assertAuthorityAdmission(client()), schema);
      assert.equal(await assertAuthorityAdmission(client()), schema);
    });
    assert.equal(calls(), 2);
  });
});

test('a schema revision without an authority contract stays inadmissible and is not retained', async () => {
  await withPreflight(Object.freeze({ currentVersion: '000_unknown' }), async calls => {
    await runInRequestAdmissionScope(async () => {
      await assert.rejects(assertAuthorityAdmission(client()), { code: 'AUTHORITY_SECURITY_DRIFT' });
      await assert.rejects(assertAuthorityAdmission(client()), { code: 'AUTHORITY_SECURITY_DRIFT' });
    });
    assert.equal(calls(), 2);
  });
});

test('a wrong login is refused even when the request already holds evidence', async () => {
  await withPreflight(schema, async calls => {
    await runInRequestAdmissionScope(async () => {
      await assertAuthorityAdmission(client());
      await assert.rejects(assertAuthorityAdmission(client({ login: 'postgres' })), { code: 'AUTHORITY_LOGIN_REQUIRED' });
    });
    assert.equal(calls(), 1);
  });
});

test('evidence from another database is not reused', async () => {
  await withPreflight(schema, async calls => {
    await runInRequestAdmissionScope(async () => {
      await assertAuthorityAdmission(client()); await assertAuthorityAdmission(client({ database: 'other' }));
    });
    assert.equal(calls(), 2);
  });
});

test('evidence expires within the request and concurrent first admissions do not wait on each other', async () => {
  let instant = 0, verified = 0;
  const scope = createRequestAdmissionScope({ now: () => instant, maxAgeMs: 10000 });
  const verify = async () => ++verified;
  await scope.run(async () => {
    assert.equal(await scope.admit('central', verify), 1);
    instant = 9999; assert.equal(await scope.admit('central', verify), 1);
    instant = 10000; assert.equal(await scope.admit('central', verify), 2);
    instant = 30000; assert.deepEqual(await Promise.all([scope.admit('central', verify), scope.admit('central', verify)]), [3, 4]);
  });
  assert.equal(await scope.admit('central', verify), 5);
});

const { observeTenantRuntimeMetadata } = require('../src/security/tenantRuntimeMetadata');
const tenant = { tenantId: '11111111-1111-4111-8111-111111111111', databaseGenerationId: '22222222-2222-4222-8222-222222222222' };
const tenantClient = (database = 'tenant') => ({ host: 'localhost', port: 5432, database });
function tenantObserver(outcome = () => Object.freeze({ currentVersion: '036', schemaFingerprint: 'a'.repeat(64) })) {
  const state = { calls: 0 };
  state.observe = async () => { state.calls++; const value = outcome(state.calls); if (value instanceof Error) throw value; return value; };
  return state;
}

test('outside a request every tenant observation reads the schema', async () => {
  const observer = tenantObserver();
  await observeTenantRuntimeMetadata(tenantClient(), tenant, observer); await observeTenantRuntimeMetadata(tenantClient(), tenant, observer);
  assert.equal(observer.calls, 2);
});

test('one request reads the tenant schema once and requests never share it', async () => {
  const observer = tenantObserver();
  await Promise.all([1, 2].map(() => runInRequestAdmissionScope(async () => {
    const first = await observeTenantRuntimeMetadata(tenantClient(), tenant, observer);
    assert.equal(await observeTenantRuntimeMetadata(tenantClient(), tenant, observer), first);
    assert.equal(await observeTenantRuntimeMetadata(tenantClient(), tenant, observer), first);
  })));
  assert.equal(observer.calls, 2);
});

test('a failed tenant observation is never retained', async () => {
  const observer = tenantObserver(call => call === 1 ? new Error('F4_METADATA_DRIFT') : Object.freeze({ currentVersion: '036' }));
  await runInRequestAdmissionScope(async () => {
    await assert.rejects(observeTenantRuntimeMetadata(tenantClient(), tenant, observer), /F4_METADATA_DRIFT/);
    await observeTenantRuntimeMetadata(tenantClient(), tenant, observer); await observeTenantRuntimeMetadata(tenantClient(), tenant, observer);
  });
  assert.equal(observer.calls, 2);
});

test('another tenant database, tenant or generation is observed again, and Central evidence is never used for a tenant', async () => {
  const observer = tenantObserver();
  await withPreflight(schema, async () => runInRequestAdmissionScope(async () => {
    await assertAuthorityAdmission(client({ database: 'tenant' }));
    await observeTenantRuntimeMetadata(tenantClient(), tenant, observer);
    await observeTenantRuntimeMetadata(tenantClient('other'), tenant, observer);
    await observeTenantRuntimeMetadata(tenantClient(), { ...tenant, tenantId: '33333333-3333-4333-8333-333333333333' }, observer);
    await observeTenantRuntimeMetadata(tenantClient(), { ...tenant, databaseGenerationId: '44444444-4444-4444-8444-444444444444' }, observer);
  }));
  assert.equal(observer.calls, 4);
});

const { assertAuthoritySecurity } = require('../src/security/authoritySecurityManifest');
function securityVerifier(outcome = () => Object.freeze({ roles: [] })) {
  const state = { calls: 0 };
  state.verify = async () => { state.calls++; const value = outcome(state.calls); if (value instanceof Error) throw value; return value; };
  return state;
}

test('outside a request every transaction reads the authority security metadata', async () => {
  const verifier = securityVerifier();
  await assertAuthoritySecurity(client(), admitted, verifier); await assertAuthoritySecurity(client(), admitted, verifier);
  assert.equal(verifier.calls, 2);
});

test('one request reads the authority security metadata once and requests never share it', async () => {
  const verifier = securityVerifier();
  await Promise.all([1, 2].map(() => runInRequestAdmissionScope(async () => {
    const first = await assertAuthoritySecurity(client(), admitted, verifier);
    assert.equal(await assertAuthoritySecurity(client(), admitted, verifier), first);
  })));
  assert.equal(verifier.calls, 2);
});

test('a refused authority security read is never retained, and another database or version is read again', async () => {
  const verifier = securityVerifier(call => call === 1 ? Object.assign(new Error('AUTHORITY_SECURITY_DRIFT'), { code: 'AUTHORITY_SECURITY_DRIFT' }) : Object.freeze({ roles: [] }));
  await runInRequestAdmissionScope(async () => {
    await assert.rejects(assertAuthoritySecurity(client(), admitted, verifier), { code: 'AUTHORITY_SECURITY_DRIFT' });
    await assertAuthoritySecurity(client(), admitted, verifier); await assertAuthoritySecurity(client(), admitted, verifier);
    await assertAuthoritySecurity(client({ database: 'other' }), admitted, verifier);
    await assertAuthoritySecurity(client(), '000_other_version', verifier);
  });
  assert.equal(verifier.calls, 4);
});

test('schema evidence held by a request never stands in for the authority security read', async () => {
  const verifier = securityVerifier();
  await withPreflight(schema, async () => runInRequestAdmissionScope(async () => {
    await assertAuthorityAdmission(client());
    await assertAuthoritySecurity(client(), admitted, verifier);
  }));
  assert.equal(verifier.calls, 1);
});

test('a real drifted snapshot is still refused inside a request', async () => {
  const drifted = { host: 'localhost', port: 5432, database: 'central', async query() { return { rows: [] }; } };
  await runInRequestAdmissionScope(async () => {
    await assert.rejects(assertAuthoritySecurity(drifted, admitted));
    await assert.rejects(assertAuthoritySecurity(drifted, admitted));
  });
});
