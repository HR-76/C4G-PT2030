'use strict';
// Builtin-only archive/path primitives copied from the immutable 0ecb verifier.
// Source SHA256: 81db189c94b930e7c4526c29aced9bc19156f3dbed351021c2aada9f4e3d17c9
// Error namespace adapted; no old trial admission or application module is used.
const fs=require('node:fs'),path=require('node:path'),{createHash}=require('node:crypto');
const sha=value=>createHash('sha256').update(value).digest('hex');
const compare=(a,b)=>a<b?-1:a>b?1:0;
const HASH=/^[a-f0-9]{64}$/;
function fail(code, file) { const error = new Error(code); error.code = code; if (file) error.file = file; throw error; }
function ensure(condition, code, file) { if (!condition) fail(code, file); }
function safeRelative(file) {
  ensure(typeof file === 'string' && file && !file.includes('\\') && !file.includes(':') && !file.includes('\0') && !file.startsWith('/') && file.split('/').every(p => p && p !== '.' && p !== '..'), 'AB_INVALID_PATH');
  const parts = file.toLowerCase().split('/');
  ensure(!parts.some(p => ['.git', '.aws', '.agents', '.codex', 'node_modules', 'dist', 'coverage', '.cache'].includes(p)) &&
    (!parts.some(p => p.startsWith('.env')) || file === 'backend/.env.example') && !/\.(key|pem|p12|pfx|keystore|log)$/i.test(file), 'AB_EXCLUDED_PATH', file);
  return file;
}
function contained(root, file) { const relative = path.relative(root, file); return relative && relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative); }
function readFile(root, file) {
  safeRelative(file); const actualRoot = fs.realpathSync(root), target = path.resolve(actualRoot, file);
  ensure(contained(actualRoot, target), 'AB_PATH_ESCAPE', file);
  let actual; try { actual = fs.realpathSync(target); } catch { fail('AB_FILE_MISSING', file); }
  ensure(contained(actualRoot, actual), 'AB_PATH_ESCAPE', file);
  safeRelative(path.relative(actualRoot, actual).split(path.sep).join('/'));
  ensure(fs.statSync(actual).isFile(), 'AB_NOT_A_FILE', file); return fs.readFileSync(actual);
}
function pinned(root, file, expected) { ensure(HASH.test(expected || ''), 'AB_INVALID_HASH'); const bytes = readFile(root, file); ensure(sha(bytes) === expected, 'AB_PIN_CHANGED', file); return bytes; }
function hashSources(sources) {
  ensure(sources && typeof sources === 'object' && !Array.isArray(sources) && Object.keys(sources).length, 'AB_INVALID_SOURCES');
  const entries = Object.entries(sources).sort(([a], [b]) => compare(a, b)), seen = new Set();
  for (const [file, hash] of entries) { safeRelative(file); ensure(HASH.test(hash), 'AB_INVALID_HASH', file); ensure(!seen.has(file.toLowerCase()), 'AB_DUPLICATE_PATH', file); seen.add(file.toLowerCase()); }
  return sha(JSON.stringify(entries));
}
function sourceHashes(files) { return Object.fromEntries([...files].sort(([a], [b]) => compare(a, b)).map(([file, bytes]) => [file, sha(bytes)])); }
function equalSources(actual, expected, code) { ensure(hashSources(actual) === hashSources(expected), code); }
function verifyFiles(root, sources) { hashSources(sources); for (const [file, expected] of Object.entries(sources)) ensure(sha(readFile(root, file)) === expected, 'AB_SOURCE_CHANGED', file); return Object.keys(sources).length; }
function verifySourceTree(root, sources) {
  const omitted = new Set(['backend/node_modules', 'frontend/node_modules', 'frontend/test-harness/node_modules', 'frontend/dist']);
  function visit(folder) {
    for (const entry of fs.readdirSync(path.join(root, folder), { withFileTypes: true })) {
      const file = folder ? folder + '/' + entry.name : entry.name;
      if (omitted.has(file)) continue;
      safeRelative(file); ensure(!entry.isSymbolicLink(), 'AB_SOURCE_ALIAS_REFUSED', file);
      if (entry.isDirectory()) visit(file);
      else ensure(entry.isFile() && Object.hasOwn(sources, file), 'AB_UNTRACKED_SOURCE', file);
    }
  }
  visit('');
}
function verifyInstalledDependencies(root, dependencyManifests) {
  let checkedVersions = 0;
  for (const [file, metadata] of Object.entries(dependencyManifests)) {
    ensure(['package.json', 'backend/package.json', 'frontend/package.json', 'frontend/test-harness/package.json'].includes(file), 'AB_DEPENDENCY_METADATA_CHANGED');
    for (const [name, expected] of Object.entries(metadata.installedVersions)) {
      ensure(/^(?:@[a-z0-9_-]+\/)?[a-z0-9][a-z0-9_.-]*$/i.test(name), 'AB_DEPENDENCY_NAME_INVALID');
      const base = path.join(root, path.dirname(file), 'node_modules'), candidate = path.join(base, name, 'package.json');
      let actual = null;
      if (fs.existsSync(candidate)) {
        const dependencyRoot = fs.realpathSync(base), target = fs.realpathSync(candidate);
        ensure(contained(dependencyRoot, target), 'AB_DEPENDENCY_PATH_ESCAPE');
        actual = json(fs.readFileSync(target)).version;
      }
      ensure(actual === expected, 'AB_INSTALLED_DEPENDENCY_VERSION_CHANGED', file); checkedVersions++;
    }
  }
  return { status: 'PASS', checkedVersions, treeBytesPinned: false };
}
const CRC_TABLE = Array.from({ length: 256 }, (_, value) => { let crc = value; for (let i = 0; i < 8; i++) crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1; return crc >>> 0; });
function crc32(bytes) { let crc = 0xffffffff; for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 255] ^ (crc >>> 8); return (crc ^ 0xffffffff) >>> 0; }
function encodeZip(files) {
  const entries = [...files].sort(([a], [b]) => compare(a, b)); hashSources(sourceHashes(files)); ensure(entries.length < 65535, 'AB_ZIP_LIMIT');
  const locals = [], directory = []; let offset = 0, centralSize = 0;
  for (const [file, bytes] of entries) {
    const name = Buffer.from(file), crc = crc32(bytes), local = Buffer.alloc(30), central = Buffer.alloc(46);
    ensure(name.length < 65536 && bytes.length < 0xffffffff && offset < 0xffffffff, 'AB_ZIP_LIMIT');
    local.writeUInt32LE(0x04034b50); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x800, 6); local.writeUInt16LE(0x21, 12); local.writeUInt32LE(crc, 14); local.writeUInt32LE(bytes.length, 18); local.writeUInt32LE(bytes.length, 22); local.writeUInt16LE(name.length, 26);
    central.writeUInt32LE(0x02014b50); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt16LE(0x800, 8); central.writeUInt16LE(0x21, 14); central.writeUInt32LE(crc, 16); central.writeUInt32LE(bytes.length, 20); central.writeUInt32LE(bytes.length, 24); central.writeUInt16LE(name.length, 28); central.writeUInt32LE(offset, 42);
    locals.push(local, name, bytes); directory.push(central, name); offset += local.length + name.length + bytes.length; centralSize += central.length + name.length;
  }
  ensure(offset + centralSize < 0xffffffff, 'AB_ZIP_LIMIT');
  const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10); end.writeUInt32LE(centralSize, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, ...directory, end]);
}
function decodeZip(bytes) {
  try {
    ensure(Buffer.isBuffer(bytes) && bytes.length >= 22, 'AB_ZIP_INVALID'); const end = bytes.length - 22;
    ensure(bytes.readUInt32LE(end) === 0x06054b50 && bytes.readUInt16LE(end + 4) === 0 && bytes.readUInt16LE(end + 6) === 0 && bytes.readUInt16LE(end + 20) === 0, 'AB_ZIP_INVALID');
    const count = bytes.readUInt16LE(end + 10), size = bytes.readUInt32LE(end + 12), start = bytes.readUInt32LE(end + 16);
    ensure(count > 0 && count === bytes.readUInt16LE(end + 8) && start + size === end, 'AB_ZIP_INVALID');
    const files = new Map(), seen = new Set(); let cursor = start, localEnd = 0;
    for (let i = 0; i < count; i++) {
      ensure(cursor + 46 <= end && bytes.readUInt32LE(cursor) === 0x02014b50, 'AB_ZIP_INVALID');
      const flags = bytes.readUInt16LE(cursor + 8), method = bytes.readUInt16LE(cursor + 10), crc = bytes.readUInt32LE(cursor + 16), length = bytes.readUInt32LE(cursor + 20), rawLength = bytes.readUInt32LE(cursor + 24), nameLength = bytes.readUInt16LE(cursor + 28), extra = bytes.readUInt16LE(cursor + 30), comment = bytes.readUInt16LE(cursor + 32), local = bytes.readUInt32LE(cursor + 42);
      ensure((flags === 0 || flags === 0x800) && method === 0 && length === rawLength && bytes.readUInt16LE(cursor + 34) === 0 && ((bytes.readUInt32LE(cursor + 38) >>> 16) & 0xf000) !== 0xa000, 'AB_ZIP_UNSUPPORTED');
      ensure(cursor + 46 + nameLength + extra + comment <= end && local === localEnd && local + 30 <= start, 'AB_ZIP_INVALID');
      const nameBytes = bytes.subarray(cursor + 46, cursor + 46 + nameLength), file = nameBytes.toString('utf8');
      ensure(Buffer.from(file).equals(nameBytes), 'AB_ZIP_INVALID'); safeRelative(file);
      ensure(!seen.has(file.toLowerCase()), 'AB_DUPLICATE_PATH', file); seen.add(file.toLowerCase());
      ensure(bytes.readUInt32LE(local) === 0x04034b50 && bytes.readUInt16LE(local + 6) === flags && bytes.readUInt16LE(local + 8) === method && bytes.readUInt32LE(local + 14) === crc && bytes.readUInt32LE(local + 18) === length && bytes.readUInt32LE(local + 22) === rawLength && bytes.readUInt16LE(local + 26) === nameLength, 'AB_ZIP_INVALID');
      const dataStart = local + 30 + nameLength + bytes.readUInt16LE(local + 28);
      ensure(bytes.subarray(local + 30, local + 30 + nameLength).equals(nameBytes) && dataStart + length <= start, 'AB_ZIP_INVALID');
      const content = bytes.subarray(dataStart, dataStart + length); ensure(crc32(content) === crc, 'AB_ZIP_CRC_MISMATCH', file);
      files.set(file, Buffer.from(content)); localEnd = dataStart + length; cursor += 46 + nameLength + extra + comment;
    }
    ensure(cursor === end && localEnd === start, 'AB_ZIP_INVALID'); return files;
  } catch (error) { if (error.code?.startsWith('AB_')) throw error; fail('AB_ZIP_INVALID'); }
}

function json(bytes){try{return JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/,''));}catch{fail('AB_INVALID_JSON');}}
module.exports={sha,hashSources,sourceHashes,encodeZip,decodeZip,safeRelative,readFile,pinned,verifyFiles,verifySourceTree,verifyInstalledDependencies,contained,ensure,fail,json};
