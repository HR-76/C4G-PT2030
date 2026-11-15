'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { runtimeSecretProof, bindRuntimeIntent, ROLE } = require('../scripts/productionBootstrap/runtimeIntent');
test('private runtime proof binds all settings and secrets independent of key order', () => {
  const a = runtimeSecretProof({ a: 1, b: { c: 2 } }, { privateKey: 'synthetic-canary' });
  assert.match(a, /^[a-f0-9]{64}$/);
  assert.equal(a.includes('canary'), false);
  assert.equal(a, runtimeSecretProof({ b: { c: 2 }, a: 1 }, { privateKey: 'synthetic-canary' }));
  assert.notEqual(a, runtimeSecretProof({ a: 2, b: { c: 2 } }, { privateKey: 'synthetic-canary' }));
  assert.notEqual(a, runtimeSecretProof({ a: 1, b: { c: 2 } }, { privateKey: 'other' }));
});
function pool(existing) {
  const statements = [];
  return { statements, async connect() { return { release() {}, async query(sql) {
    statements.push(sql);
    if (sql.startsWith('SELECT r.')) return { rows: existing ? [existing] : [] };
    return { rows: [], rowCount: 0 };
  } }; } };
}
const inputs = { installationMarker: 'owned-installation', publicDigest: 'a'.repeat(64), material: 'b'.repeat(64) };
const row = () => ({ marker: 'owned-installation:runtime:' + 'a'.repeat(64), rolcanlogin: false, rolinherit: false,
  rolsuper: false, rolcreatedb: false, rolcreaterole: false, rolreplication: false, rolbypassrls: false, configured: false, edges: 0 });
test('runtime intent is stored only as a private SCRAM proof on a NOLOGIN role', async () => {
  const p = pool(null); let verified = false;
  await bindRuntimeIntent({ pool: p, ...inputs }, { verifyPassword: async (_, role, material) => { assert.equal(role, ROLE); assert.equal(material, inputs.material); verified = true; } });
  assert.equal(verified, true);
  assert.ok(p.statements.some(sql => /CREATE ROLE.*NOLOGIN.*PASSWORD/.test(sql)));
  assert.equal(p.statements.at(-1), 'COMMIT');
});
test('runtime replay never rotates private settings and refuses mismatched intent or privileges', async () => {
  const p = pool(row());
  await bindRuntimeIntent({ pool: p, ...inputs }, { verifyPassword: async () => {} });
  assert.equal(p.statements.some(sql => /CREATE ROLE|ALTER ROLE|COMMENT ON ROLE/.test(sql)), false);
  for (const invalid of [{ ...row(), marker: 'different' }, { ...row(), rolcanlogin: true }, { ...row(), edges: 1 }]) {
    await assert.rejects(bindRuntimeIntent({ pool: pool(invalid), ...inputs }, { verifyPassword: async () => assert.fail('must refuse before verification') }), /PRODUCTION_RUNTIME_INTENT_CONFLICT/);
  }
  await assert.rejects(bindRuntimeIntent({ pool: pool(row()), ...inputs }, { verifyPassword: async () => { throw Error('PRODUCTION_CREDENTIAL_MISMATCH'); } }), /CREDENTIAL_MISMATCH/);
});
