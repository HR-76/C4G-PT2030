'use strict';
// Creates an expiring, read-only input for per-identity OIDC preapproval.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { createHash, randomUUID } = require('node:crypto');
const { loadPackage } = require('../backend/src/opportunities/v2/euLegacyPreapproval');
const root = path.resolve(__dirname, '..');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const relative = file => path.relative(root, file).replaceAll('\\', '/');
async function main() {
  assert(process.argv.length === 3
    && /^output\/eu-legacy-migration-preview-[a-f0-9-]{36}\.json$/.test(process.argv[2]));
  const previewPath = path.resolve(root, process.argv[2]);
  assert(previewPath.startsWith(path.join(root, 'output') + path.sep));
  const previewBytes = fs.readFileSync(previewPath);
  const preview = JSON.parse(previewBytes);
  assert.equal(preview.status, 'REVIEW_ONLY');
  assert.equal(preview.scope.expected, 398);
  assert.equal(preview.scope.matchedCurrentHeads, 398);
  assert.equal(preview.scope.actions.CHANGE_REQUIRES_APPROVAL, 391);
  assert.equal(preview.scope.actions.NO_CANDIDATE, 7);
  const manifestPath = path.resolve(root, preview.evidenceManifest.path);
  assert(manifestPath.startsWith(path.join(root, 'output') + path.sep));
  const manifestBytes = fs.readFileSync(manifestPath);
  assert.equal(sha(manifestBytes), preview.evidenceManifest.sha256);
  const created = Date.now(), packageId = randomUUID();
  const plan = { kind: 'eu-legacy-preapproval-package-v1', packageId,
    createdAt: new Date(created).toISOString(), expiresAt: new Date(created + 3600000).toISOString(),
    preview: { path: relative(previewPath), sha256: sha(previewBytes) },
    manifest: { path: relative(manifestPath), sha256: sha(manifestBytes) } };
  // Validate every eligible identity and its official artifact before exposing
  // even a read-only package to the HTTP service.
  const folder = path.join(root, 'output', `eu-legacy-preapproval-${packageId}`);
  fs.mkdirSync(folder, { recursive: false });
  const file = path.join(folder, 'plan.json');
  fs.writeFileSync(file, JSON.stringify(plan, null, 2) + '\n', { flag: 'wx' });
  const bindings = new Map();
  try {
    for (const item of preview.entries.filter(entry => entry.action === 'CHANGE_REQUIRES_APPROVAL'))
      bindings.set(item.itemDigest, loadPackage(root, packageId, item.itemDigest).bindingDigest);
  } catch (error) {
    fs.unlinkSync(file);
    fs.rmdirSync(folder);
    throw error;
  }
  const columns = ['packageId', 'externalIdentifier', 'title', 'amounts', 'currencyStates',
    'action', 'reasonCodes', 'itemDigest', 'bindingDigest', 'expiresAt'];
  const cell = value => {
    const raw = String(value ?? ''), safe = /^[=+@\-\t\r]/.test(raw) ? "'" + raw : raw;
    return '"' + safe.replaceAll('"', '""') + '"';
  };
  const rows = preview.entries.map(item => ({
    packageId, externalIdentifier: item.externalIdentifier, title: item.title,
    amounts: item.amount?.map(amount => amount.amount).join(';'),
    currencyStates: item.amount?.map(amount => amount.currencyState).join(';'),
    action: item.action, reasonCodes: item.reasonCodes?.join(';'), itemDigest: item.itemDigest,
    bindingDigest: bindings.get(item.itemDigest), expiresAt: plan.expiresAt
  }));
  const queue = path.join(folder, 'queue.csv');
  fs.writeFileSync(queue, '\uFEFF' + [columns.join(','),
    ...rows.map(row => columns.map(key => cell(row[key])).join(','))].join('\r\n') + '\r\n', { flag: 'wx' });
  console.log(JSON.stringify({ status: 'PREAPPROVAL_READY', packageId, plan: relative(file),
    queue: relative(queue), expiresAt: plan.expiresAt, eligible: 391,
    approvalState: 'NOT_REQUESTED', databaseWrites: 0 }));
}
main().catch(error => { console.error(/^[A-Z0-9_]{3,100}$/.test(error?.code || '') ? error.code : 'EU_LEGACY_PREAPPROVAL_FAILED'); process.exitCode = 1; });
