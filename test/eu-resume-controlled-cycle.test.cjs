'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { input, evidence } = require('../scripts/eu-resume-controlled-cycle.cjs');

test('resume inputs are exactly a readiness preview and a backup preparation', () => {
  const id = randomUUID();
  assert.deepEqual(input([`--readiness=output/eu-resume-readiness-${id}.json`,
    `--backup=output/eu-legacy-acceptance-window-${id}/preparation.json`]),
  [`output/eu-resume-readiness-${id}.json`,
    `output/eu-legacy-acceptance-window-${id}/preparation.json`]);
  assert.throws(() => input([`--readiness=../${id}`, `--backup=output/${id}`]),
    { code: 'EU_RESUME_INPUT_INVALID' });
});

test('resume evidence requires fresh v2 inventory, healthy worker, idle source and verified backup', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'eu-resume-evidence-'));
  try {
    const now = Date.parse('2026-11-01T15:50:00Z'), id = randomUUID();
    const readinessPath = `output/eu-resume-readiness-${id}.json`;
    const backupPath = `output/eu-legacy-acceptance-window-${id}/preparation.json`;
    fs.mkdirSync(path.dirname(path.join(root, backupPath)), { recursive: true });
    const ready = { kind: 'eu-resume-readiness-v1', status: 'READY_FOR_AUTHENTICATED_CONTROLLED_CYCLE',
      checkedAt: new Date(now - 1000).toISOString(), centralVersion: '045_opportunity_eu_legacy_prearchive',
      source: { state: 'QUIESCED', fence: 7, canResume: true, pendingRuns: 0, activeLeases: 0 },
      worker: { state: 'PROCESSING', ready: true, capabilityMatch: true },
      inventory: { versions: [{ current_schema_version: 2, count: 529 }], legacy: Array(7).fill('legacy') } };
    const backup = { status: 'PASS', healthRestored: true, sourceResumed: false,
      completedAt: new Date(now - 2000).toISOString(), workBefore: { source: { state: 'QUIESCED', fence: 7 } } };
    const save = () => { fs.writeFileSync(path.join(root, readinessPath), JSON.stringify(ready));
      fs.writeFileSync(path.join(root, backupPath), JSON.stringify(backup)); };
    const args = [`--readiness=${readinessPath}`, `--backup=${backupPath}`]; save();
    assert.equal(evidence(args, now, root).ready.source.fence, 7);
    ready.inventory.legacy.push('unexpected'); save();
    assert.throws(() => evidence(args, now, root), { code: 'EU_RESUME_EVIDENCE_STALE' });
    ready.inventory.legacy.pop(); ready.checkedAt = new Date(now - 16 * 60 * 1000).toISOString(); save();
    assert.throws(() => evidence(args, now, root), { code: 'EU_RESUME_EVIDENCE_STALE' });
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
