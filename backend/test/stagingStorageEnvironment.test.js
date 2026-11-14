'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { STORAGE_KEYS, storageEnvironment, apiPrivateEnvironment } = require('../scripts/staging/environment');
const { main } = require('../scripts/staging/install');

const SECRET = 'SECRET-ACCESS-KEY-VALUE-0123456789abcdef';
const values = Object.freeze({
  C4G_R2_ENDPOINT: 'https://0123456789abcdef.eu.r2.cloudflarestorage.com', C4G_R2_DOCUMENTS_BUCKET: 'c4g-staging-documents',
  C4G_R2_QUARANTINE_BUCKET: 'c4g-staging-quarantine', C4G_R2_ACCESS_KEY_ID: 'ACCESSKEYID0123456789', C4G_R2_SECRET_ACCESS_KEY: SECRET, C4G_R2_LAYER_C_VALIDATED: 'true'
});
const file = (delta = {}) => Object.entries({ ...values, ...delta }).filter(([, v]) => v !== undefined).map(([k, v]) => `${k}=${v}`).join('\n') + '\n';
const ready = Object.freeze({
  phase: 'READY', staging: { catalogPassword: 'c'.repeat(64), centralApiPassword: 'i'.repeat(64), centralWorkerPassword: 'k'.repeat(64) }, permitSecret: 'p'.repeat(64), sessionSecret: 's'.repeat(96), authorityPassword: 'a'.repeat(64),
  credentials: { tenantId: 't', credentialRef: 'x', connectionVersion: 1, host: 'c4g-postgres', port: 5432, database: 'c4g_tenant_staging', login: 'l', password: 'w'.repeat(64), ssl: true }
});

test('without a storage file nothing about storage is enabled', () => {
  assert.deepEqual(storageEnvironment(undefined), {});
  const text = apiPrivateEnvironment(ready, { host: 'c4g-postgres', centralDatabase: 'c4g_central_staging', administratorPassword: 'adm' });
  for (const name of [...STORAGE_KEYS, 'BILLING_PDF_RUNTIME', 'CENTRAL_PT2030_IMPORT_RUNTIME', 'C4G_CLAMAV_HOST']) assert.ok(!text.includes(name), name);
});

test('a complete EU storage file enables the loopback scanner, private billing PDFs and the PT2030 import', () => {
  const env = storageEnvironment(file());
  assert.deepEqual(Object.keys(env).sort(), [...STORAGE_KEYS, 'C4G_CLAMAV_HOST', 'C4G_CLAMAV_PORT', 'BILLING_PDF_RUNTIME', 'CENTRAL_PT2030_IMPORT_RUNTIME'].sort());
  assert.equal(env.C4G_CLAMAV_HOST, '127.0.0.1'); assert.equal(env.BILLING_PDF_RUNTIME, 'private'); assert.equal(env.CENTRAL_PT2030_IMPORT_RUNTIME, 'catalog');
  const text = apiPrivateEnvironment(ready, { host: 'c4g-postgres', centralDatabase: 'c4g_central_staging', administratorPassword: 'adm', storage: file() });
  assert.ok(text.includes(`C4G_R2_SECRET_ACCESS_KEY=${SECRET}`)); assert.ok(text.includes('BILLING_PDF_RUNTIME=private'));
  // Comments and blank lines are allowed.
  assert.equal(storageEnvironment('# R2\n\n' + file()).C4G_R2_DOCUMENTS_BUCKET, values.C4G_R2_DOCUMENTS_BUCKET);
});

test('an incomplete, unknown, duplicated or non-EU storage file is refused with a code that never carries the values', () => {
  const refuse = (text, code) => assert.throws(() => storageEnvironment(text), error => {
    assert.equal(error.code, code); assert.ok(!String(error.message).includes(SECRET)); return true;
  });
  refuse(file({ C4G_R2_SECRET_ACCESS_KEY: undefined }), 'STAGING_STORAGE_INCOMPLETE');
  // The declaration is the operator's: absent or anything but true is refused.
  refuse(file({ C4G_R2_LAYER_C_VALIDATED: undefined }), 'STAGING_STORAGE_INCOMPLETE');
  refuse(file({ C4G_R2_LAYER_C_VALIDATED: 'false' }), 'STAGING_STORAGE_VALIDATION_NOT_DECLARED');
  refuse(file() + 'EXTRA=1\n', 'STAGING_STORAGE_KEY_UNKNOWN');
  refuse(file() + `C4G_R2_SECRET_ACCESS_KEY=${SECRET}\n`, 'STAGING_STORAGE_INVALID');
  refuse(file({ C4G_R2_SECRET_ACCESS_KEY: 'has space' }), 'STAGING_STORAGE_INVALID');
  refuse(file({ C4G_R2_ENDPOINT: 'https://0123456789abcdef.r2.cloudflarestorage.com' }), 'STAGING_STORAGE_INVALID');
  refuse(file({ C4G_R2_ENDPOINT: 'http://0123456789abcdef.eu.r2.cloudflarestorage.com' }), 'STAGING_STORAGE_INVALID');
  refuse(file({ C4G_R2_QUARANTINE_BUCKET: values.C4G_R2_DOCUMENTS_BUCKET }), 'STAGING_STORAGE_INVALID');
  refuse('C4G_R2_ENDPOINT\n', 'STAGING_STORAGE_KEY_UNKNOWN');
});

test('the installer env command refuses a bad storage file before writing anything, and never prints the values', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'storage-'));
  try {
    const state = path.join(dir, 'install.json'); fs.writeFileSync(state, JSON.stringify(ready));
    const bad = path.join(dir, 'r2.env'); fs.writeFileSync(bad, file({ C4G_R2_ENDPOINT: 'https://example.com' }));
    const out = path.join(dir, 'out.env');
    const env = { POSTGRES_PASSWORD: 'adm', C4G_STAGING_STATE: state };
    await assert.rejects(() => main(['env', '--out', out, '--storage', bad], env), { code: 'STAGING_STORAGE_INVALID' });
    assert.ok(!fs.existsSync(out));
    const good = path.join(dir, 'good.env'); fs.writeFileSync(good, file());
    const result = await main(['env', '--out', out, '--storage', good], env);
    assert.ok(result.variables.includes('C4G_R2_SECRET_ACCESS_KEY')); assert.ok(!JSON.stringify(result).includes(SECRET));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('storage-check refuses a missing configuration with a code', async () => {
  await assert.rejects(() => main(['storage-check'], {}), { code: 'STAGING_STORAGE_INVALID' });
});

// The runtime must accept exactly what the installer generates, so a typo in a name here cannot reach the server unnoticed.
test('the generated variables are accepted by the billing PDF and PT2030 import runtimes', async () => {
  const env = { NODE_ENV: 'production', ...storageEnvironment(file()) }, pool = { connect: async () => { throw Error('unused'); }, query: async () => { throw Error('unused'); } };
  const billing = require('../src/customerBilling/pdfRuntime').configuredBillingPdfs({ pool, customerService: {}, env });
  const imports = require('../src/portugal2030/uploadRuntime').configuredCentralImport({ pool, env, authorityPolicy: { policyVersion: 'c4g-user-mfa-v1', requirement: { mfa: false, maxAgeSeconds: 300, acceptedAcr: ['c4g-loa1'], acceptedAmr: ['pwd'], amrMode: 'any' } } });
  try { assert.ok(billing && billing.service); assert.ok(imports); }
  finally { await billing?.close?.(); await imports?.close?.(); }
});
