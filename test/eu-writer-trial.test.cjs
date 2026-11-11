'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { sha, hashSources, encodeZip, decodeZip, safeRelative, readFile, verifyFiles, verifySourceTree, verifyInstalledDependencies, deriveSources, OVERLAYS } = require('../scripts/verify-eu-writer-trial.cjs');
const { collectExtensions, parseArgs, resolveDestination } = require('../scripts/prepare-eu-writer-trial.cjs');

function temporary(t) {
  const parent = fs.realpathSync(os.tmpdir()), root = fs.mkdtempSync(path.join(parent, 'c4g-eu-trial-'));
  t.after(() => { const actual = fs.realpathSync(root); assert.equal(path.dirname(actual), parent); assert(path.basename(actual).startsWith('c4g-eu-trial-')); fs.rmSync(actual, { recursive: true, force: true }); });
  const write = (file, data) => { const target = path.join(root, file); fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, data); };
  return { root, write };
}

test('stored ZIP round trip preserves bytes and is deterministic independent of insertion order', () => {
  const first = new Map([['backend/a.js', Buffer.from('a\r\n')], ['frontend/b.json', Buffer.from('{"b":1}\n')]]);
  const zip = encodeZip(first);
  assert.deepEqual(zip, encodeZip(new Map([...first].reverse())));
  assert.deepEqual(decodeZip(zip), first);
  assert.equal(hashSources(Object.fromEntries([...first].map(([p, b]) => [p, sha(b)]))), hashSources(Object.fromEntries([...first].reverse().map(([p, b]) => [p, sha(b)]))));
});

test('ZIP rejects corrupt content, truncation and trailing bytes before extraction', () => {
  const zip = encodeZip(new Map([['backend/a.js', Buffer.from('safe source')]]));
  const corrupt = Buffer.from(zip); corrupt[30 + Buffer.byteLength('backend/a.js')] ^= 1;
  for (const candidate of [corrupt, zip.subarray(0, zip.length - 1), Buffer.concat([zip, Buffer.from('extra')])]) assert.throws(() => decodeZip(candidate), error => /^TRIAL_ZIP_/.test(error.code));
});

test('paths reject traversal, secret/dependency/build inputs and case variants; only exact public template is allowed', () => {
  for (const p of ['../x', '/x', 'C:/x', 'backend\\x', 'backend//x', 'backend/../x', '.env', 'backend/.ENV.example', 'backend/.env.local', 'backend/.env.production.example', 'NODE_MODULES/a.js', '.AWS/credentials', '.git/config', 'dist/a.js', 'certs/a.key', 'certs/a.pem']) assert.throws(() => safeRelative(p), error => /^TRIAL_/.test(error.code), p);
  assert.equal(safeRelative('backend/.env.example'), 'backend/.env.example');
  assert.equal(safeRelative('backend/scripts/localPlatform/config.js'), 'backend/scripts/localPlatform/config.js');
});

test('ZIP refuses duplicate paths differing only by case and excluded paths', () => {
  assert.throws(() => encodeZip(new Map([['backend/A.js', Buffer.from('a')], ['backend/a.js', Buffer.from('b')]])), { code: 'TRIAL_DUPLICATE_PATH' });
  assert.throws(() => encodeZip(new Map([['backend/.env', Buffer.from('synthetic')]])), { code: 'TRIAL_EXCLUDED_PATH' });
});

test('source verification is read-only and rejects drift or missing inputs', t => {
  const f = temporary(t); f.write('backend/a.js', 'approved');
  const sources = { 'backend/a.js': sha('approved') }, before = structuredClone(sources);
  assert.equal(verifyFiles(f.root, sources), 1); assert.deepEqual(sources, before);
  f.write('backend/a.js', 'changed'); assert.throws(() => verifyFiles(f.root, sources), { code: 'TRIAL_SOURCE_CHANGED' });
  fs.unlinkSync(path.join(f.root, 'backend/a.js')); assert.throws(() => verifyFiles(f.root, sources), { code: 'TRIAL_FILE_MISSING' });
});

test('aliases cannot escape root or bypass excluded target directories', t => {
  const f = temporary(t), external = temporary(t); external.write('a.js', 'outside'); f.write('node_modules/a.js', 'synthetic dependency');
  for (const [name, target, code] of [['outside', external.root, 'TRIAL_PATH_ESCAPE'], ['internal', path.join(f.root, 'node_modules'), 'TRIAL_EXCLUDED_PATH']]) {
    fs.symlinkSync(target, path.join(f.root, name), process.platform === 'win32' ? 'junction' : 'dir');
    assert.throws(() => readFile(f.root, name + '/a.js'), { code });
  }
});

test('a source tree cannot acquire untracked executable or environment files; declared dependency/build directories are outside its identity', t => {
  const f = temporary(t); f.write('backend/a.js', 'approved'); f.write('backend/node_modules/dependency/index.js', 'dependency'); f.write('frontend/dist/index.html', 'build');
  const sources = { 'backend/a.js': sha('approved') }; verifySourceTree(f.root, sources);
  f.write('backend/extra.js', 'untracked'); assert.throws(() => verifySourceTree(f.root, sources), { code: 'TRIAL_UNTRACKED_SOURCE' });
  fs.unlinkSync(path.join(f.root, 'backend/extra.js')); f.write('backend/.env', 'synthetic'); assert.throws(() => verifySourceTree(f.root, sources), { code: 'TRIAL_EXCLUDED_PATH' });
});

test('runtime dependency verification checks declared versions through explicit dependency junctions and refuses mismatches', t => {
  const f = temporary(t), installed = temporary(t); installed.write('example/package.json', '{"version":"1.2.3"}');
  fs.mkdirSync(path.join(f.root, 'backend')); fs.symlinkSync(installed.root, path.join(f.root, 'backend/node_modules'), process.platform === 'win32' ? 'junction' : 'dir');
  const metadata = { 'backend/package.json': { installedVersions: { example: '1.2.3' } } };
  assert.deepEqual(verifyInstalledDependencies(f.root, metadata), { status: 'PASS', checkedVersions: 1, treeBytesPinned: false });
  installed.write('example/package.json', '{"version":"2.0.0"}'); assert.throws(() => verifyInstalledDependencies(f.root, metadata), { code: 'TRIAL_INSTALLED_DEPENDENCY_VERSION_CHANGED' });
});

test('derivation changes only approved overlays and retains parent bytes for other workspace changes', () => {
  const parent = new Map([['backend/a.js', Buffer.from('parent')], ['backend/b.js', Buffer.from('frozen')]]);
  const overlay = new Map([['backend/a.js', Buffer.from('corrected')]]);
  const policy = { 'backend/a.js': { before: sha('parent'), after: sha('corrected') } };
  const derived = deriveSources(parent, [new Map([['test/fixture.json', Buffer.from('{}')]])], overlay, new Map([['test/new.test.cjs', Buffer.from('test')]]), policy);
  assert.equal(derived.get('backend/a.js').toString(), 'corrected'); assert.equal(derived.get('backend/b.js').toString(), 'frozen');
  assert.equal(parent.get('backend/a.js').toString(), 'parent'); assert.equal(derived.size, 4);
  assert.throws(() => deriveSources(parent, [], new Map(), new Map(), policy), { code: 'TRIAL_OVERLAY_SET_MISMATCH' });
  assert.throws(() => deriveSources(parent, [], new Map([['backend/a.js', Buffer.from('unexpected')]]), new Map(), policy), { code: 'TRIAL_OVERLAY_HASH_MISMATCH' });
  assert.throws(() => deriveSources(parent, [], overlay, new Map([['backend/b.js', Buffer.from('parallel change')]]), policy), { code: 'TRIAL_ADDITION_REPLACES_SOURCE' });
});

test('a separately pinned overlay template must be archived and identical to its target overlay',()=>{
 const target='backend/a.js',template='test/integration/eu-writer-performance/application-composition.candidate.cjs';
 const parent=new Map([[target,Buffer.from('parent')]]),overlays=new Map([[target,Buffer.from('minimal change')]]);
 const policy={[target]:{before:sha('parent'),after:sha('minimal change'),sourceOverride:template}};
 assert.throws(()=>deriveSources(parent,[],overlays,new Map(),policy),{code:'TRIAL_OVERLAY_TEMPLATE_MISMATCH'});
 assert.throws(()=>deriveSources(parent,[],overlays,new Map([[template,Buffer.from('parallel change')]]),policy),{code:'TRIAL_OVERLAY_TEMPLATE_MISMATCH'});
 const result=deriveSources(parent,[],overlays,new Map([[template,Buffer.from('minimal change')]]),policy);assert.equal(result.get(target).toString(),result.get(template).toString());
});

test('default overlay policy contains exactly the approved Tenant034 source/regression and scoped responsible directory', () => {
  assert.deepEqual(Object.keys(OVERLAYS).sort(), ['backend/src/applications/composition.js', 'backend/src/opportunities/httpComposition.js', 'backend/test/opportunityV2ConsumerAdmission.test.js']);
  assert.equal(OVERLAYS['backend/src/opportunities/httpComposition.js'].after, '1389118396991de48b1a1d3fb04524aedf8fc20e2051760b3df49c6b7472eff4');
  assert.equal(OVERLAYS['backend/src/applications/composition.js'].after, '2796dd3fe64ef4482c265f39886331cdd37a5d86c5d3038111aa6da6e8270f4a');
  assert.equal(OVERLAYS['backend/src/applications/composition.js'].sourceOverride, 'test/integration/eu-writer-performance/application-composition.candidate.cjs');
});

test('extension enumeration admits only the new performance area, selected test names and explicit contract/tools', t => {
  const f = temporary(t);
  for (const p of ['test/integration/eu-writer-performance/run.cjs', 'test/integration/eu-writer-performance/protocol.json', 'test/eu-writer-performance-runner.test.cjs', 'test/eu-writer-trial.test.cjs', 'test/eu-writer-window.test.cjs', 'scripts/eu-writer-window.cjs', 'scripts/prepare-eu-writer-trial.cjs', 'scripts/verify-eu-writer-trial.cjs', 'context/features/eu-writer-performance-executors.md']) f.write(p, 'synthetic');
  const files = collectExtensions(f.root);
  assert.equal(files.length, 7); assert(!files.some(p => p.includes('window')));
  f.write('test/integration/eu-writer-performance/.env', 'synthetic'); assert.throws(() => collectExtensions(f.root), { code: 'TRIAL_EXCLUDED_PATH' });
});

test('preparation requires explicit invocation and rejects arbitrary CLI destinations', () => {
  assert.deepEqual(parseArgs(['--prepare']), { prepare: true });
  for (const args of [[], ['--prepare', '--root', '..'], ['--prepare', '--overwrite'], ['--inspect']]) assert.throws(() => parseArgs(args), { code: 'TRIAL_EXPLICIT_PREPARE_REQUIRED' });
});

test('preparation refuses an output directory aliased outside the workspace before creating anything', t => {
  const f = temporary(t), outside = temporary(t), id = '1'.repeat(32);
  fs.symlinkSync(outside.root, path.join(f.root, 'output'), process.platform === 'win32' ? 'junction' : 'dir');
  assert.throws(() => resolveDestination(f.root, id), { code: 'TRIAL_DESTINATION_ESCAPE' });
  assert.deepEqual(fs.readdirSync(outside.root), []);
});

test('preparation resolves a contained output directory and refuses an existing trial destination', t => {
  const f = temporary(t), id = '2'.repeat(32); fs.mkdirSync(path.join(f.root, 'output'));
  const target = resolveDestination(f.root, id); assert.equal(target, path.join(f.root, 'output', 'eu-writer-trial-' + id));
  fs.mkdirSync(target); assert.throws(() => resolveDestination(f.root, id), { code: 'TRIAL_DESTINATION_EXISTS' });
});
