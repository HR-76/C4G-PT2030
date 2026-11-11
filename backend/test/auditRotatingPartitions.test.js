'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const policy = require('../src/security/auditPartitionPolicy');

// Monthly audit partitions rotate. The pinned schema fingerprints must keep covering the two
// partitions created by the baseline migrations and must ignore any later event_YYYY_MM.
test('baseline partitions stay fingerprinted; later monthly partitions rotate out of it', () => {
  for (const name of ['event_2026_10', 'event_2026_11']) assert.equal(policy.isRotatingAuditPartition(name), false);
  for (const name of ['event_2026_12', 'event_2027_01', 'event_2030_09', 'event_2026_09']) {
    assert.equal(policy.isRotatingAuditPartition(name), true, name);
  }
});

test('only well-formed monthly names rotate; everything else stays in the fingerprint', () => {
  for (const name of ['event', 'event_default', 'event_identity', 'chain_head', 'checkpoint', 'event_2026_13',
    'event_2026_00', 'event_26_12', 'event_2026_12_x', 'x_event_2026_12', 'event_2026_1']) {
    assert.equal(policy.isRotatingAuditPartition(name), false, name);
  }
});

test('qualified and split references are resolved only inside the audit schema', () => {
  assert.equal(policy.isRotatingAuditTable('audit.event_2026_12'), true);
  assert.equal(policy.isRotatingAuditTable('event_2026_12'), false, 'unqualified public tables are never audit partitions');
  assert.equal(policy.isRotatingAuditTable('async_exec.event_2026_12'), false);
  assert.equal(policy.isRotatingAuditTable('audit.event_2026_11'), false);
  assert.equal(policy.isRotatingAuditTable(undefined), false);
});

test('omit helpers drop only rotating partition rows and preserve order and identity of the rest', () => {
  const rows = [
    { table_name: 'audit.event' }, { table_name: 'audit.event_2026_10' }, { table_name: 'audit.event_2026_12' },
    { table_name: 'audit.event_default' }, { table_name: 'memberships' }, { table_name: 'audit.event_2027_01' }
  ];
  const kept = policy.omitRotatingAuditPartitions(rows);
  assert.deepEqual(kept.map(row => row.table_name), ['audit.event', 'audit.event_2026_10', 'audit.event_default', 'memberships']);
  assert.equal(kept[0], rows[0]);
  const split = [{ schema_name: 'audit', table_name: 'event_2026_12' }, { schema_name: 'audit', table_name: 'event' },
    { schema_name: 'public', table_name: 'event_2026_12' }];
  assert.deepEqual(policy.omitRotatingAuditPartitions(split, row => `${row.schema_name}.${row.table_name}`)
    .map(row => `${row.schema_name}.${row.table_name}`), ['audit.event', 'public.event_2026_12']);
});

test('snapshots and the tenant capability check use the shared policy', () => {
  const read = file => fs.readFileSync(path.resolve(__dirname, '../src/security', file), 'utf8');
  for (const file of ['centralSchemaManifest.js', 'tenantSchemaFingerprint.js', 'tenantMigrationPreflight.js']) {
    assert.match(read(file), /auditPartitionPolicy/, file);
  }
});

test('audit preflight refuses event_YYYY_MM tables that are not partitions of audit.event', async () => {
  const { auditPreflight } = require('../src/audit/preflight');
  const answers = (strayPartitions) => ({
    async query(sql) {
      if (/FROM pg_roles/.test(sql)) {
        return { rows: ['c4g_audit_owner', 'c4g_audit_writer', 'c4g_audit_reader', 'c4g_audit_verifier', 'c4g_audit_migrator']
          .map(rolname => ({ rolname, rolcanlogin: false, rolsuper: false })) };
      }
      if (/FROM pg_tables/.test(sql)) {
        return { rows: ['chain_head', 'checkpoint', 'event', 'event_2026_10', 'event_2026_11', 'event_default', 'event_identity']
          .map(tablename => ({ tablename })) };
      }
      if (/FROM pg_proc/.test(sql)) {
        return { rows: ['prepare_append_v1', 'append_event_v1'].map(proname => ({ proname, prosecdef: true, proconfig: ['search_path=pg_catalog, audit'] })) };
      }
      if (/role_table_grants/.test(sql)) return { rows: [] };
      if (/pg_policies/.test(sql)) return { rows: [{ policyname: 'audit_event_org_read' }, { policyname: 'audit_event_owner_append' }] };
      if (/pg_trigger/.test(sql)) {
        return { rows: ['audit_event_no_update_delete', 'audit_event_no_truncate', 'audit_identity_no_update_delete', 'audit_checkpoint_no_update_delete']
          .map(tgname => ({ tgname })) };
      }
      if (/pg_has_role/.test(sql)) return { rows: [{ allowed: true }] };
      if (/pg_inherits/.test(sql)) return { rows: strayPartitions.map(relname => ({ relname })) };
      throw new Error(`unexpected query: ${sql}`);
    }
  });
  assert.equal((await auditPreflight(answers([]))).ready, true);
  await assert.rejects(() => auditPreflight(answers(['event_2027_01'])), /AUDIT_SCHEMA_PREFLIGHT_FAILED/);
});
