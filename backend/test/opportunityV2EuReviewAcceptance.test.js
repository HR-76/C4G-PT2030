'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { load } = require('../src/opportunities/v2/euLegacyAcceptance');
const id = '01900000-0000-7000-8000-000000000001';
const sha = bytes => createHash('sha256').update(bytes).digest('hex');

test('EU REVIEW package is distinct from the 391 legacy package and excludes conflicts', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'c4g-eu-review-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const output = path.join(root, 'output'); fs.mkdirSync(output);
  const entries = Array.from({ length: 137 }, (_, n) => ({
    externalIdentifier: 'REVIEW-' + n, itemDigest: n.toString(16).padStart(64, '0'),
    action: 'CHANGE_REQUIRES_APPROVAL', archive: { kind: 'FUNDING', runId: id,
      externalIdentifier: 'REVIEW-' + n }, expected: { opportunityId: id,
      revisionId: id, rowVersion: 1 }
  }));
  const preview = { kind: 'eu-review-acceptance-preview-v1', status: 'REVIEW_ONLY',
    readOnly: true, databaseWrites: 0, scope: { heads: 137, candidates: 137, conflictsExcluded: 7 },
    sourceControl: { state: 'QUIESCED', fence: 7 }, entries };
  const previewPath = `output/eu-review-acceptance-preview-${id}.json`;
  const bytes = Buffer.from(JSON.stringify(preview)); fs.writeFileSync(path.join(root, previewPath), bytes);
  const folder = path.join(output, 'eu-legacy-acceptance-' + id); fs.mkdirSync(folder);
  const plan = { kind: 'eu-review-acceptance-package-v1', packageId: id,
    expiresAt: new Date(Date.now() + 60000).toISOString(), preview: { path: previewPath, sha256: sha(bytes) } };
  fs.writeFileSync(path.join(folder, 'plan.json'), JSON.stringify(plan));
  const loaded = load(root, id, entries[0].itemDigest);
  assert.equal(loaded.profile.label, 'EU_REVIEW_137');
  assert.equal(loaded.profile.review, true);
  assert.equal(loaded.eligible.length, 137);
  assert.equal(loaded.item.externalIdentifier, 'REVIEW-0');
  fs.writeFileSync(path.join(folder, 'plan.json'), JSON.stringify({ ...plan, kind: 'eu-legacy-acceptance-package-v1' }));
  assert.throws(() => load(root, id), { code: 'OPPORTUNITY_V2_LEGACY_ACCEPTANCE_CHANGED' });
});
