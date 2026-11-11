'use strict';

// Read-only validation. This file never loads application modules or runs gates.
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');

const DEFAULT_MANIFEST = 'context/references/performance/eu-writer-v2-baseline.json';
const PACKAGE_SOURCE = 'backend/src/security/opportunityEuWriterMigrationPackage.js';
const LEGACY_PACKAGE_SOURCE = 'backend/src/security/opportunityV2MigrationPackage.js';
const LEGACY_PACKAGE_DIGEST = '4f83267f1c2d3f41c604453f3489136397f661fbc06a99de8b79ed2980674e7a';
const SHA256 = /^[a-f0-9]{64}$/;
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);

function refuse(code, file) {
  const error = new Error(code);
  error.code = code;
  if (file) error.file = file;
  throw error;
}

function validateRelativePath(file) {
  if (typeof file !== 'string' || !file || file.includes('\\') || file.includes(':') ||
      file.includes('\0') || path.posix.isAbsolute(file) ||
      file.split('/').some(part => !part || part === '.' || part === '..')) refuse('BASELINE_INVALID_PATH');
  // Apply the same conservative exclusion on case-sensitive and Windows hosts.
  const segments = file.split('/').map(part => part.toLowerCase());
  if (segments.some(part => ['node_modules', '.git', '.aws', '.codex', '.agents'].includes(part)) ||
      segments.some(part => part === '.env' || (part.startsWith('.env.') && !part.endsWith('.example')))) {
    refuse('BASELINE_EXCLUDED_PATH');
  }
  return file;
}

function contained(root, file) {
  const relative = path.relative(root, file);
  return relative !== '' && !relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative);
}

function readWorkspaceFile(root, file) {
  validateRelativePath(file);
  const resolved = path.resolve(root, file);
  if (!contained(root, resolved)) refuse('BASELINE_PATH_ESCAPE');
  let actual;
  try { actual = fs.realpathSync(resolved); } catch { refuse('BASELINE_FILE_MISSING', file); }
  if (!contained(root, actual)) refuse('BASELINE_PATH_ESCAPE', file);
  // An in-workspace alias must not bypass exclusions on its actual target.
  validateRelativePath(path.relative(root, actual).split(path.sep).join('/'));
  if (!fs.statSync(actual).isFile()) refuse('BASELINE_NOT_A_FILE', file);
  return fs.readFileSync(actual);
}

function hashSourceSet(sources) {
  if (!object(sources) || Object.keys(sources).length === 0) refuse('BASELINE_INVALID_SOURCES');
  const entries = Object.entries(sources).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);
  for (const [file, checksum] of entries) {
    validateRelativePath(file);
    if (typeof checksum !== 'string' || !SHA256.test(checksum)) refuse('BASELINE_INVALID_SOURCE_HASH', file);
  }
  return hash(JSON.stringify(entries));
}

function validatePackage(pkg, sources, root) {
  if (!object(pkg) || !object(pkg.entry) || pkg.packageId !== 'opportunity-eu-writer-v2' ||
      pkg.version !== '043_opportunity_eu_writer_v2' || pkg.centralBaseline !== '042_opportunity_eu_source_control_v2' ||
      pkg.legacyPackageDigest !== LEGACY_PACKAGE_DIGEST) refuse('BASELINE_INVALID_PACKAGE');
  const fields = ['upChecksum', 'schemaFingerprint', 'authoritySecurityFingerprint', 'catalogSecurityFingerprint', 'euWriterSecurityFingerprint'];
  if (fields.some(key => typeof pkg[key] !== 'string' || !SHA256.test(pkg[key]) || pkg.entry[key] !== pkg[key]) ||
      pkg.entry.version !== pkg.version || pkg.entry.requiresPreflightVersion !== pkg.centralBaseline ||
      pkg.entry.irreversible !== true || pkg.entry.acceptsHistoricalCrlfChecksum !== false ||
      !SHA256.test(pkg.entry.requiresCatalogSecurityFingerprint || '')) refuse('BASELINE_INVALID_PACKAGE_ENTRY');
  const digest = hash(JSON.stringify({ packageId: pkg.packageId, centralBaseline: pkg.centralBaseline, entry: pkg.entry }));
  if (pkg.packageDigest !== digest) refuse('BASELINE_PACKAGE_DIGEST_MISMATCH');
  if (pkg.sqlPath !== 'backend/database/central/candidates/opportunity_eu_writer_v2.up.sql' ||
      ![pkg.sqlPath, PACKAGE_SOURCE, LEGACY_PACKAGE_SOURCE].every(file => Object.hasOwn(sources, file))) {
    refuse('BASELINE_PACKAGE_SOURCES_MISSING');
  }
  const canonicalSql = readWorkspaceFile(root, pkg.sqlPath).toString('utf8').replace(/\r\n/g, '\n');
  if (hash(canonicalSql) !== pkg.upChecksum) refuse('BASELINE_SQL_CHECKSUM_MISMATCH', pkg.sqlPath);
}

function verifyBaseline(manifest, { root = path.resolve(__dirname, '..') } = {}) {
  const actualRoot = fs.realpathSync(root);
  if (!object(manifest) || manifest.schemaVersion !== 1) refuse('BASELINE_INVALID_MANIFEST');
  const sourceSetDigest = hashSourceSet(manifest.sources);
  if (manifest.sourceSetDigest !== sourceSetDigest || manifest.id !== 'eu-writer-v2-' + sourceSetDigest.slice(0, 16)) {
    refuse('BASELINE_IDENTITY_MISMATCH');
  }
  for (const [file, expected] of Object.entries(manifest.sources)) {
    if (hash(readWorkspaceFile(actualRoot, file)) !== expected) refuse('BASELINE_SOURCE_CHANGED', file);
  }
  if (!object(manifest.archive) || !SHA256.test(manifest.archive.sha256 || '')) refuse('BASELINE_INVALID_ARCHIVE');
  if (Object.hasOwn(manifest.sources, manifest.archive.path)) refuse('BASELINE_ARCHIVE_IS_SOURCE');
  if (hash(readWorkspaceFile(actualRoot, manifest.archive.path)) !== manifest.archive.sha256) {
    refuse('BASELINE_ARCHIVE_CHANGED', manifest.archive.path);
  }
  validatePackage(manifest.package, manifest.sources, actualRoot);
  return { status: 'PASS', id: manifest.id, sourceSetDigest, sourceCount: Object.keys(manifest.sources).length,
    packageDigest: manifest.package.packageDigest, archiveVerified: true, sqlChecksumVerified: true };
}

function main(args = process.argv.slice(2)) {
  if (args.length !== 0 && !(args.length === 2 && args[0] === '--manifest')) refuse('BASELINE_INVALID_ARGUMENTS');
  const root = fs.realpathSync(path.resolve(__dirname, '..'));
  let manifest;
  const bytes = readWorkspaceFile(root, args[1] || DEFAULT_MANIFEST);
  try { manifest = JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/, '')); } catch { refuse('BASELINE_INVALID_JSON'); }
  return verifyBaseline(manifest, { root });
}

if (require.main === module) {
  try { process.stdout.write(JSON.stringify(main()) + '\n'); }
  catch (error) {
    process.stderr.write(JSON.stringify({ status: 'FAIL', code: error.code?.startsWith('BASELINE_') ? error.code : 'BASELINE_READ_FAILED',
      ...(error.file ? { file: error.file } : {}) }) + '\n');
    process.exitCode = 1;
  }
}

module.exports = { verifyBaseline, hashSourceSet, main };
