'use strict';

// Context: context/features/staging-central-runtime-login.md (G1 restrito, Central 052). The package is explicit,
// SELECT-only, pinned to its exact bytes and kept out of the 051 chain.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { PACKAGE_ID, CENTRAL_BASELINE, entry } = require('../src/security/centralRuntimeReadPackage');
const manifest = require('../src/security/centralMigrationManifest');

const sql = fs.readFileSync(path.join(__dirname, '../database/central/candidates/central_runtime_read.up.sql'), 'utf8');

test('052 is pinned to its SQL bytes, after 051 and irreversible-free', () => {
  assert.equal(entry.version, '052_central_runtime_read');
  assert.equal(CENTRAL_BASELINE, '051_email_templates');
  assert.equal(entry.requiresPreflightVersion, '051_email_templates');
  assert.equal(entry.irreversible, false);
  assert.equal(crypto.createHash('sha256').update(fs.readFileSync(path.join(__dirname, '../database/central/candidates/central_runtime_read.up.sql'))).digest('hex'), entry.upChecksum);
  assert.match(entry.schemaFingerprint, /^[0-9a-f]{64}$/);
  assert.match(entry.authoritySecurityFingerprint, /^[0-9a-f]{64}$/);
});

test('the SQL grants SELECT only, and only to the central runtime role', () => {
  assert.match(sql, /^GRANT SELECT ON /m);
  assert.match(sql, /TO c4g_central_runtime;\s*$/);
  for (const forbidden of [/INSERT/i, /UPDATE/i, /DELETE/i, /TRUNCATE/i, /authority_/i, /ALL PRIVILEGES/i, /WITH GRANT OPTION/i, /BEGIN|COMMIT|ROLLBACK/i]) {
    assert.doesNotMatch(sql, forbidden);
  }
  for (const table of ['c4g_schema_migration', 'c4g_database_identity', 'global_user', 'organization', 'organization_membership', 'tenant', 'tenant_schema_state']) {
    assert.match(sql, new RegExp('public\\.' + table + '\\b'));
  }
});

test('the 051 chain never ends at 052, and 052 is the last step of its own chain', () => {
  assert.equal(manifest.knownManifest.at(-1).version, '051_email_templates');
  assert.equal(manifest.centralRuntimeReadManifest.at(-1).version, '052_central_runtime_read');
  assert.equal(manifest.centralRuntimeReadManifest.at(-2).version, '051_email_templates');
});

test('the explicit entrypoint refuses any other package id', async () => {
  const runner = require('../scripts/runCentralMigrations');
  await assert.rejects(() => runner.applyRegisteredCentralRuntimeReadPackage({}, 'email-templates-v1'), /CENTRAL_RUNTIME_READ_PACKAGE_NOT_REGISTERED/);
  assert.equal(PACKAGE_ID, 'central-runtime-read-v1');
});
