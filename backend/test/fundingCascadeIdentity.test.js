'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { createSource, normalizeRecord } = require('../src/fundingTenders/source');
const { reconciliationPlan } = require('../src/fundingTenders/reconciliation');
const { CASCADE_BASE } = require('../src/fundingTenders/identity');
const item = (id, type = '8') => ({ content: 'Call ' + id, metadata: { identifier: ['PARENT'], type: [type], callccm2Id: [id], frameworkProgramme: ['43251589'], deadlineDate: ['2099-01-01'] } });
test('cascade calls sharing a parent stay distinct; repeated versions of the same call collapse', async () => {
  const results = [item('11674'), item('11702'), item('11674'), item('1', '1')];
  const batch = await createSource({ fetchImpl: async () => new Response(JSON.stringify({ results })) }).collect();
  assert.deepEqual(batch.records.map(x => x.externalIdentifier), ['CASCADE:11674', 'CASCADE:11702', 'PARENT']);
  assert.ok(batch.records.every(x => x.fields.callReference === 'PARENT' && x.fields.programmeName === 'CERV'));
  assert.equal(batch.records[1].fields.officialUrl, CASCADE_BASE + '11702');
  assert.equal(batch.failed, 0);
});
test('cascade requires its own valid id and direct topics cannot impersonate the namespace', () => {
  for (const id of [undefined, '', '0', '01', '../1', '1?x', 123, '9'.repeat(41)]) assert.throws(() => normalizeRecord(item(id)), { code: 'SOURCE_RECORD_INVALID' });
  const direct = item('1', '1'); direct.metadata.identifier = ['CASCADE:11674'];
  assert.throws(() => normalizeRecord(direct), { code: 'SOURCE_RECORD_INVALID' });
  const esc = item('1', '1'); esc.metadata.frameworkProgramme = ['43254037'];
  assert.equal(normalizeRecord(esc).fields.programmeName, 'ESC');
});
const row = (key = 'PARENT', id = '11674') => ({ external_identifier: key, opportunity_id: 'fixed-uuid', current_revision_id: 'old-revision',
  last_source_fields: { title: 'Source', callReference: 'PARENT', officialUrl: CASCADE_BASE + id, programmeName: 'LIFE' },
  snapshot: { title: 'Manual', callReference: 'PARENT', officialUrl: CASCADE_BASE + id, programmeName: 'Custom programme' }, corrections: {} });
const evidence = [{ callReference: 'PARENT', sourceUrl: CASCADE_BASE + '11674', from: 'LIFE', rawProgrammeCode: '43251589' }];
test('reconciliation derives identity from source and preserves manual fields', () => {
  const input = row(); input.snapshot.officialUrl = 'https://example.invalid/manual';
  const { changes } = reconciliationPlan([input], evidence);
  assert.equal(changes[0].target, 'CASCADE:11674'); assert.equal(changes[0].row.opportunity_id, 'fixed-uuid');
  assert.equal(changes[0].incoming.programmeName, 'CERV');
  assert.equal(changes[0].merged.fields.programmeName, 'Custom programme');
  assert.equal(changes[0].merged.fields.title, 'Manual');
  assert.equal(changes[0].merged.fields.officialUrl, 'https://example.invalid/manual');
  assert.deepEqual(changes[0].merged.conflicts, ['officialUrl', 'programmeName', 'title']);
});
test('ambiguous destination, untrusted URL and stale programme evidence stop reconciliation', () => {
  assert.throws(() => reconciliationPlan([row(), row('OTHER')]), { code: 'FUNDING_IDENTITY_COLLISION' });
  const malformed = row(); malformed.last_source_fields.officialUrl = 'https://evil.invalid/competitive-calls-cs/11674';
  assert.throws(() => reconciliationPlan([malformed]), { code: 'FUNDING_IDENTITY_AMBIGUOUS' });
  assert.throws(() => reconciliationPlan([row('CASCADE:99')]), { code: 'FUNDING_IDENTITY_AMBIGUOUS' });
  const stale = row(); stale.last_source_fields.programmeName = 'UNKNOWN';
  assert.throws(() => reconciliationPlan([stale], evidence), { code: 'FUNDING_PROGRAMME_EVIDENCE_STALE' });
});
test('reconciliation is a no-op after key and source programme are corrected', () => {
  const input = row('CASCADE:11674'); input.last_source_fields.programmeName = 'CERV';
  assert.deepEqual(reconciliationPlan([input], evidence).changes, []);
});
