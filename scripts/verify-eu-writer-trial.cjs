'use strict';
// Read-only source/archive verification. No application module, gate or service is loaded.
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const sha = value => createHash('sha256').update(value).digest('hex');
const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const HASH = /^[a-f0-9]{64}$/;
const PINS = Object.freeze({
  parentId: 'eu-writer-v2-d2898861a25b4f6e',
  parentDigest: 'd2898861a25b4f6e4dcb7d4ec91cc42830042ea7bdcbeb3efb56ee5adcdea7b3',
  parentManifest: '1346a1856fd3760adb32be8b900a12e8ec0a96b90b9de212102d3c69fe3e0426',
  parentArchive: '9f33fc940ce4cb42786cd6938cb2c0ca3037b5dd0d8b7e3323e83688c30eae4b',
  supplements: Object.freeze([
    Object.freeze({ name: 'public-test-fixtures-supplement', manifest: '771425e691049e23d143074f17c472a64167c2714041282a7951a0ba693df00f', archive: 'a933b40d638d377d5876d4c1da9809fb18cabbc4b86ca1e8c73dfa364e96ba57', count: 5 }),
    Object.freeze({ name: 'additional-test-inputs-supplement-v2', manifest: 'b507604cd75691ea867c5e3a4295c357068dbf5d47fa045cc1689fbedb89c648', archive: 'e5237f12e833fba5ea6598de779478ea1422a6ef7881aa11f6d964ddd2bf5151', count: 11 })
  ])
});
const OVERLAYS = Object.freeze({
  'backend/src/applications/composition.js': Object.freeze({ before: 'cec6036997941ebf27a1f4cdef370e7699eda7eed401b6f7cb083bbaa66bf0ca', after: '2796dd3fe64ef4482c265f39886331cdd37a5d86c5d3038111aa6da6e8270f4a', sourceOverride: 'test/integration/eu-writer-performance/application-composition.candidate.cjs' }),
  'backend/src/opportunities/httpComposition.js': Object.freeze({ before: '2f4168b371fa603fee8ceba84c56d4c89ecc76dd59dc4aecf0c9f7af32ecc854', after: '1389118396991de48b1a1d3fb04524aedf8fc20e2051760b3df49c6b7472eff4' }),
  'backend/test/opportunityV2ConsumerAdmission.test.js': Object.freeze({ before: '4de7b4006bf271337202848e04aa68e77dd86b12dd188a6edd5da9d5f1f8cac7', after: '7e95752d7b58168c5367c75b74881e67cb131fe653f6bea0c20486cf70e9125a' })
});
const EXPLICIT_EXTENSIONS = Object.freeze(['scripts/prepare-eu-writer-trial.cjs', 'scripts/verify-eu-writer-trial.cjs', 'context/features/eu-writer-performance-executors.md']);
function fail(code, file) { const error = new Error(code); error.code = code; if (file) error.file = file; throw error; }
function ensure(condition, code, file) { if (!condition) fail(code, file); }
function safeRelative(file) {
  ensure(typeof file === 'string' && file && !file.includes('\\') && !file.includes(':') && !file.includes('\0') && !file.startsWith('/') && file.split('/').every(p => p && p !== '.' && p !== '..'), 'TRIAL_INVALID_PATH');
  const parts = file.toLowerCase().split('/');
  ensure(!parts.some(p => ['.git', '.aws', '.agents', '.codex', 'node_modules', 'dist', 'coverage', '.cache'].includes(p)) &&
    (!parts.some(p => p.startsWith('.env')) || file === 'backend/.env.example') && !/\.(key|pem|p12|pfx|keystore|log)$/i.test(file), 'TRIAL_EXCLUDED_PATH', file);
  return file;
}
function contained(root, file) { const relative = path.relative(root, file); return relative && relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative); }
function readFile(root, file) {
  safeRelative(file); const actualRoot = fs.realpathSync(root), target = path.resolve(actualRoot, file);
  ensure(contained(actualRoot, target), 'TRIAL_PATH_ESCAPE', file);
  let actual; try { actual = fs.realpathSync(target); } catch { fail('TRIAL_FILE_MISSING', file); }
  ensure(contained(actualRoot, actual), 'TRIAL_PATH_ESCAPE', file);
  safeRelative(path.relative(actualRoot, actual).split(path.sep).join('/'));
  ensure(fs.statSync(actual).isFile(), 'TRIAL_NOT_A_FILE', file); return fs.readFileSync(actual);
}
function pinned(root, file, expected) { ensure(HASH.test(expected || ''), 'TRIAL_INVALID_HASH'); const bytes = readFile(root, file); ensure(sha(bytes) === expected, 'TRIAL_PIN_CHANGED', file); return bytes; }
function hashSources(sources) {
  ensure(sources && typeof sources === 'object' && !Array.isArray(sources) && Object.keys(sources).length, 'TRIAL_INVALID_SOURCES');
  const entries = Object.entries(sources).sort(([a], [b]) => compare(a, b)), seen = new Set();
  for (const [file, hash] of entries) { safeRelative(file); ensure(HASH.test(hash), 'TRIAL_INVALID_HASH', file); ensure(!seen.has(file.toLowerCase()), 'TRIAL_DUPLICATE_PATH', file); seen.add(file.toLowerCase()); }
  return sha(JSON.stringify(entries));
}
function sourceHashes(files) { return Object.fromEntries([...files].sort(([a], [b]) => compare(a, b)).map(([file, bytes]) => [file, sha(bytes)])); }
function equalSources(actual, expected, code) { ensure(hashSources(actual) === hashSources(expected), code); }
function verifyFiles(root, sources) { hashSources(sources); for (const [file, expected] of Object.entries(sources)) ensure(sha(readFile(root, file)) === expected, 'TRIAL_SOURCE_CHANGED', file); return Object.keys(sources).length; }
function verifySourceTree(root, sources) {
  const omitted = new Set(['backend/node_modules', 'frontend/node_modules', 'frontend/test-harness/node_modules', 'frontend/dist']);
  function visit(folder) {
    for (const entry of fs.readdirSync(path.join(root, folder), { withFileTypes: true })) {
      const file = folder ? folder + '/' + entry.name : entry.name;
      if (omitted.has(file)) continue;
      safeRelative(file); ensure(!entry.isSymbolicLink(), 'TRIAL_SOURCE_ALIAS_REFUSED', file);
      if (entry.isDirectory()) visit(file);
      else ensure(entry.isFile() && Object.hasOwn(sources, file), 'TRIAL_UNTRACKED_SOURCE', file);
    }
  }
  visit('');
}
function verifyInstalledDependencies(root, dependencyManifests) {
  let checkedVersions = 0;
  for (const [file, metadata] of Object.entries(dependencyManifests)) {
    ensure(['package.json', 'backend/package.json', 'frontend/package.json', 'frontend/test-harness/package.json'].includes(file), 'TRIAL_DEPENDENCY_METADATA_CHANGED');
    for (const [name, expected] of Object.entries(metadata.installedVersions)) {
      ensure(/^(?:@[a-z0-9_-]+\/)?[a-z0-9][a-z0-9_.-]*$/i.test(name), 'TRIAL_DEPENDENCY_NAME_INVALID');
      const base = path.join(root, path.dirname(file), 'node_modules'), candidate = path.join(base, name, 'package.json');
      let actual = null;
      if (fs.existsSync(candidate)) {
        const dependencyRoot = fs.realpathSync(base), target = fs.realpathSync(candidate);
        ensure(contained(dependencyRoot, target), 'TRIAL_DEPENDENCY_PATH_ESCAPE');
        actual = json(fs.readFileSync(target)).version;
      }
      ensure(actual === expected, 'TRIAL_INSTALLED_DEPENDENCY_VERSION_CHANGED', file); checkedVersions++;
    }
  }
  return { status: 'PASS', checkedVersions, treeBytesPinned: false };
}
const CRC_TABLE = Array.from({ length: 256 }, (_, value) => { let crc = value; for (let i = 0; i < 8; i++) crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1; return crc >>> 0; });
function crc32(bytes) { let crc = 0xffffffff; for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 255] ^ (crc >>> 8); return (crc ^ 0xffffffff) >>> 0; }
function encodeZip(files) {
  const entries = [...files].sort(([a], [b]) => compare(a, b)); hashSources(sourceHashes(files)); ensure(entries.length < 65535, 'TRIAL_ZIP_LIMIT');
  const locals = [], directory = []; let offset = 0, centralSize = 0;
  for (const [file, bytes] of entries) {
    const name = Buffer.from(file), crc = crc32(bytes), local = Buffer.alloc(30), central = Buffer.alloc(46);
    ensure(name.length < 65536 && bytes.length < 0xffffffff && offset < 0xffffffff, 'TRIAL_ZIP_LIMIT');
    local.writeUInt32LE(0x04034b50); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x800, 6); local.writeUInt16LE(0x21, 12); local.writeUInt32LE(crc, 14); local.writeUInt32LE(bytes.length, 18); local.writeUInt32LE(bytes.length, 22); local.writeUInt16LE(name.length, 26);
    central.writeUInt32LE(0x02014b50); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt16LE(0x800, 8); central.writeUInt16LE(0x21, 14); central.writeUInt32LE(crc, 16); central.writeUInt32LE(bytes.length, 20); central.writeUInt32LE(bytes.length, 24); central.writeUInt16LE(name.length, 28); central.writeUInt32LE(offset, 42);
    locals.push(local, name, bytes); directory.push(central, name); offset += local.length + name.length + bytes.length; centralSize += central.length + name.length;
  }
  ensure(offset + centralSize < 0xffffffff, 'TRIAL_ZIP_LIMIT');
  const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10); end.writeUInt32LE(centralSize, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, ...directory, end]);
}
function decodeZip(bytes) {
  try {
    ensure(Buffer.isBuffer(bytes) && bytes.length >= 22, 'TRIAL_ZIP_INVALID'); const end = bytes.length - 22;
    ensure(bytes.readUInt32LE(end) === 0x06054b50 && bytes.readUInt16LE(end + 4) === 0 && bytes.readUInt16LE(end + 6) === 0 && bytes.readUInt16LE(end + 20) === 0, 'TRIAL_ZIP_INVALID');
    const count = bytes.readUInt16LE(end + 10), size = bytes.readUInt32LE(end + 12), start = bytes.readUInt32LE(end + 16);
    ensure(count > 0 && count === bytes.readUInt16LE(end + 8) && start + size === end, 'TRIAL_ZIP_INVALID');
    const files = new Map(), seen = new Set(); let cursor = start, localEnd = 0;
    for (let i = 0; i < count; i++) {
      ensure(cursor + 46 <= end && bytes.readUInt32LE(cursor) === 0x02014b50, 'TRIAL_ZIP_INVALID');
      const flags = bytes.readUInt16LE(cursor + 8), method = bytes.readUInt16LE(cursor + 10), crc = bytes.readUInt32LE(cursor + 16), length = bytes.readUInt32LE(cursor + 20), rawLength = bytes.readUInt32LE(cursor + 24), nameLength = bytes.readUInt16LE(cursor + 28), extra = bytes.readUInt16LE(cursor + 30), comment = bytes.readUInt16LE(cursor + 32), local = bytes.readUInt32LE(cursor + 42);
      ensure((flags === 0 || flags === 0x800) && method === 0 && length === rawLength && bytes.readUInt16LE(cursor + 34) === 0 && ((bytes.readUInt32LE(cursor + 38) >>> 16) & 0xf000) !== 0xa000, 'TRIAL_ZIP_UNSUPPORTED');
      ensure(cursor + 46 + nameLength + extra + comment <= end && local === localEnd && local + 30 <= start, 'TRIAL_ZIP_INVALID');
      const nameBytes = bytes.subarray(cursor + 46, cursor + 46 + nameLength), file = nameBytes.toString('utf8');
      ensure(Buffer.from(file).equals(nameBytes), 'TRIAL_ZIP_INVALID'); safeRelative(file);
      ensure(!seen.has(file.toLowerCase()), 'TRIAL_DUPLICATE_PATH', file); seen.add(file.toLowerCase());
      ensure(bytes.readUInt32LE(local) === 0x04034b50 && bytes.readUInt16LE(local + 6) === flags && bytes.readUInt16LE(local + 8) === method && bytes.readUInt32LE(local + 14) === crc && bytes.readUInt32LE(local + 18) === length && bytes.readUInt32LE(local + 22) === rawLength && bytes.readUInt16LE(local + 26) === nameLength, 'TRIAL_ZIP_INVALID');
      const dataStart = local + 30 + nameLength + bytes.readUInt16LE(local + 28);
      ensure(bytes.subarray(local + 30, local + 30 + nameLength).equals(nameBytes) && dataStart + length <= start, 'TRIAL_ZIP_INVALID');
      const content = bytes.subarray(dataStart, dataStart + length); ensure(crc32(content) === crc, 'TRIAL_ZIP_CRC_MISMATCH', file);
      files.set(file, Buffer.from(content)); localEnd = dataStart + length; cursor += 46 + nameLength + extra + comment;
    }
    ensure(cursor === end && localEnd === start, 'TRIAL_ZIP_INVALID'); return files;
  } catch (error) { if (error.code?.startsWith('TRIAL_')) throw error; fail('TRIAL_ZIP_INVALID'); }
}
function deriveSources(parent, supplements, overlays, extensions, policy = OVERLAYS) {
  ensure(JSON.stringify([...overlays.keys()].sort(compare)) === JSON.stringify(Object.keys(policy).sort(compare)), 'TRIAL_OVERLAY_SET_MISMATCH');
  const result = new Map(parent);
  for (const [file, bytes] of overlays) { const pin = policy[file]; ensure(parent.has(file) && sha(parent.get(file)) === pin.before && sha(bytes) === pin.after, 'TRIAL_OVERLAY_HASH_MISMATCH', file);
    if(pin.sourceOverride)ensure(extensions.has(pin.sourceOverride)&&sha(extensions.get(pin.sourceOverride))===pin.after,'TRIAL_OVERLAY_TEMPLATE_MISMATCH',file);
    result.set(file, bytes); }
  for (const additions of [...supplements, extensions]) for (const [file, bytes] of additions) { safeRelative(file); ensure(!result.has(file), 'TRIAL_ADDITION_REPLACES_SOURCE', file); result.set(file, bytes); }
  hashSources(sourceHashes(result)); return new Map([...result].sort(([a], [b]) => compare(a, b)));
}
function extensionAllowed(file) { return EXPLICIT_EXTENSIONS.includes(file) || /^test\/eu-writer-(?:trial|performance[^/]*)\.test\.cjs$/.test(file) || /^test\/integration\/eu-writer-performance\/(?:[^/]+\/)*[^/]+\.(?:cjs|json|md)$/.test(file); }
function json(bytes) { try { return JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/, '')); } catch { fail('TRIAL_INVALID_JSON'); } }
function verifyTrial({ manifestPath, expectedSourceRoot, verifyDependencies = false } = {}) {
  ensure(typeof manifestPath === 'string' && path.basename(manifestPath) === 'trial.json', 'TRIAL_MANIFEST_REQUIRED');
  const absolute = path.resolve(manifestPath), bundleRoot = fs.realpathSync(path.dirname(absolute)), manifestBytes = readFile(bundleRoot, 'trial.json'), manifest = json(manifestBytes);
  ensure(manifest.schemaVersion === 1 && manifest.kind === 'EU_WRITER_V2_DERIVED_TRIAL' && /^[a-f0-9]{32}$/.test(manifest.bundleId || ''), 'TRIAL_INVALID_MANIFEST');
  ensure(manifest.sourceRoot === 'sources' && manifest.archive?.path === 'sources.zip', 'TRIAL_INVALID_LAYOUT');
  const sourceRoot = fs.realpathSync(path.join(bundleRoot, 'sources')); ensure(contained(bundleRoot, sourceRoot), 'TRIAL_PATH_ESCAPE');
  if (expectedSourceRoot !== undefined) ensure(fs.realpathSync(expectedSourceRoot) === sourceRoot, 'TRIAL_EXECUTION_ROOT_MISMATCH');
  const digest = hashSources(manifest.sources); ensure(manifest.sourceSetDigest === digest && manifest.id === 'eu-writer-trial-' + digest.slice(0, 16), 'TRIAL_IDENTITY_MISMATCH');
  const parent = json(pinned(bundleRoot, manifest.parent?.manifest?.path, PINS.parentManifest));
  ensure(manifest.parent?.id === PINS.parentId && parent.id === PINS.parentId && parent.sourceSetDigest === PINS.parentDigest && manifest.parent.sourceSetDigest === PINS.parentDigest && manifest.parent.manifest.sha256 === PINS.parentManifest && manifest.parent.archive.sha256 === PINS.parentArchive, 'TRIAL_PARENT_MISMATCH');
  const parentFiles = decodeZip(pinned(bundleRoot, manifest.parent.archive.path, PINS.parentArchive)); equalSources(sourceHashes(parentFiles), parent.sources, 'TRIAL_PARENT_CONTENT_CHANGED');
  ensure(hashSources(parent.sources) === PINS.parentDigest, 'TRIAL_PARENT_MISMATCH');
  const supplements = [];
  ensure(Array.isArray(manifest.supplements) && manifest.supplements.length === PINS.supplements.length, 'TRIAL_SUPPLEMENT_SET_MISMATCH');
  for (const [index, pin] of PINS.supplements.entries()) {
    const item = manifest.supplements[index]; ensure(item.name === pin.name && item.manifest.sha256 === pin.manifest && item.archive.sha256 === pin.archive, 'TRIAL_SUPPLEMENT_SET_MISMATCH');
    const descriptor = json(pinned(bundleRoot, item.manifest.path, pin.manifest)), files = decodeZip(pinned(bundleRoot, item.archive.path, pin.archive));
    ensure(files.size === pin.count && item.sourceCount === pin.count && descriptor.baselineId === PINS.parentId, 'TRIAL_SUPPLEMENT_SET_MISMATCH'); equalSources(sourceHashes(files), descriptor.sources, 'TRIAL_SUPPLEMENT_CONTENT_CHANGED'); supplements.push(files);
  }
  ensure(JSON.stringify(manifest.overlays) === JSON.stringify(OVERLAYS), 'TRIAL_OVERLAY_SET_MISMATCH');
  ensure(Array.isArray(manifest.extensions) && manifest.extensions.length > 0 && new Set(manifest.extensions).size === manifest.extensions.length && manifest.extensions.every(extensionAllowed), 'TRIAL_EXTENSION_SET_MISMATCH');
  for (const required of EXPLICIT_EXTENSIONS) ensure(manifest.extensions.includes(required), 'TRIAL_EXTENSION_SET_MISMATCH');
  const overlays = new Map(Object.keys(OVERLAYS).map(file => [file, readFile(sourceRoot, file)])), extensions = new Map(manifest.extensions.map(file => [file, readFile(sourceRoot, file)]));
  const expected = deriveSources(parentFiles, supplements, overlays, extensions);
  equalSources(sourceHashes(expected), manifest.sources, 'TRIAL_DERIVATION_MISMATCH');
  const archive = pinned(bundleRoot, 'sources.zip', manifest.archive.sha256); equalSources(sourceHashes(decodeZip(archive)), manifest.sources, 'TRIAL_ARCHIVE_CONTENT_CHANGED');
  ensure(manifest.archive.bytes === archive.length && manifest.archive.sourceCount === expected.size && manifest.archive.format === 'zip-store', 'TRIAL_ARCHIVE_METADATA_CHANGED');
  ensure(JSON.stringify(manifest.package) === JSON.stringify(parent.package) && JSON.stringify(manifest.preservedPackages) === JSON.stringify(parent.preservedPackages), 'TRIAL_PACKAGE_CHANGED');
  ensure(sha(readFile(sourceRoot, parent.package.sqlPath).toString('utf8').replace(/\r\n/g, '\n')) === parent.package.upChecksum, 'TRIAL_SQL_CHECKSUM_MISMATCH');
  const sourceCount = verifyFiles(sourceRoot, manifest.sources);
  verifySourceTree(sourceRoot, manifest.sources);
  ensure(JSON.stringify(manifest.runtime?.dependencyManifests) === JSON.stringify(parent.runtime.dependencyManifests), 'TRIAL_DEPENDENCY_METADATA_CHANGED');
  const dependencies = verifyDependencies ? verifyInstalledDependencies(sourceRoot, manifest.runtime.dependencyManifests) : { status: 'NOT_CHECKED', treeBytesPinned: false };
  return { status: 'PASS', id: manifest.id, sourceSetDigest: digest, sourceCount, sourceRoot, bundleRoot,
    packageDigest: manifest.package.packageDigest, manifestSha256: sha(manifestBytes), archiveSha256: manifest.archive.sha256,
    parentId: PINS.parentId, overlayCount: Object.keys(OVERLAYS).length, supplementSourceCount: supplements.reduce((n, files) => n + files.size, 0), extensionCount: extensions.size,
    archiveEntriesContentAndCrcVerified: true, dependencies, functionalReadiness: 'REQUIRES_SEPARATE_MATCHING_PROOF' };
}
function main(args = process.argv.slice(2)) { ensure(args.length === 2 && args[0] === '--manifest', 'TRIAL_MANIFEST_REQUIRED'); return verifyTrial({ manifestPath: args[1] }); }
if (require.main === module) { try { process.stdout.write(JSON.stringify(main()) + '\n'); } catch (error) { process.stderr.write(JSON.stringify({ status: 'FAIL', code: error.code?.startsWith('TRIAL_') ? error.code : 'TRIAL_READ_FAILED', ...(error.file ? { file: error.file } : {}) }) + '\n'); process.exitCode = 1; } }
module.exports = { PINS, OVERLAYS, EXPLICIT_EXTENSIONS, sha, hashSources, sourceHashes, encodeZip, decodeZip, safeRelative, readFile, pinned, verifyFiles, verifySourceTree, verifyInstalledDependencies, deriveSources, extensionAllowed, verifyTrial, main };
