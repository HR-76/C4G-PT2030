'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {manifest,migrationSql}=require('../src/security/tenantMigrationManifest');
const {transactionControlStatements}=require('../src/security/sqlTransactionControl');
const {TENANT_SCHEMAS}=require('../src/security/tenantSchemaFingerprint');

const up=fs.readFileSync(path.resolve(__dirname,'../database/tenant/migrations/007_f13_profile_catalogs_and_policies.up.sql'),'utf8');
const down=fs.readFileSync(path.resolve(__dirname,'../database/tenant/migrations/007_f13_profile_catalogs_and_policies.down.sql'),'utf8');

test('F13 slice 2 registers an exact additive 007 foundation without functional capability',()=>{
 const entry=manifest[7];
 assert.equal(entry.version,'007_f13_profile_catalogs_and_policies');
 assert.equal(entry.ordinal,7);
 assert.equal(entry.sqlChecksum,migrationSql(entry.version,'up').checksum);
 assert.ok(entry.capabilities.includes('F13_PROFILE_CATALOG_FOUNDATION'));
 assert.equal(entry.capabilities.includes('F13_ORGANIZATIONAL_PROFILE'),false);
 assert.deepEqual(entry.compatibility.readVersions,['006_f13_p1_organizational_scope','007_f13_profile_catalogs_and_policies']);
 assert.deepEqual(entry.compatibility.writeVersions,['007_f13_profile_catalogs_and_policies']);
 assert.ok(TENANT_SCHEMAS.includes('organization_profile'));
});

test('F13 slice 2 SQL is runner-owned, seed-free and excludes later lifecycle storage',()=>{
 assert.deepEqual(transactionControlStatements(up),[]);
 assert.deepEqual(transactionControlStatements(down),[]);
 assert.match(up,/CREATE SCHEMA organization_profile/);
 assert.match(up,/CREATE TABLE organization_profile\.profile_scope/);
 for(const table of ['catalog_release','scheme','concept','concept_label','concept_relation','external_mapping',
  'metric_catalog_release','metric_definition','band_policy','derivation_policy','completion_policy','completion_slot',
  'completion_rule','projection_policy','purpose_catalog_release','purpose_catalog_entry','reason_catalog_release','reason_catalog_entry','compatibility_manifest','release_bundle'])
   assert.match(up,new RegExp(`CREATE TABLE organization_profile\\.${table}\\b`));
 assert.doesNotMatch(up,/\bINSERT\s+INTO\s+organization_profile\b/i);
 assert.doesNotMatch(up,/profile_draft|profile_version|effective_snapshot|activation_cohort|scope_activation_pointer|F13_ORGANIZATIONAL_PROFILE/i);
 assert.doesNotMatch(up,/\b(?:BEGIN|COMMIT|ROLLBACK|SAVEPOINT)\s*;/i);
 assert.match(up,/F13_PROFILE_007_DOWN_REFUSES_DATA_LOSS/);
 assert.ok(down.startsWith('SELECT organization_profile.assert_007_down_safe();'));
 assert.match(up,/SET row_security=off/);
 assert.match(up,/LOCK TABLE organization_profile\.%I IN ACCESS EXCLUSIVE MODE/);
 const downGuard=up.slice(up.indexOf('CREATE FUNCTION organization_profile.assert_007_down_safe()'));
 assert.match(downGuard,/purpose_catalog_release/);
 assert.match(downGuard,/reason_catalog_release/);
 const guardBody=downGuard.slice(0,downGuard.indexOf('END $$;'));
 assert.equal((guardBody.match(/'taxonomy_idempotency_record'/g)||[]).length,2,
  'idempotency-only data must be locked and checked before the schema can be dropped');
});

 test('F13 slice 3 grants taxonomy tables plus source-local idempotency and protects all tables with forced RLS',()=>{
 assert.match(up,/GRANT SELECT,INSERT,UPDATE ON organization_profile\.catalog_release,organization_profile\.scheme,organization_profile\.concept TO c4g_organization_profile_runtime/);
 assert.match(up,/GRANT SELECT,INSERT,UPDATE ON organization_profile\.concept_label,organization_profile\.concept_relation,organization_profile\.external_mapping TO c4g_organization_profile_runtime/);
 assert.match(up,/REVOKE DELETE,TRUNCATE ON ALL TABLES IN SCHEMA organization_profile FROM c4g_organization_profile_runtime/);
 assert.match(up,/ENABLE ROW LEVEL SECURITY/);
 assert.match(up,/FORCE ROW LEVEL SECURITY/);
 assert.match(up,/FOREIGN KEY\(organization_id,scope_id\) REFERENCES organizational_scope\.scope/);
 assert.match(up,/CREATE FUNCTION organization_profile\.guard_profile_scope_reference\(\)/);
 assert.match(up,/pg_advisory_xact_lock\(hashtextextended\('F13-P1:' \|\| NEW\.organization_id::text,43001301\)\)/);
 assert.match(up,/referenced_scope\.scope_type=NEW\.scope_type/);
 assert.match(up,/referenced_scope\.lifecycle='ACTIVE'/);
 assert.match(up,/GRANT SELECT \(organization_id,scope_id,scope_type,lifecycle\) ON organizational_scope\.scope/);
 assert.match(up,/profile_scope_organization_baseline/);
 assert.match(up,/profile_scope_exact_local/);
});

test('published F13 releases and policies protect their complete member graph',()=>{
 for(const trigger of ['scheme_release_immutable','concept_release_immutable','concept_label_release_immutable',
  'concept_relation_release_immutable','external_mapping_release_immutable','metric_definition_release_immutable',
  'band_policy_release_immutable','derivation_policy_release_immutable','completion_slot_policy_immutable',
  'completion_rule_policy_immutable','release_bundle_manifest_immutable','purpose_catalog_release_immutable',
  'reason_catalog_release_immutable','purpose_entry_immutable','reason_entry_immutable'])
  assert.match(up,new RegExp(`CREATE TRIGGER ${trigger}\\b`));
 assert.match(up,/BEFORE INSERT OR UPDATE OR DELETE ON organization_profile\.concept/);
 assert.match(up,/lifecycle IN \('PUBLISHED','SUPERSEDED','ARCHIVED'\)/);
 assert.match(up,/CREATE FUNCTION organization_profile\.guard_access_catalog_publication/);
 assert.match(up,/F13_PROFILE_CATALOG_PUBLICATION_INCOMPLETE/);
 assert.match(up,/CREATE FUNCTION organization_profile\.guard_access_catalog_member_immutability/);
 assert.match(up,/BEFORE INSERT OR UPDATE OR DELETE ON organization_profile\.purpose_catalog_entry/);
 assert.match(up,/BEFORE INSERT OR UPDATE OR DELETE ON organization_profile\.reason_catalog_entry/);
 assert.match(up,/F13_PROFILE_RELEASE_MEMBER_IMMUTABLE/);
 assert.match(up,/F13_PROFILE_POLICY_MEMBER_IMMUTABLE/);
 assert.match(up,/F13_PROFILE_MANIFEST_MEMBER_IMMUTABLE/);
 assert.match(up,/CREATE FUNCTION organization_profile\.lock_catalog_releases_mutable/);
 assert.match(up,/ORDER BY candidate\.release_id/);
 assert.match(up,/FROM organization_profile\.catalog_release[\s\S]*FOR UPDATE/);
 assert.match(up,/FROM organization_profile\.metric_catalog_release[\s\S]*FOR UPDATE/);
 assert.match(up,/FROM organization_profile\.completion_policy[\s\S]*FOR UPDATE/);
 assert.match(up,/FROM organization_profile\.compatibility_manifest[\s\S]*FOR UPDATE/);
 assert.match(up,/FROM organization_profile\.concept[\s\S]*FOR UPDATE/);
 assert.match(up,/CREATE FUNCTION organization_profile\.guard_concept_relation_graph/);
 assert.match(up,/F13_PROFILE_RELATION_DOMAIN_INVALID/);
 assert.match(up,/F13_PROFILE_RELATION_CYCLE/);
 assert.match(up,/WITH RECURSIVE reachable/);
 assert.match(up,/F13-TAXONOMY:/);
 assert.match(up,/43001302/);
 assert.match(up,/CREATE FUNCTION organization_profile\.guard_scheme_relation_contract/);
 assert.match(up,/F13_PROFILE_SCHEME_RELATION_DOMAIN_IMMUTABLE/);
 assert.match(up,/CREATE FUNCTION organization_profile\.reject_catalog_truncate\(\)/);
 assert.match(up,/BEFORE TRUNCATE ON organization_profile\.%I/);
 assert.match(up,/F13_PROFILE_TRUNCATE_FORBIDDEN/);
});
