'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { verifyBaseline, hashSourceSet } = require('../scripts/verify-eu-writer-baseline.cjs');

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const clone = value => structuredClone(value);
const pkgPath = 'backend/src/security/opportunityEuWriterMigrationPackage.js';
const legacyPath = 'backend/src/security/opportunityV2MigrationPackage.js';
const sqlPath = 'backend/database/central/candidates/opportunity_eu_writer_v2.up.sql';

function fixture(t) {
  const temporaryRoot = fs.realpathSync(os.tmpdir());
  const root = fs.mkdtempSync(path.join(temporaryRoot, 'c4g-writer-baseline-test-'));
  t.after(() => {
    const target = fs.realpathSync(root);
    assert.equal(path.dirname(target), temporaryRoot);
    assert.ok(path.basename(target).startsWith('c4g-writer-baseline-test-'));
    fs.rmSync(target, { recursive: true, force: true });
  });
  const write = (file, content) => { const target = path.join(root, file); fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, content); };
  const files = { [pkgPath]: 'synthetic package source', [legacyPath]: 'synthetic preserved package', [sqlPath]: 'SELECT 1;\r\n' };
  for (const [file, content] of Object.entries(files)) write(file, content);
  write('output/sources.zip', 'synthetic archive bytes');
  const sources = Object.fromEntries(Object.entries(files).map(([file, content]) => [file, hash(content)]));
  const entry = { version: '043_opportunity_eu_writer_v2', irreversible: true, acceptsHistoricalCrlfChecksum: false,
    requiresPreflightVersion: '042_opportunity_eu_source_control_v2', requiresCatalogSecurityFingerprint: 'a'.repeat(64),
    upChecksum: hash('SELECT 1;\n'), schemaFingerprint: 'b'.repeat(64), authoritySecurityFingerprint: 'c'.repeat(64),
    catalogSecurityFingerprint: 'd'.repeat(64), euWriterSecurityFingerprint: 'e'.repeat(64) };
  const pkg = { packageId: 'opportunity-eu-writer-v2', version: entry.version, centralBaseline: entry.requiresPreflightVersion,
    legacyPackageDigest: '4f83267f1c2d3f41c604453f3489136397f661fbc06a99de8b79ed2980674e7a', sqlPath, entry,
    ...Object.fromEntries(['upChecksum', 'schemaFingerprint', 'authoritySecurityFingerprint', 'catalogSecurityFingerprint', 'euWriterSecurityFingerprint'].map(key => [key, entry[key]])) };
  pkg.packageDigest = hash(JSON.stringify({ packageId: pkg.packageId, centralBaseline: pkg.centralBaseline, entry }));
  const sourceSetDigest = hashSourceSet(sources);
  const manifest = { schemaVersion: 1, id: 'eu-writer-v2-' + sourceSetDigest.slice(0, 16), sourceSetDigest, sources,
    archive: { path: 'output/sources.zip', sha256: hash('synthetic archive bytes') }, package: pkg };
  const repin = m => { m.sourceSetDigest = hashSourceSet(m.sources); m.id = 'eu-writer-v2-' + m.sourceSetDigest.slice(0, 16); return m; };
  return { root, write, manifest, repin, run: m => verifyBaseline(m || manifest, { root }) };
}

test('verifies pinned source/archive/SQL bytes without changing any file; CRLF is canonicalized only for SQL', t => {
  const f = fixture(t), before = clone(f.manifest);
  assert.equal(f.run().status, 'PASS');
  assert.equal(f.run().sourceCount, 3);
  assert.deepEqual(f.manifest, before);
  assert.equal(fs.readFileSync(path.join(f.root, sqlPath), 'utf8'), 'SELECT 1;\r\n');
});

test('source digest is deterministic when JSON object keys are reordered', t => {
  const f = fixture(t), reordered = Object.fromEntries(Object.entries(f.manifest.sources).reverse());
  assert.equal(hashSourceSet(reordered), f.manifest.sourceSetDigest);
  assert.equal(f.run({ ...f.manifest, sources: reordered }).status, 'PASS');
});

test('rejects changed and missing files without recalculating the approved identity', t => {
  const f = fixture(t);
  f.write(pkgPath, 'changed');
  assert.throws(() => f.run(), { code: 'BASELINE_SOURCE_CHANGED' });
  fs.unlinkSync(path.join(f.root, pkgPath));
  assert.throws(() => f.run(), { code: 'BASELINE_FILE_MISSING' });
});

test('rejects invalid/escaping paths and sensitive or installed dependency paths', t => {
  const f = fixture(t);
  for (const file of ['../outside', '/absolute', 'C:/outside', 'backend\\file', 'backend/../file', 'backend//file', '.env', 'backend/.env.local', 'node_modules/file', '.git/config']) {
    const m = clone(f.manifest); m.sources = { [file]: 'a'.repeat(64) };
    assert.throws(() => f.run(m), error => ['BASELINE_INVALID_PATH', 'BASELINE_EXCLUDED_PATH'].includes(error.code), file);
  }
});

test('excludes sensitive and dependency path segments regardless of case', () => {
  for (const file of ['backend/.ENV', 'backend/.ENV.local', '.GIT/config', 'NODE_MODULES/package/file.js', '.AWS/credentials']) {
    assert.throws(() => hashSourceSet({ [file]: 'a'.repeat(64) }), { code: 'BASELINE_EXCLUDED_PATH' }, file);
  }
});

test('rejects internal directory aliases that resolve into excluded paths', t => {
  const f = fixture(t);
  for (const [index, protectedDirectory] of ['backend/node_modules', 'backend/.git', 'backend/.env'].entries()) {
    f.write(protectedDirectory + '/file.js', 'synthetic protected file');
    const alias = 'ordinary-alias-' + index;
    fs.symlinkSync(path.join(f.root, protectedDirectory), path.join(f.root, alias), process.platform === 'win32' ? 'junction' : 'dir');
    const m = clone(f.manifest); m.sources[alias + '/file.js'] = hash('synthetic protected file'); f.repin(m);
    assert.throws(() => f.run(m), { code: 'BASELINE_EXCLUDED_PATH' }, protectedDirectory);
  }
});

test('preserves internal aliases to ordinary source directories', t => {
  const f = fixture(t);
  f.write('ordinary-source/file.js', 'ordinary source file');
  fs.symlinkSync(path.join(f.root, 'ordinary-source'), path.join(f.root, 'ordinary-alias'), process.platform === 'win32' ? 'junction' : 'dir');
  const m = clone(f.manifest); m.sources['ordinary-alias/file.js'] = hash('ordinary source file'); f.repin(m);
  assert.equal(f.run(m).status, 'PASS');
});

test('rejects archive drift and archive path escape independently of unchanged sources', t => {
  const f = fixture(t);
  f.write('output/sources.zip', 'changed archive');
  assert.throws(() => f.run(), { code: 'BASELINE_ARCHIVE_CHANGED' });
  const m = clone(f.manifest); m.archive.path = '../archive.zip';
  assert.throws(() => f.run(m), { code: 'BASELINE_INVALID_PATH' });
});

test('rejects symlink/junction outside the workspace before reading target content', t => {
  const f = fixture(t), outside = fixture(t);
  outside.write('external.txt', 'external file');
  fs.symlinkSync(outside.root, path.join(f.root, 'link'), process.platform === 'win32' ? 'junction' : 'dir');
  const m = clone(f.manifest); m.sources['link/external.txt'] = hash('external file'); f.repin(m);
  assert.throws(() => f.run(m), { code: 'BASELINE_PATH_ESCAPE' });
});

test('rejects inconsistent package identity, entry digest and legacy package digest', t => {
  const f = fixture(t);
  for (const mutation of [m => { m.package.version = '044_other'; }, m => { m.package.legacyPackageDigest = '0'.repeat(64); }, m => { m.package.entry.schemaFingerprint = '0'.repeat(64); }]) {
    const m = clone(f.manifest); mutation(m);
    assert.throws(() => f.run(m), error => ['BASELINE_INVALID_PACKAGE', 'BASELINE_INVALID_PACKAGE_ENTRY'].includes(error.code));
  }
  const m = clone(f.manifest); m.package.packageDigest = '0'.repeat(64);
  assert.throws(() => f.run(m), { code: 'BASELINE_PACKAGE_DIGEST_MISMATCH' });
});

test('rejects changed SQL even when raw source manifest was repinned without reviewing the package', t => {
  const f = fixture(t), m = clone(f.manifest);
  f.write(sqlPath, 'SELECT 2;\n');
  m.sources[sqlPath] = hash('SELECT 2;\n'); f.repin(m);
  assert.throws(() => f.run(m), { code: 'BASELINE_SQL_CHECKSUM_MISMATCH' });
});

test('rejects malformed manifests, missing package sources and changed source-set digest', t => {
  const f = fixture(t);
  assert.throws(() => f.run({ ...f.manifest, schemaVersion: 2 }), { code: 'BASELINE_INVALID_MANIFEST' });
  assert.throws(() => f.run({ ...f.manifest, sourceSetDigest: '0'.repeat(64) }), { code: 'BASELINE_IDENTITY_MISMATCH' });
  const m = clone(f.manifest); delete m.sources[legacyPath]; f.repin(m);
  assert.throws(() => f.run(m), { code: 'BASELINE_PACKAGE_SOURCES_MISSING' });
  assert.throws(() => hashSourceSet({}), { code: 'BASELINE_INVALID_SOURCES' });
});
