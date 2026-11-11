const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const manifest = require('../src/security/tenantMigrationManifest');

test('migração 039 está registada depois da 038, com checksum do ficheiro e capacidade própria', () => {
  const chain = manifest.documentDeletionManifest;
  const entry = chain.at(-1);
  assert.equal(entry.version, manifest.DOCUMENT_DELETION_SCHEMA_VERSION);
  assert.equal(entry.ordinal, 39);
  assert.equal(chain.at(-2).version, manifest.APPLICATION_TASK_DETAILS_SCHEMA_VERSION);
  assert.ok(entry.capabilities.includes('DOCUMENT_DELETION'));
  assert.ok(manifest.allRegisteredMigrations.includes(entry));
  const file = path.resolve(__dirname, '../database/tenant/migrations/039_document_deletion.up.sql');
  const sql = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
  assert.equal(crypto.createHash('sha256').update(sql, 'utf8').digest('hex'), entry.sqlChecksum);
  assert.equal(manifest.migrationSql(entry.version, 'up').checksum, entry.sqlChecksum);
  assert.throws(() => manifest.migrationSql(entry.version, 'down'), /irreversible/);
});

test('migração 039 contém só as funções de eliminação, com papel proprietário e sem acesso público', () => {
  const sql = fs.readFileSync(path.resolve(__dirname, '../database/tenant/migrations/039_document_deletion.up.sql'), 'utf8');
  assert.match(sql, /SET ROLE c4g_document_owner;/);
  assert.match(sql, /RESET ROLE;\s*$/);
  for (const name of ['begin_document_deletion', 'cancel_document_deletion', 'finish_document_deletion']) {
    assert.match(sql, new RegExp(`CREATE FUNCTION document_storage\\.${name}`));
    assert.match(sql, new RegExp(`GRANT EXECUTE ON FUNCTION[^;]*${name}[^;]*TO c4g_document_runtime`));
  }
  assert.match(sql, /REVOKE ALL ON FUNCTION[^;]*FROM PUBLIC/);
  assert.equal((sql.match(/SECURITY DEFINER SET search_path=pg_catalog,document_storage/g) || []).length, 3);
});
