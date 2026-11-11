'use strict';

// Run only after the isolated workloads have finished. This compares the
// explicitly inventoried files; it does not claim a frozen repository/database.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {execFileSync} = require('node:child_process');

const root = path.resolve(__dirname, '../../..');
const baselinePath = path.join(__dirname, 'baseline.json');
const outputPath = path.join(__dirname, 'preservation.json');
const expectedChanges = Object.freeze([
  'backend/src/applications/composition.js',
  'backend/src/opportunities/httpComposition.js',
  'backend/src/security/authorityCoordinator.js',
  'context/features/http-flows-performance.md',
  'context/current-work.md'
].sort());
const expected = new Set(expectedChanges);

function git(args) {
  return execFileSync('git', args, {cwd: root, encoding: 'utf8', windowsHide: true,
    env: {...process.env, GIT_OPTIONAL_LOCKS: '0'}, maxBuffer: 16 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe']});
}
function normalizedRelative(value) {
  if (typeof value !== 'string' || !value || path.isAbsolute(value)) throw new Error('INVALID_BASELINE_PATH');
  const relative = value.replaceAll('\\', '/');
  if (relative.split('/').some(part => part === '..' || part === '.' || !part)
      || relative === '.git' || relative.startsWith('.git/')) throw new Error('INVALID_BASELINE_PATH');
  return relative;
}
function insideRoot(absolute) {
  const relative = path.relative(root, absolute);
  return relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative);
}
function statusEntries(raw) {
  const fields = raw.split('\0'), entries = [];
  for (let index = 0; index < fields.length; index++) {
    if (!fields[index]) continue;
    const item = fields[index], status = item.slice(0, 2);
    entries.push({status, path: normalizedRelative(item.slice(3))});
    // Porcelain -z emits the original path after a rename/copy target.
    if (/[RC]/.test(status)) index++;
  }
  return entries;
}

// Categories deliberately overlap. authorityCoordinator is mutable in this
// change; metadata manifests, protocol/catalog files and pools are not.
const protectedRules = Object.freeze({
  databaseAndMigrations: file => /^backend\/database\//.test(file) || /(^|\/)migrations?\//i.test(file),
  grantsAndPermissions: file => /(^|\/)[^/]*(grants?|permissions?|rls|acl)[^/]*\.(sql|json|ya?ml)$/i.test(file),
  manifestsAndMetadata: file => /^backend\/(src|scripts)\//.test(file)
    && /(?:manifest|metadata|authorityProtocolQueries|catalogReaderSchema|sqlTransactionControl)/i.test(path.basename(file)),
  pools: file => /^backend\/src\//.test(file) && /pool/i.test(path.basename(file)),
  configurationAndDeploy: file => /(^|\/)(config|configuration|deploy|deployment|\.github)(\/|$)/i.test(file)
    || /(^|\/)([^/]*config[^/]*|Dockerfile[^/]*|(?:docker-)?compose[^/]*|render|railway|fly|vercel|netlify)\.(?:[cm]?js|json|toml|ya?ml)$/i.test(file)
    || /(^|\/)Dockerfile(?:\.[^/]*)?$/i.test(file)
    || /(^|\/)\.env(?:\.[^/]*)?$/i.test(file)
    || /^(?:\.vscode\/|\.editorconfig$|\.gitignore$|\.dockerignore$)/.test(file),
  packages: file => /(^|\/)(?:package(?:-lock)?\.json|npm-shrinkwrap\.json|yarn\.lock|pnpm-lock\.yaml|\.npmrc)$/.test(file)
});
const protectedFile = file => Object.values(protectedRules).some(rule => rule(file));

function main() {
  const baseline = JSON.parse(fs.readFileSync(baselinePath, 'utf8').replace(/^\uFEFF/, ''));
  if (!baseline.hashes || typeof baseline.hashes !== 'object' || Array.isArray(baseline.hashes)
      || Object.keys(baseline.hashes).length !== 2685
      || typeof baseline.head !== 'string' || typeof baseline.branch !== 'string'
      || !Array.isArray(baseline.status)) throw new Error('INVALID_BASELINE_CONTRACT');
  const inventory = new Map(Object.entries(baseline.hashes).map(([file, digest]) => {
    if (!/^[a-f0-9]{64}$/i.test(digest)) throw new Error('INVALID_BASELINE_DIGEST');
    return [normalizedRelative(file), digest.toLowerCase()];
  }));
  if (inventory.size !== 2685 || expectedChanges.some(file => !inventory.has(file))) throw new Error('INVALID_BASELINE_INVENTORY');

  const changed = [], missing = [], unreadable = [], unchanged = [];
  for (const [file, digest] of inventory) {
    const absolute = path.resolve(root, file);
    if (!insideRoot(absolute)) throw new Error('BASELINE_PATH_OUTSIDE_WORKSPACE');
    try {
      // Refuse symlinks/reparse targets outside the workspace rather than read
      // an unrelated location. Only digest equality is reported, never content.
      if (!insideRoot(fs.realpathSync(absolute))) throw Object.assign(new Error(), {code: 'OUTSIDE_WORKSPACE'});
      if (!fs.statSync(absolute).isFile()) throw Object.assign(new Error(), {code: 'NOT_REGULAR_FILE'});
      const current = crypto.createHash('sha256').update(fs.readFileSync(absolute)).digest('hex');
      (current === digest ? unchanged : changed).push(file);
    } catch (error) {
      if (error.code === 'ENOENT' || error.code === 'ENOTDIR') missing.push(file);
      else unreadable.push({path: file, code: typeof error.code === 'string' ? error.code : 'READ_FAILED'});
    }
  }
  for (const list of [changed, missing, unchanged]) list.sort();
  unreadable.sort((left, right) => left.path.localeCompare(right.path));
  const head = git(['rev-parse', 'HEAD']).trim();
  const branch = git(['rev-parse', '--abbrev-ref', 'HEAD']).trim();
  const finalStatus = statusEntries(git(['status', '--porcelain=v1', '-z', '--untracked-files=all']));
  const unexpectedChangedFiles = changed.filter(file => !expected.has(file));
  const expectedChangesNotObserved = expectedChanges.filter(file => !changed.includes(file));

  function group(predicate) {
    const files = [...inventory.keys()].filter(predicate);
    return {count: files.length, unchangedCount: unchanged.filter(predicate).length,
      changed: changed.filter(predicate), missing: missing.filter(predicate),
      unreadable: unreadable.filter(entry => predicate(entry.path))};
  }
  const groups = {
    runtime: group(file => file.startsWith('backend/src/')),
    frontend: group(file => file.startsWith('frontend/')),
    priorHarness: group(file => /^test\/integration\/(http-contention|http-oidc)\//.test(file)),
    protected: group(protectedFile)
  };
  const protectedCategories = Object.fromEntries(Object.entries(protectedRules).map(([name, rule]) => [name, group(rule)]));
  const newStatusFiles = finalStatus.filter(entry => !inventory.has(entry.path));
  const pass = head === baseline.head && branch === baseline.branch
    && unexpectedChangedFiles.length === 0 && expectedChangesNotObserved.length === 0
    && missing.length === 0 && unreadable.length === 0 && groups.protected.changed.length === 0;
  const report = {
    at: new Date().toISOString(), baselineAt: baseline.at, baselineFileCount: inventory.size,
    unchangedFiles: unchanged.length, changedExistingFileCount: changed.length,
    expectedChangedExistingFiles: expectedChanges, changedExistingFiles: changed,
    unexpectedChangedFiles, expectedChangesNotObserved, missingFiles: missing, unreadableFiles: unreadable,
    headUnchanged: head === baseline.head, branchUnchanged: branch === baseline.branch,
    head, branch, baselineStatusEntries: baseline.status.length, finalStatusEntries: finalStatus.length,
    groups, protectedCategories,
    filesOutsideBaselineInGitStatus: {count: newStatusFiles.length, entries: newStatusFiles,
      note: 'Paths absent from the hash inventory, not proof of their creation time. Existing untracked baseline files were hashed and compared above.'},
    limits: [
      'Sequential comparison of 2685 baseline paths, not an atomic or immutable repository snapshot.',
      'Git status reports visible tracked/untracked paths; ignored files and live database state are not inventoried.',
      'No file contents, environment values, credentials, tokens, connection strings or URLs are included in this report.',
      'Category counts overlap; protected rules and the exact expected-change allowlist are defined in verify-preservation.js.',
      'The output preservation.json is written after the status observation and is not itself covered by this baseline.'
    ], pass
  };
  fs.writeFileSync(outputPath, JSON.stringify(report, null, 2) + '\n');
  process.stdout.write(JSON.stringify({pass, baselineFiles: inventory.size, unchanged: unchanged.length,
    changed: changed.length, unexpected: unexpectedChangedFiles.length, missing: missing.length,
    unreadable: unreadable.length, headUnchanged: report.headUnchanged, branchUnchanged: report.branchUnchanged}) + '\n');
  if (!pass) process.exitCode = 1;
}

try { main(); }
catch (error) {
  // Suppress child-process stderr and filesystem details; error text can carry
  // arbitrary environment material. No success artifact is emitted on failure.
  process.stderr.write('PRESERVATION_VERIFICATION_FAILED\n');
  process.exitCode = 1;
}
