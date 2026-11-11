'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { deriveVariant, OVERLAY_PATHS, sharedAllowed, bundleDigest, readFile, encodeZip, decodeZip } = require('../scripts/verify-central-snapshot-ab.cjs');
const { parseArgs, resolveDestination } = require('../scripts/prepare-central-snapshot-ab.cjs');

function fixture(t) {
  const root = fs.mkdtempSync(path.join(__dirname, '.central-ab-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}
function parent() { return new Map([...OVERLAY_PATHS.map(p => [p, Buffer.from('original:' + p)]), ['backend/src/untouched.js', Buffer.from('unchanged')]]); }
function overlays() { return new Map(OVERLAY_PATHS.map(p => [p, Buffer.from('candidate:' + p)])); }

test('B changes exactly the two authorized runtime sources, preserving A bytes', () => {
  const original = parent(), result = deriveVariant(original, overlays());
  assert.equal(result.size, original.size);
  assert.equal(result.get('backend/src/untouched.js'), original.get('backend/src/untouched.js'));
  for (const p of OVERLAY_PATHS) { assert.notDeepEqual(result.get(p), original.get(p)); assert.match(original.get(p).toString(), /^original:/); }
});
test('an extra runtime overlay, missing overlay, addition or no-op is refused', () => {
  const extra = overlays(); extra.set('backend/src/untouched.js', Buffer.from('other'));
  assert.throws(() => deriveVariant(parent(), extra), /AB_OVERLAY_SET/);
  const missing = overlays(); missing.delete(OVERLAY_PATHS[0]);
  assert.throws(() => deriveVariant(parent(), missing), /AB_OVERLAY_SET/);
  const absent = parent(); absent.delete(OVERLAY_PATHS[0]);
  assert.throws(() => deriveVariant(absent, overlays()), /AB_OVERLAY_PARENT/);
  const same = overlays(); same.set(OVERLAY_PATHS[0], parent().get(OVERLAY_PATHS[0]));
  assert.throws(() => deriveVariant(parent(), same), /AB_OVERLAY_UNCHANGED/);
});
test('shared capture permits named regressions and harness only, excluding runtime/config', () => {
  for (const p of ['test/integration/central-snapshot-ab/run.cjs', 'test/central-snapshot-ab-equivalence.test.cjs', 'backend/test/centralSchemaCatalogBatch.test.js']) assert.equal(sharedAllowed(p), true);
  for (const p of ['backend/src/security/centralSchemaManifest.js', 'backend/.env', 'backend/test/other.test.js', 'test/integration/central-snapshot-ab/token.key', 'test/integration/other/run.cjs']) assert.equal(sharedAllowed(p), false);
});
test('bundle identity binds both source sets and the common harness', () => {
  const base = { A: 'a'.repeat(64), B: 'b'.repeat(64), harness: 'c'.repeat(64) };
  const digest = bundleDigest(base);
  assert.equal(digest, bundleDigest({ harness: base.harness, B: base.B, A: base.A }));
  for (const key of Object.keys(base)) assert.notEqual(digest, bundleDigest({ ...base, [key]: 'd'.repeat(64) }));
});
test('archive round trip preserves bytes and rejects corruption', () => {
  const original = parent(), zip = encodeZip(original);
  assert.deepEqual(decodeZip(zip), new Map([...original].sort(([a],[b]) => a < b ? -1 : 1)));
  const corrupted = Buffer.from(zip); corrupted[40] ^= 1;
  assert.throws(() => decodeZip(corrupted));
});
test('source read rejects excluded actual targets and case variants', t => {
  const root = fixture(t); fs.writeFileSync(path.join(root, '.ENV'), 'not-captured');
  assert.throws(() => readFile(root, '.ENV'));
  fs.mkdirSync(path.join(root, '.cache')); fs.writeFileSync(path.join(root, '.cache', 'innocent.cjs'), 'not-captured');
  fs.symlinkSync(path.join(root, '.cache'), path.join(root, 'alias'), process.platform === 'win32' ? 'junction' : 'dir');
  assert.throws(() => readFile(root, 'alias/innocent.cjs'));
});
test('preparation requires explicit invocation and a new contained destination', t => {
  assert.deepEqual(parseArgs(['--prepare']), { prepare: true });
  for (const args of [[], ['--prepare','--force'], ['--measure-http']]) assert.throws(() => parseArgs(args));
  const root = fixture(t); fs.mkdirSync(path.join(root, 'output'));
  const target = resolveDestination(root, 'a'.repeat(32)); assert.equal(path.dirname(target), path.join(root, 'output'));
  fs.mkdirSync(target); assert.throws(() => resolveDestination(root, 'a'.repeat(32)), /AB_DESTINATION_EXISTS/);
});
test('preparation rejects an output junction outside the workspace', t => {
  const root = fixture(t), outside = fixture(t);
  fs.symlinkSync(outside, path.join(root, 'output'), process.platform === 'win32' ? 'junction' : 'dir');
  assert.throws(() => resolveDestination(root, 'a'.repeat(32)), /AB_DESTINATION_ESCAPE/);
  assert.deepEqual(fs.readdirSync(outside), []);
});
