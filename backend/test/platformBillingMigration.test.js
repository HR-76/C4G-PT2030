'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const billingSql = require('../src/platformBilling/sql');
const { queries } = require('../src/security/authorityProtocolQueries');
const { resolveEvent } = require('../src/audit/eventCatalog');
const { manifest } = require('../src/security/centralMigrationManifest');

const migrations = path.resolve(__dirname, '../database/central/migrations');
const upPath = path.join(migrations, '027_platform_billing.up.sql');
const downPath = path.join(migrations, '027_platform_billing.down.sql');
const up = fs.readFileSync(upPath, 'utf8');

test('central billing migration is additive, irreversible and contains the nine approved relations', () => {
  assert.equal(fs.existsSync(downPath), false);
  assert.doesNotMatch(up, /^\s*(?:BEGIN|COMMIT)\s*;/im);
  assert.doesNotMatch(up, /\b(?:INSERT|UPDATE|DELETE)\s+(?:INTO\s+|FROM\s+)?public\.organization\b/i);
  for (const table of [
    'billing_account', 'billing_account_version', 'billing_cycle', 'billing_cycle_revision',
    'billing_fiscal_document', 'billing_fiscal_document_revision', 'billing_payment_record',
    'billing_activity', 'billing_command_receipt'
  ]) {
    assert.match(up, new RegExp(`CREATE TABLE public\\.${table} \\(`));
    assert.match(up, new RegExp(`ALTER TABLE public\\.%I OWNER TO c4g_authority_owner`));
  }
});

test('billing fingerprints are captured with the fixed non-login local schema owner', () => {
  const entry = manifest.find(item => item.version === '027_platform_billing');
  assert.equal(entry.schemaFingerprint, '21ea761a468dd301d923ddcb03a22be7c8eabd558d3829ac1e023cac70b0516b');
  assert.equal(entry.authoritySecurityFingerprint, '6ffce0530152e20ee383019c8efd728ef1f66c2385978c04290ec49a6fdd5243');
  const probe = fs.readFileSync(path.resolve(__dirname,
    '../../test/integration/platform-billing/migration-probe.js'), 'utf8');
  assert.match(probe, /SET SESSION AUTHORIZATION c4g_f12_admin/);
  assert.match(probe, /ALTER ROLE c4g_f12_admin NOSUPERUSER NOCREATEROLE NOCREATEDB NOLOGIN/);
});

test('money, currency and civil dates have database-level representations and closed states', () => {
  assert.doesNotMatch(up, /\b(?:real|double precision|money)\b/i);
  assert.match(up, /numeric\(20,6\)/);
  assert.match(up, /currency ~ '\^\[A-Z\]\{3\}\$'/);
  assert.match(up, /period_start date NOT NULL/);
  assert.match(up, /effective_on date NOT NULL/);
  for (const state of ['DRAFT', 'READY_TO_ISSUE', 'ISSUED', 'CREDITED', 'CANCELLED']) {
    assert.match(up, new RegExp(`'${state}'`));
  }
});

test('all billing queries are exact authority allowlist entries materialized by migration 027', () => {
  for (const sql of Object.values(billingSql)) {
    assert.equal(queries.includes(sql), true);
    const code = createHash('sha256').update(sql).digest('hex');
    assert.match(up, new RegExp(`WHEN '${code}'`));
    assert.match(up, new RegExp(sql.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replaceAll("'", "''")));
  }
  assert.match(up, /AUTHORITY_QUERY_DENIED/);
  assert.match(up, /authority_api\.execute_platform_billing\(query_code,parameters\)/);
  assert.match(up, /'PLATFORM_ONBOARDING','PLATFORM_BILLING'/);
  assert.match(up, /PLATFORM_AUDIT_PATCH_POINT_INVALID/);
});

test('authority triggers, immutable history and payment race guards are part of the schema', () => {
  assert.match(up, /authority_first_lock/);
  assert.match(up, /authority_write_guard/);
  assert.match(up, /billing_require_authority_write/);
  assert.match(up, /'ORG:'\|\|COALESCE\(new_row->>'organization_id'/);
  assert.match(up, /authority_effect_commit_guard/);
  assert.match(up, /zz_billing_immutable/);
  assert.match(up, /BILLING_PAYMENT_EXCEEDS_BALANCE/);
  assert.match(up, /BILLING_REVERSAL_INVALID/);
  assert.match(up, /BILLING_DEBIT_CANCELLATION_EXCEEDS_BALANCE/);
  assert.match(up, /net_paid>corrected_total\+debited_total-NEW\.total-credited_total/);
  assert.match(up, /FOR UPDATE/);
  assert.match(up, /UNIQUE\(organization_id,operation_code,idempotency_key\)/);
  assert.match(up, /REVOKE ALL ON public\.%I FROM PUBLIC,c4g_central_runtime,c4g_authority_runtime/);
  assert.match(up, /GRANT SELECT\(id,display_name,legal_name,status\) ON public\.organization TO c4g_central_runtime/);
});

test('billing audit vocabulary is central and contains no financial or fiscal payload fields', () => {
  for (const code of [
    'PLATFORM_BILLING_ACCOUNT_CHANGED', 'PLATFORM_BILLING_CYCLE_CHANGED',
    'PLATFORM_BILLING_DOCUMENT_RECORDED', 'PLATFORM_BILLING_DOCUMENT_CHANGED',
    'PLATFORM_BILLING_PAYMENT_RECORDED', 'PLATFORM_BILLING_PAYMENT_REVERSED'
  ]) {
    const event = resolveEvent(code);
    assert.equal(event.residencyRule, 'CENTRAL_AUTHORITY');
    for (const forbidden of ['amount', 'taxIdentifier', 'billingEmail', 'documentNumber', 'notes']) {
      assert.equal(event.payloadFields.includes(forbidden), false);
    }
    assert.match(up, new RegExp(`'${code}'`));
  }
});
