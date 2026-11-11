'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { validateFeatureCapabilities, buildCapabilitySpecifications } = require('../src/security/tenantMigrationPreflight');
function lineageClient(evidence, outbox = { schema_usage: true, enqueue: true, destructive: false }) {
 const capabilities = ['F9_ASYNC_EXECUTION', 'F9_EXECUTION_LINEAGE'];
 const specifications = buildCapabilitySpecifications(new Set(capabilities));
 const queries = [];
 return { queries, async query(sql, args) {
  queries.push(sql);
  if (sql.includes('AS table_name')) {
   const specification = specifications.find(item => item[1] === args[0]);
   return { rows: specification && capabilities.includes(specification[0]) ? specification[2].map(table_name => ({ table_name, rls: false })) : [] };
  }
  if (sql.includes('SELECT a.attname')) return { rows: Array.from({ length: 8 }, () => ({})) };
  if (sql.includes(' AS execution_index')) return { rows: evidence };
  if (sql.includes("'async_exec','USAGE'")) return { rows: outbox ? [outbox] : [] };
  throw new Error('Unexpected SQL');
 } };
}
const complete = { execution_index: true, replay_index: true, immutable_guard: true, legacy_drained: true, v1_complete: true };
test('lineage accepts complete security evidence and refuses missing or false evidence', async () => {
 const entry = { capabilities: ['F9_ASYNC_EXECUTION', 'F9_EXECUTION_LINEAGE'] };
 await validateFeatureCapabilities(lineageClient([complete]), entry);
 for (const evidence of [[], [{}], [{ ...complete, immutable_guard: false }], [{ ...complete, v1_complete: null }], [{ execution_index: true }]]) {
  await assert.rejects(validateFeatureCapabilities(lineageClient(evidence), entry), { internalCode: 'CAPABILITY_EVIDENCE_MISMATCH' });
 }
});

test('lineage rejects absent, incomplete or destructive outbox permissions', async () => {
 const entry = { capabilities: ['F9_ASYNC_EXECUTION', 'F9_EXECUTION_LINEAGE'] };
 for (const grant of [null, {}, { schema_usage: false, enqueue: true, destructive: false },
  { schema_usage: true, enqueue: false, destructive: false }, { schema_usage: true, enqueue: true },
  { schema_usage: true, enqueue: true, destructive: null }, { schema_usage: true, enqueue: true, destructive: true }]) {
  await assert.rejects(validateFeatureCapabilities(lineageClient([complete], grant), entry), { internalCode: 'CAPABILITY_EVIDENCE_MISMATCH' });
 }
});
