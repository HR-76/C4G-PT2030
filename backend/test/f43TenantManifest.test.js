const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const {
  TENANT_BASELINE_VERSION, TENANT_CATALOG_VERSION, canonicalizeTenantMigrationSql,
  DOCUMENT_TRANSPORT_TENANT_DOWNGRADE, DOCUMENT_WORKER_TENANT_DOWNGRADE, manifest, migrationSql, requiredTenantMigrations, validateTenantLedger,
  validateTenantMigrationManifest
} = require('../src/security/tenantMigrationManifest');
const { transactionControlStatements } = require('../src/security/sqlTransactionControl');
test('013 is RESERVED metadata only; 012 to 014 requires this explicit reservation',()=>{
  const {TENANT_MIGRATION_RESERVATIONS}=require('../src/security/tenantMigrationManifest');
  assert.deepEqual(TENANT_MIGRATION_RESERVATIONS,[{ordinal:13,version:'013_f13_constraints_and_epistemic_states',status:'RESERVED'}]);
  assert.throws(()=>migrationSql(TENANT_MIGRATION_RESERVATIONS[0].version,'up'),/not registered/);
  assert.throws(()=>validateTenantMigrationManifest(manifest,migrationSql,[]),/not explicitly reserved/);
  const rows=requiredTenantMigrations().map(r=>({migration_id:r.migrationId,ordinal:r.ordinal,checksum_sha256:r.checksum,irreversible:r.irreversible,resulting_fingerprint:r.resultingFingerprint}));
  assert.equal(validateTenantLedger(rows).currentVersion,'033_organizational_opportunity_interests');
  assert.throws(()=>validateTenantLedger([...rows.slice(0,13),{...rows[13],migration_id:TENANT_MIGRATION_RESERVATIONS[0].version,ordinal:13},rows[13]]));
});

test('tenant manifest is cumulative through admitted organizational interests 033 with explicit compatibility', () => {
  assert.equal(TENANT_BASELINE_VERSION, '000_tenant_control_baseline');
  assert.equal(TENANT_CATALOG_VERSION, 'tenant-read-only-bootstrap-v1');
  assert.equal(Object.isFrozen(manifest), true);
  assert.equal(manifest.length, 33);
  assert.equal(manifest[0].ordinal, 0);
  assert.equal(manifest[0].irreversible, true);
  assert.equal(manifest[0].sqlChecksum, migrationSql(TENANT_BASELINE_VERSION, 'up').checksum);
  assert.deepEqual(manifest[0].compatibility.readVersions, [TENANT_BASELINE_VERSION]);
  assert.deepEqual(manifest[0].compatibility.writeVersions, [TENANT_BASELINE_VERSION]);
  assert.deepEqual(manifest.map(entry => entry.version), [
    '000_tenant_control_baseline', '001_f9_async_execution', '002_f7_append_only_audit',
    '003_f11_private_document_storage', '004_f12_opportunity_catalog', '005_f9_execution_lineage',
    '006_f13_p1_organizational_scope', '007_f13_profile_catalogs_and_policies', '008_f13_profile_authoring_and_assertions', '009_f13_competencies_and_experience','010_f13_financial_capacity','011_f13_operational_capacity','012_f13_territories_and_populations','014_f4_runtime_metadata_access','015_f12_opportunity_xlsx_import','016_f13_editorial_baseline_publication','017_opportunity_evidenced_criteria','018_f13_pq1_publication','019_f13_pq1_activation','020_f14_pq1_decisions','021_application_first_slice','022_application_team_tasks','023_application_documents_review','024_application_central_origin','025_organization_directory','026_personal_profile','027_application_lifecycle','028_application_partners','029_application_alerts','030_organization_notices','031_application_document_transport','032_document_worker_runtime','033_organizational_opportunity_interests'
  ]);
  assert.deepEqual(manifest.at(-1).capabilities, [
    'TENANT_CONTROL_BASELINE', 'F9_ASYNC_EXECUTION', 'F7_AUDIT_LEDGER',
    'F11_PRIVATE_DOCUMENT_STORAGE', 'F12_PRIVATE_CATALOG_READ',
    'F12_PRIVATE_CATALOG_WRITE', 'F12_DEDUPLICATION', 'F9_EXECUTION_LINEAGE',
    'F13_P1_ORGANIZATIONAL_SCOPE', 'F13_PROFILE_CATALOG_FOUNDATION','F13_PROFILE_AUTHORING','F13_COMPETENCIES_AND_EXPERIENCE','F13_FINANCIAL_CAPACITY','F13_OPERATIONAL_CAPACITY','F13_TERRITORIES_AND_POPULATIONS','F4_RUNTIME_METADATA_ACCESS','F12_OPPORTUNITY_XLSX_IMPORT','F13_EDITORIAL_BASELINE_PUBLICATION','OPPORTUNITY_EVIDENCED_CRITERIA','F13_PQ1_PUBLICATION','F13_PQ1_ACTIVATION','F14_PQ1_CONSUMPTION','F14_PQ1_DECISIONS','APPLICATION_FIRST_SLICE','APPLICATION_TEAM_TASKS','APPLICATION_DOCUMENT_REVIEW','APPLICATION_CENTRAL_ORIGIN','ORGANIZATION_DIRECTORY','PERSONAL_PROFILE','APPLICATION_LIFECYCLE','APPLICATION_PARTNERS','APPLICATION_ALERTS','ORGANIZATION_NOTICES','APPLICATION_DOCUMENT_TRANSPORT','DOCUMENT_WORKER_RUNTIME','ORGANIZATIONAL_OPPORTUNITY_INTERESTS'
  ]);
  for (const entry of manifest) {
    if(entry.ordinal<6){assert.deepEqual(entry.compatibility.readVersions, [entry.version]);assert.deepEqual(entry.compatibility.writeVersions, [entry.version]);}
    assert.equal(entry.sqlChecksum, migrationSql(entry.version, 'up').checksum);
  }
  assert.deepEqual(manifest[6].compatibility.readVersions,['005_f9_execution_lineage','006_f13_p1_organizational_scope']);
  assert.deepEqual(manifest[6].compatibility.writeVersions,['006_f13_p1_organizational_scope']);
  assert.deepEqual(manifest.at(-1).compatibility.readVersions,['033_organizational_opportunity_interests']);
  assert.deepEqual(manifest.at(-1).compatibility.writeVersions,['033_organizational_opportunity_interests']);
  assert.equal(DOCUMENT_TRANSPORT_TENANT_DOWNGRADE.downChecksum,
    migrationSql('031_application_document_transport','down').checksum);
  assert.equal(DOCUMENT_WORKER_TENANT_DOWNGRADE.downChecksum,
    migrationSql('032_document_worker_runtime','down').checksum);
  assert.equal(validateTenantMigrationManifest(), true);
  assert.throws(() => migrationSql(TENANT_BASELINE_VERSION, 'down'), /irreversible/);
});
test('tenant migration canonicalization is LF-only, BOM-free and ledger metadata is exact', () => {
  assert.equal(canonicalizeTenantMigrationSql('a\r\nb\n'), 'a\nb\n');
  assert.throws(() => canonicalizeTenantMigrationSql('\ufeffSELECT 1'), /BOM/);
  const requirement = requiredTenantMigrations()[0];
  const row = {
    migration_id: requirement.migrationId,
    ordinal: requirement.ordinal,
    checksum_sha256: requirement.checksum,
    irreversible: requirement.irreversible,
    resulting_fingerprint: requirement.resultingFingerprint
  };
  assert.equal(validateTenantLedger([row]).currentVersion, TENANT_BASELINE_VERSION);
  for (const change of [
    { ordinal: 1 }, { migration_id: '999_unknown' }, { checksum_sha256: '0'.repeat(64) },
    { irreversible: false }, { resulting_fingerprint: '1'.repeat(64) }
  ]) assert.throws(() => validateTenantLedger([{ ...row, ...change }]), /differs|unknown/);
});

test('tenant migrations leave transaction control exclusively to the canonical runner', () => {
  for (const entry of manifest) {
    assert.doesNotMatch(migrationSql(entry.version, 'up').sql, /\b(?:BEGIN|COMMIT)\s*;/i);
    if (!entry.irreversible) assert.doesNotMatch(migrationSql(entry.version, 'down').sql, /\b(?:BEGIN|COMMIT)\s*;/i);
  }
  const sql = 'BEGIN; SELECT 1; COMMIT;';
  const malicious = Object.freeze({ ...manifest[0],
    sqlChecksum: crypto.createHash('sha256').update(sql).digest('hex') });
  const entries = Object.freeze([malicious]);
  assert.throws(() => validateTenantMigrationManifest(entries, () => ({
    entry: malicious, sql, checksum: malicious.sqlChecksum
  })), /transaction control/);
});

test('tenant transaction scanner rejects every top-level boundary and accepts procedural bodies', () => {
  const forbidden = [
    'BEGIN;', ' begin work ;', 'BEGIN TRANSACTION;', '-- allowed comment\nSTART TRANSACTION;',
    'COMMIT;', 'commit work;', 'END;', 'ROLLBACK;', 'ABORT;', 'SAVEPOINT x;',
    'RELEASE SAVEPOINT x;', 'ROLLBACK TO SAVEPOINT x;', 'SET TRANSACTION READ ONLY;',
    'SET CONSTRAINTS ALL DEFERRED;'
  ];
  for (const direction of ['up','down']) for (const sql of forbidden) {
    const safe='SELECT 1;';
    const up=direction==='up'?sql:safe;
    const down=direction==='down'?sql:safe;
    const entry=Object.freeze({...manifest[0],irreversible:false,sqlChecksum:crypto.createHash('sha256').update(up).digest('hex')});
    assert.throws(()=>validateTenantMigrationManifest(Object.freeze([entry]),(_version,requested)=>{
      const source=requested==='down'?down:up;
      return {entry,sql:source,checksum:crypto.createHash('sha256').update(source).digest('hex')};
    }),/transaction control/);
  }
  for(const sql of [
    "DO $$ BEGIN RAISE NOTICE 'COMMIT;'; END $$;",
    "CREATE FUNCTION x() RETURNS void LANGUAGE plpgsql AS $$ BEGIN PERFORM 1; END $$;",
    "SELECT 'ROLLBACK;'; -- BEGIN;\nSELECT 1;",
    '/* START TRANSACTION; */ SELECT 1;'
  ]) assert.deepEqual(transactionControlStatements(sql),[]);
});

test('tenant ledger accepts only the exact historical 001 checksum', () => {
  const required=requiredTenantMigrations();
  const rows=required.slice(0,2).map(item=>({migration_id:item.migrationId,ordinal:item.ordinal,
    checksum_sha256:item.checksum,irreversible:item.irreversible,resulting_fingerprint:item.resultingFingerprint}));
  rows[1].checksum_sha256='f8fe97640f3d2caa39e0e8bba98a0dc5d4c4b8c0c0ea6872de571a8ca5d61819';
  assert.equal(validateTenantLedger(rows).currentVersion,'001_f9_async_execution');
  rows[1].checksum_sha256='1'.repeat(64);
  assert.throws(()=>validateTenantLedger(rows),/differs/);
});

test('tenant ledger rejects the historical executor-owned 005 fingerprint', () => {
  const rows=requiredTenantMigrations().slice(0,6).map(item=>({
    migration_id:item.migrationId,
    ordinal:item.ordinal,
    checksum_sha256:item.checksum,
    irreversible:item.irreversible,
    resulting_fingerprint:item.resultingFingerprint
  }));
  assert.equal(validateTenantLedger(rows).currentVersion,'005_f9_execution_lineage');
  rows[5].resulting_fingerprint='cd001ae58e1e982233f64976811ec9b629293ae883045b40e0e491ee3e824fed';
  assert.throws(()=>validateTenantLedger(rows),/differs/);
});

test('tenant baseline SQL contains only control objects and no product or UBI schema', () => {
  const root = path.resolve(__dirname, '../database/tenant/migrations');
  const up = fs.readFileSync(path.join(root, '000_tenant_control_baseline.up.sql'), 'utf8');
  const down = fs.readFileSync(path.join(root, '000_tenant_control_baseline.down.sql'), 'utf8');
  assert.match(up, /CREATE SCHEMA c4g_system/);
  assert.match(up, /CREATE SCHEMA c4g_app/);
  assert.match(up, /CREATE TABLE c4g_system\.tenant_identity/);
  assert.match(up, /CREATE TABLE c4g_system\.schema_migration/);
  assert.match(up, /append-only/);
  assert.doesNotMatch(up, /organization_id|binding_digest|faculty|research_center|opportunit|application/i);
  assert.match(down, /irreversible/i);
  assert.doesNotMatch(down, /DROP\s+(?:SCHEMA|TABLE)/i);
});

test('manifest validation rejects mutable, duplicated and inconsistent declarations atomically', () => {
  assert.throws(() => validateTenantMigrationManifest([...manifest]), /frozen/);
  const duplicate = Object.freeze([manifest[0], manifest[0]]);
  assert.throws(() => validateTenantMigrationManifest(duplicate), /invalid/);
  const badCompatibility = Object.freeze({
    readVersions: Object.freeze(['999_unknown']),
    writeVersions: Object.freeze([TENANT_BASELINE_VERSION])
  });
  const entry = Object.freeze({ ...manifest[0], compatibility: badCompatibility });
  assert.throws(() => validateTenantMigrationManifest(Object.freeze([entry])), /compatibility/);
  assert.throws(() => validateTenantMigrationManifest(manifest, version => ({
    entry: manifest.find(item => item.version === version), checksum: '0'.repeat(64)
  })), /source/);
});
