'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createDocumentRepository } = require('../src/documents/repository');
const organizationId = '12345678-1234-4234-8234-123456789012';
const versionId = '12345678-1234-4234-8234-123456789013';
const input = { organizationId, versionId, fromState: 'SCANNING', toState: 'AVAILABLE', scanState: 'CLEAN', lockVersion: 4,
  scanResult: { result: 'CLEAN', code: 'OOXML_STRUCTURAL_APPROVED', inputDigest: 'a'.repeat(64) } };
function fixture(insertCount = 1) {
  const calls = [];
  const client = { async query(sql, values) { calls.push({ sql, values });
    if (sql.includes('transition_version')) return { rowCount: 1, rows: [{ state: 'AVAILABLE' }] };
    if (sql.includes('INSERT INTO document_storage.scan_result')) return { rowCount: insertCount, rows: [] };
    return { rows: [] }; }, release() { calls.push({ sql: 'RELEASE' }); } };
  return { calls, repository: createDocumentRepository({ async connect() { return client; } }) };
}
test('scan evidence and version transition commit together with organization and digest binding', async () => {
  const { calls, repository } = fixture(); await repository.transition(input);
  const transition = calls.findIndex(call => call.sql.includes('transition_version'));
  const insert = calls.findIndex(call => call.sql.includes('INSERT INTO document_storage.scan_result'));
  assert(transition < insert); assert(insert < calls.findIndex(call => call.sql === 'COMMIT'));
  assert.deepEqual(calls[insert].values, [organizationId, versionId, 'CLEAN', 'OOXML_STRUCTURAL_APPROVED', 'a'.repeat(64)]);
  assert.match(calls[insert].sql, /v.organization_id=\$1 AND v.version_id=\$2 AND v.sha256=\$5/);
});
test('digest mismatch rolls back the availability transition', async () => {
  const { calls, repository } = fixture(0);
  await assert.rejects(repository.transition(input), /DOCUMENT_SCAN_CONTENT_MISMATCH/);
  assert(calls.some(call => call.sql === 'ROLLBACK')); assert(!calls.some(call => call.sql === 'COMMIT'));
});
test('inconsistent scan evidence is refused before a transition', async () => {
  const { calls, repository } = fixture();
  await assert.rejects(repository.transition({ ...input, scanResult: { ...input.scanResult, result: 'INFECTED' } }), /invalid/);
  assert(!calls.some(call => call.sql.includes('transition_version')));
});
