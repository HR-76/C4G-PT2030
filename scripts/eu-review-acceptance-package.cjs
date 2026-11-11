'use strict';
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { createHash, randomUUID } = require('node:crypto');
const root = path.resolve(__dirname, '..');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
async function main(argv = process.argv.slice(2)) {
  assert(argv.length === 1 && /^output\/eu-review-acceptance-preview-[a-f0-9-]{36}\.json$/.test(argv[0]));
  const bytes = fs.readFileSync(path.join(root, argv[0]));
  const preview = JSON.parse(bytes);
  assert.equal(preview.kind, 'eu-review-acceptance-preview-v1');
  assert.equal(preview.status, 'REVIEW_ONLY');
  assert.deepEqual(preview.scope, { heads: 137, candidates: 137, conflictsExcluded: 7 });
  assert.equal(preview.sourceControl.state, 'QUIESCED');
  assert.equal(Number(preview.sourceControl.fence), 7);
  assert.equal(preview.entries.filter(e => e.action === 'CHANGE_REQUIRES_APPROVAL').length, 137);
  const id = randomUUID(), created = Date.now();
  const folder = path.join(root, 'output', `eu-legacy-acceptance-${id}`);
  fs.mkdirSync(folder);
  const plan = { kind: 'eu-review-acceptance-package-v1', packageId: id,
    createdAt: new Date(created).toISOString(), expiresAt: new Date(created + 3600000).toISOString(),
    preview: { path: argv[0], sha256: sha(bytes) } };
  fs.writeFileSync(path.join(folder, 'plan.json'), JSON.stringify(plan, null, 2) + '\n', { flag: 'wx' });
  console.log(JSON.stringify({ status: 'READY_FOR_OIDC_REVIEW', packageId: id,
    expiresAt: plan.expiresAt, eligible: 137, excluded: 7, databaseWrites: 0 }));
}
if (require.main === module) main().catch(() => { console.error('EU_REVIEW_ACCEPTANCE_PACKAGE_FAILED'); process.exitCode = 1; });
module.exports = { main };
