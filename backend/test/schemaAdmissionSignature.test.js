'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const signatures = require('../src/security/schemaAdmissionSignature');
const { createSignatureReuse, configureSchemaAdmissionReuse, setSchemaAdmissionReuse, admitBySignature, signatureSql,
  centralSignature, tenantSignature, CATALOGS, CENTRAL_DATA } = signatures;
const { runInRequestAdmissionScope, admitWithinRequest } = require('../src/security/requestAdmissionScope');

// One HTTP request: a fresh request scope around the work.
const request = work => new Promise((resolve, reject) => runInRequestAdmissionScope(() => { Promise.resolve().then(work).then(resolve, reject); }));
function probe({ signature = 'a', result = 'verified' } = {}) {
  const state = { signature, result, signatures: 0, verifications: 0 };
  state.options = {
    phase: 'authority.signature',
    signature: async () => { state.signatures++; const value = typeof state.signature === 'function' ? state.signature() : state.signature; if (value instanceof Error) throw value; return value; },
    verify: async () => { state.verifications++; if (state.result instanceof Error) throw state.result; return state.result; }
  };
  return state;
}
async function withReuse(options, work) {
  const previous = setSchemaAdmissionReuse(createSignatureReuse(options));
  try { return await work(); } finally { setSchemaAdmissionReuse(previous); }
}

test('reuse is off unless configured, and an unknown mode refuses to start', async () => {
  const previous = setSchemaAdmissionReuse(null);
  try {
    assert.equal(configureSchemaAdmissionReuse({}), false);
    assert.equal(configureSchemaAdmissionReuse({ SCHEMA_ADMISSION_REUSE: 'off' }), false);
    assert.throws(() => configureSchemaAdmissionReuse({ SCHEMA_ADMISSION_REUSE: '30s' }), TypeError);
    const p = probe();
    for (let i = 0; i < 2; i++) assert.equal(await request(() => admitBySignature('k', p.options)), 'verified');
    assert.deepEqual([p.verifications, p.signatures], [2, 0]);
    assert.equal(configureSchemaAdmissionReuse({ SCHEMA_ADMISSION_REUSE: 'signature' }), true);
  } finally { setSchemaAdmissionReuse(previous); }
});

test('an unchanged signature reuses the last successful verification between requests', () => withReuse({}, async () => {
  const p = probe();
  assert.equal(await request(() => admitBySignature('k', p.options)), 'verified');
  assert.deepEqual([p.verifications, p.signatures], [1, 2]); // before and after the full verification
  assert.equal(await request(() => admitBySignature('k', p.options)), 'verified');
  assert.equal(await request(() => admitBySignature('k', p.options)), 'verified');
  assert.deepEqual([p.verifications, p.signatures], [1, 4]);
}));

test('a changed signature verifies again and replaces what was held', () => withReuse({}, async () => {
  const p = probe();
  await request(() => admitBySignature('k', p.options));
  p.signature = 'b'; p.result = 'verified again';
  assert.equal(await request(() => admitBySignature('k', p.options)), 'verified again');
  assert.equal(await request(() => admitBySignature('k', p.options)), 'verified again');
  assert.equal(p.verifications, 2);
  // Going back to an earlier signature is never trusted from memory.
  p.signature = 'a'; p.result = 'third';
  assert.equal(await request(() => admitBySignature('k', p.options)), 'third');
  assert.equal(p.verifications, 3);
}));

test('a signature that moves during the verification is not kept', () => withReuse({}, async () => {
  let reads = 0;
  const p = probe({ signature: () => (++reads === 2 ? 'moved' : 'a') });
  assert.equal(await request(() => admitBySignature('k', p.options)), 'verified');
  assert.equal(await request(() => admitBySignature('k', p.options)), 'verified');
  assert.equal(p.verifications, 2);
}));

test('a failed verification is never kept and drops the earlier success', () => withReuse({}, async () => {
  const p = probe();
  await request(() => admitBySignature('k', p.options));
  const drift = new Error('SCHEMA_DRIFT');
  p.signature = 'b'; p.result = drift;
  await assert.rejects(request(() => admitBySignature('k', p.options)), error => error === drift);
  // Same signature as the first success, but that success was dropped.
  p.signature = 'a'; p.result = 'verified';
  await request(() => admitBySignature('k', p.options));
  assert.equal(p.verifications, 3);
}));

test('a full verification is forced when the held one is too old', async () => {
  let clock = 0;
  await withReuse({ now: () => clock, maxAgeMs: 1000 }, async () => {
    const p = probe();
    await request(() => admitBySignature('k', p.options));
    clock = 999; await request(() => admitBySignature('k', p.options));
    assert.equal(p.verifications, 1);
    clock = 1000; await request(() => admitBySignature('k', p.options));
    assert.equal(p.verifications, 2);
  });
});

test('a failing signature falls back to the full verification and stops being asked', () => withReuse({}, async () => {
  const p = probe({ signature: new Error('permission denied for table pg_auth_members') });
  for (let i = 0; i < 3; i++) assert.equal(await request(() => admitBySignature('k', p.options)), 'verified');
  assert.deepEqual([p.verifications, p.signatures], [3, 1]);
  // A signature that fails only after the verification keeps the result of that request and holds nothing.
  let reads = 0;
  const late = probe({ signature: () => (++reads === 2 ? new Error('connection lost') : 'a') });
  assert.equal(await request(() => admitBySignature('late', late.options)), 'verified');
  assert.equal(await request(() => admitBySignature('late', late.options)), 'verified');
  assert.equal(late.verifications, 2);
}));

test('outside an HTTP request there is no reuse and no signature read', () => withReuse({}, async () => {
  const p = probe();
  for (let i = 0; i < 2; i++) assert.equal(await admitBySignature('k', p.options), 'verified');
  assert.deepEqual([p.verifications, p.signatures], [2, 0]);
}));

test('databases, tenants and generations never share a result, and the held set is bounded', () => withReuse({ limit: 2 }, async () => {
  const a = probe({ result: 'A' }), b = probe({ result: 'B' }), c = probe({ result: 'C' });
  assert.equal(await request(() => admitBySignature('tenant:h:1/db:t1:g1', a.options)), 'A');
  assert.equal(await request(() => admitBySignature('tenant:h:1/db:t2:g1', b.options)), 'B');
  assert.equal(await request(() => admitBySignature('tenant:h:1/db:t1:g1', a.options)), 'A');
  assert.deepEqual([a.verifications, b.verifications], [1, 1]);
  await request(() => admitBySignature('tenant:h:1/db:t1:g2', c.options)); // evicts the oldest entry (t1:g1)
  await request(() => admitBySignature('tenant:h:1/db:t1:g1', a.options));
  assert.equal(a.verifications, 2);
}));

test('inside one request the existing request-scoped reuse still asks once', () => withReuse({}, async () => {
  const p = probe();
  await request(async () => {
    for (let i = 0; i < 3; i++) assert.equal(await admitWithinRequest('k', () => admitBySignature('k', p.options)), 'verified');
  });
  assert.deepEqual([p.verifications, p.signatures], [1, 2]);
}));

test('the signature statement covers every catalog, the roles, the session and the Central ledger and marker', () => {
  const central = signatureSql(CENTRAL_DATA), tenant = signatureSql();
  for (const name of CATALOGS) for (const sql of [central, tenant]) assert.ok(sql.includes(`FROM pg_catalog.${name})`), name);
  for (const name of ['pg_class', 'pg_attribute', 'pg_proc', 'pg_policy', 'pg_trigger', 'pg_constraint', 'pg_index', 'pg_auth_members', 'pg_db_role_setting', 'pg_default_acl', 'pg_namespace', 'pg_extension'])
    assert.ok(CATALOGS.includes(name), name);
  for (const sql of [central, tenant]) {
    assert.match(sql, /FROM pg_catalog\.pg_roles r\)/);
    for (const part of ["current_setting('server_version_num')", 'current_database()', 'session_user', 'current_user']) assert.ok(sql.includes(part), part);
    assert.match(sql, /ctid::text\|\|':'\|\|xmin::text/);
  }
  assert.ok(central.includes('FROM public.c4g_schema_migration)') && central.includes('FROM public.c4g_database_identity)'));
  assert.ok(!tenant.includes('c4g_schema_migration'));
  assert.throws(() => signatureSql(['public.x; DROP TABLE y']), TypeError);
});

test('the Central signature is one statement and rejects a malformed answer', async () => {
  const sent = [];
  const client = { query: async sql => { sent.push(sql); return { rows: [{ signature: 'c'.repeat(32) }] }; } };
  assert.equal(await centralSignature(client), 'c'.repeat(32));
  assert.equal(sent.length, 1);
  await assert.rejects(centralSignature({ query: async () => ({ rows: [] }) }), /SCHEMA_SIGNATURE_INVALID/);
  await assert.rejects(centralSignature({ query: async () => ({ rows: [{ signature: 'not-a-hash' }] }) }), /SCHEMA_SIGNATURE_INVALID/);
});

test('the tenant signature depends on the runtime metadata and runs inside a savepoint', async () => {
  const sent = [];
  const client = { query: async sql => { sent.push(sql.startsWith('SELECT md5') ? 'SIGNATURE' : sql); return { rows: [{ signature: 'd'.repeat(32) }] }; } };
  const drained = await tenantSignature(client, async () => ({ flags: { legacy_drained: true } }));
  assert.deepEqual(sent, ['SAVEPOINT c4g_schema_signature', 'SIGNATURE', 'RELEASE SAVEPOINT c4g_schema_signature']);
  assert.match(drained, /^[a-f0-9]{64}$/);
  assert.equal(await tenantSignature(client, async () => ({ flags: { legacy_drained: true } })), drained);
  assert.notEqual(await tenantSignature(client, async () => ({ flags: { legacy_drained: false } })), drained);

  // A failure restores the transaction (and any role switch) before it surfaces.
  sent.length = 0;
  const failure = new Error('F4_METADATA_ROLE_RESTORE_FAILED');
  await assert.rejects(tenantSignature(client, async () => { throw failure; }), error => error === failure);
  assert.deepEqual(sent, ['SAVEPOINT c4g_schema_signature', 'SIGNATURE', 'ROLLBACK TO SAVEPOINT c4g_schema_signature', 'RELEASE SAVEPOINT c4g_schema_signature']);
});

test('the Central admission and the tenant observation go through the signature when reuse is on', () => withReuse({}, async () => {
  const preflight = require('../src/security/centralMigrationPreflight');
  const { knownManifest } = require('../src/security/centralMigrationManifest');
  const { assertAuthorityAdmission } = require('../src/security/authoritySecurityManifest');
  const { observeTenantRuntimeMetadata } = require('../src/security/tenantRuntimeMetadata');
  const admitted = knownManifest.findLast(entry => entry.authoritySecurityFingerprint).version;
  const original = preflight.preflightCentral; let preflights = 0;
  preflight.preflightCentral = async () => { preflights++; return { currentVersion: admitted, fingerprint: 'f'.repeat(64) }; };
  try {
    let catalog = 'a'.repeat(32);
    const central = { host: 'h', port: 5432, database: 'central', query: async sql => sql.startsWith('SELECT md5')
      ? { rows: [{ signature: catalog }] } : { rows: [{ session_user: 'c4g_authority_runtime', current_user: 'c4g_authority_runtime' }] } };
    for (let i = 0; i < 3; i++) assert.equal((await request(() => assertAuthorityAdmission(central))).currentVersion, admitted);
    assert.equal(preflights, 1);
    catalog = 'b'.repeat(32);
    await request(() => assertAuthorityAdmission(central));
    assert.equal(preflights, 2);
    // The login is still checked on every admission.
    const wrong = { ...central, query: async () => ({ rows: [{ session_user: 'postgres', current_user: 'postgres' }] }) };
    await assert.rejects(request(() => assertAuthorityAdmission(wrong)), /AUTHORITY_LOGIN_REQUIRED/);

    let flags = { legacy_drained: true, v1_complete: true }, observations = 0;
    const tenant = { host: 'h', port: 5432, database: 'tenant', query: async sql => sql.startsWith('SELECT md5') ? { rows: [{ signature: 'e'.repeat(32) }] }
      : sql.includes('runtime_metadata_v1') ? { rows: [{ metadata: { marker: {}, ledger: [], flags } }] } : { rows: [{ role: 'c4g_tenant_login' }] } };
    const expected = { tenantId: '3f2b8c1e-0000-4000-8000-000000000001', databaseGenerationId: '3f2b8c1e-0000-4000-8000-000000000002' };
    const observe = async () => { observations++; return { ok: observations }; };
    for (let i = 0; i < 3; i++) await request(() => observeTenantRuntimeMetadata(tenant, expected, { observe }));
    assert.equal(observations, 1);
    flags = { legacy_drained: false, v1_complete: true };
    await request(() => observeTenantRuntimeMetadata(tenant, expected, { observe }));
    assert.equal(observations, 2);
    await request(() => observeTenantRuntimeMetadata(tenant, { ...expected, databaseGenerationId: '3f2b8c1e-0000-4000-8000-000000000003' }, { observe }));
    assert.equal(observations, 3);
  } finally { preflight.preflightCentral = original; }
}));
