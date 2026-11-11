'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { buildCapabilitySpecifications } = require('../src/security/tenantMigrationPreflight');
function specification(capabilities, schema) {
  return buildCapabilitySpecifications(new Set(capabilities)).find(item => item[1] === schema);
}
test('optional catalog tables accumulate while the highest-priority RLS threshold wins', () => {
  const [, , tables, rls] = specification(['ORGANIZATIONAL_OPPORTUNITY_INTERESTS', 'APPLICATION_DOCUMENT_REVIEW', 'F12_OPPORTUNITY_XLSX_IMPORT'], 'opportunity_catalog');
  assert.equal(rls, 40);
  for (const table of ['opportunity_interest', 'application_document_link', 'import_job']) assert.ok(tables.includes(table));
  assert.deepEqual(tables, [...tables].sort());
  assert.equal(specification([], 'opportunity_catalog')[3], 7);
});
test('profile capabilities accumulate and retain the historical priority order', () => {
  const [, , tables, rls] = specification(['F13_PQ1_PUBLICATION', 'F13_OPERATIONAL_CAPACITY', 'F13_FINANCIAL_CAPACITY'], 'organization_profile');
  assert.equal(rls, 68);
  for (const table of ['pq1_publication', 'operational_assertion', 'financial_assertion']) assert.ok(tables.includes(table));
  assert.deepEqual(tables, [...tables].sort());
  assert.equal(specification([], 'organization_profile')[3], 22);
});
test('document transport and personal profile add their tables and increase thresholds', () => {
  assert.equal(specification([], 'document_storage')[3], 4);
  assert.deepEqual(specification(['APPLICATION_DOCUMENT_TRANSPORT'], 'document_storage').slice(2).map((v, i) => i ? v : v.includes('multipart_upload')), [true, 5]);
  assert.equal(specification(['PERSONAL_PROFILE'], 'organizational_scope')[3], 7);
});
