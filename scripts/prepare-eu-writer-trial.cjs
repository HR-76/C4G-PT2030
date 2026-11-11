'use strict';
// Derive from approved archive bytes, never from the evolving workspace tree.
// Only the pinned Tenant034/scoped-responsibles overlays and trial extensions are read.
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { PINS, OVERLAYS, EXPLICIT_EXTENSIONS, sha, hashSources, sourceHashes, encodeZip, decodeZip, safeRelative, readFile, pinned, deriveSources, extensionAllowed, verifyTrial } = require('./verify-eu-writer-trial.cjs');
const ROOT = fs.realpathSync(path.resolve(__dirname, '..'));
const OLD = 'output/eu-writer-baseline-20261031';
const PARENT = OLD + '/' + PINS.parentId;
function fail(code, file) { const error = new Error(code); error.code = code; if (file) error.file = file; throw error; }
function ensure(value, code, file) { if (!value) fail(code, file); }
function parseArgs(args) { ensure(args.length === 1 && args[0] === '--prepare', 'TRIAL_EXPLICIT_PREPARE_REQUIRED'); return { prepare: true }; }
function resolveDestination(root, bundleId) {
  ensure(/^[a-f0-9]{32}$/.test(bundleId), 'TRIAL_INVALID_BUNDLE_ID');
  const actualRoot = fs.realpathSync(root), output = fs.realpathSync(path.join(actualRoot, 'output'));
  const relative = path.relative(actualRoot, output);
  ensure(relative && relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative) && fs.statSync(output).isDirectory(), 'TRIAL_DESTINATION_ESCAPE');
  const destination = path.join(output, 'eu-writer-trial-' + bundleId);
  ensure(!fs.existsSync(destination), 'TRIAL_DESTINATION_EXISTS'); return destination;
}
function collectExtensions(root) {
  const files = new Set(EXPLICIT_EXTENSIONS);
  function visit(folder) {
    for (const entry of fs.readdirSync(path.join(root, folder), { withFileTypes: true })) {
      const relative = folder + '/' + entry.name; safeRelative(relative);
      ensure(!entry.isSymbolicLink(), 'TRIAL_EXTENSION_ALIAS_REFUSED', relative);
      if (entry.isDirectory()) visit(relative);
      else if (entry.isFile()) { ensure(extensionAllowed(relative), 'TRIAL_EXTENSION_TYPE_REFUSED', relative); files.add(relative); }
    }
  }
  visit('test/integration/eu-writer-performance');
  for (const entry of fs.readdirSync(path.join(root, 'test'), { withFileTypes: true })) {
    if (/^eu-writer-(?:trial|performance[^/]*)\.test\.cjs$/.test(entry.name)) { ensure(entry.isFile() && !entry.isSymbolicLink(), 'TRIAL_EXTENSION_ALIAS_REFUSED'); files.add('test/' + entry.name); }
  }
  const result = [...files].sort(); for (const file of result) readFile(root, file); return result;
}
function installedMetadata(root, parent) {
  const manifests = {};
  for (const [file, captured] of Object.entries(parent.runtime.dependencyManifests)) {
    const installedVersions = {};
    for (const name of Object.keys(captured.installedVersions)) {
      ensure(/^(?:@[a-z0-9_.-]+\/)?[a-z0-9_.-]+$/i.test(name), 'TRIAL_DEPENDENCY_NAME_INVALID');
      const candidate = path.resolve(root, path.dirname(file), 'node_modules', name, 'package.json');
      let version = null;
      if (fs.existsSync(candidate)) {
        const actual = fs.realpathSync(candidate), relative = path.relative(root, actual);
        ensure(!relative.startsWith('..' + path.sep) && !path.isAbsolute(relative), 'TRIAL_DEPENDENCY_PATH_ESCAPE');
        version = JSON.parse(fs.readFileSync(actual, 'utf8')).version;
      }
      ensure(version === captured.installedVersions[name], 'TRIAL_INSTALLED_DEPENDENCY_VERSION_CHANGED', file);
      installedVersions[name] = version;
    }
    manifests[file] = { ...captured, installedVersions };
  }
  return { node: process.version, platform: process.platform, arch: process.arch, v8: process.versions.v8, modulesAbi: process.versions.modules,
    dependencyManifests: manifests, reusedInstalledDependencies: true, dependencyBytesArchived: false,
    dependencyLocations: ['backend/node_modules', 'frontend/node_modules', 'frontend/test-harness/node_modules'],
    limitation: 'Installed package versions match the parent. Lockfiles are included, but installed dependency-tree bytes are not individually pinned or archived.' };
}
function prepareTrial({ root = ROOT } = {}) {
  root = fs.realpathSync(root);
  const parentManifestBytes = pinned(root, PARENT + '/baseline.pre-validation.json', PINS.parentManifest);
  const parent = JSON.parse(parentManifestBytes);
  ensure(parent.id === PINS.parentId && hashSources(parent.sources) === PINS.parentDigest, 'TRIAL_PARENT_MISMATCH');
  const parentArchive = pinned(root, PARENT + '/sources.zip', PINS.parentArchive), parentFiles = decodeZip(parentArchive);
  ensure(hashSources(sourceHashes(parentFiles)) === PINS.parentDigest, 'TRIAL_PARENT_CONTENT_CHANGED');
  const provenance = new Map([['provenance/parent-baseline.json', parentManifestBytes], ['provenance/parent-sources.zip', parentArchive]]);
  const supplementalFiles = [], supplements = [];
  for (const pin of PINS.supplements) {
    const descriptorBytes = pinned(root, OLD + '/' + pin.name + '.json', pin.manifest), descriptor = JSON.parse(descriptorBytes);
    const archiveBytes = pinned(root, OLD + '/' + pin.name + '.zip', pin.archive), files = decodeZip(archiveBytes);
    ensure(descriptor.baselineId === parent.id && files.size === pin.count && hashSources(sourceHashes(files)) === hashSources(descriptor.sources), 'TRIAL_SUPPLEMENT_CONTENT_CHANGED');
    const manifestPath = 'provenance/' + pin.name + '.json', archivePath = 'provenance/' + pin.name + '.zip';
    provenance.set(manifestPath, descriptorBytes); provenance.set(archivePath, archiveBytes); supplementalFiles.push(files);
    supplements.push({ name: pin.name, manifest: { path: manifestPath, sha256: pin.manifest }, archive: { path: archivePath, sha256: pin.archive }, sourceCount: files.size,
      provenance: descriptor.provenanceLimit });
  }
  const overlayFiles = new Map(Object.entries(OVERLAYS).map(([file, pin]) => [file, readFile(root, pin.sourceOverride || file)]));
  const extensionPaths = collectExtensions(root), extensionFiles = new Map(extensionPaths.map(file => [file, readFile(root, file)]));
  const files = deriveSources(parentFiles, supplementalFiles, overlayFiles, extensionFiles);
  const sources = sourceHashes(files), sourceSetDigest = hashSources(sources), bundleId = randomUUID().replaceAll('-', '');
  const relativeFolder = 'output/eu-writer-trial-' + bundleId, folder = resolveDestination(root, bundleId);
  const archiveBytes = encodeZip(files), runtime = installedMetadata(root, parent);
  const changedGateSources = Object.entries(OVERLAYS).filter(([file]) => Object.hasOwn(parent.gateSourceHashes, file)).map(([file, pin]) => ({ path: file, before: pin.before, after: pin.after }));
  const manifest = {
    schemaVersion: 1, kind: 'EU_WRITER_V2_DERIVED_TRIAL', id: 'eu-writer-trial-' + sourceSetDigest.slice(0, 16), bundleId,
    capturedAt: new Date().toISOString(), status: 'SOURCE_SNAPSHOT_ONLY', sourceSetDigest, sourceRoot: 'sources', sources,
    archive: { path: 'sources.zip', sha256: sha(archiveBytes), bytes: archiveBytes.length, format: 'zip-store', sourceCount: files.size },
    parent: { id: parent.id, sourceSetDigest: parent.sourceSetDigest, manifest: { path: 'provenance/parent-baseline.json', sha256: PINS.parentManifest }, archive: { path: 'provenance/parent-sources.zip', sha256: PINS.parentArchive } },
    supplements, overlays: OVERLAYS, extensions: extensionPaths, package: parent.package, preservedPackages: parent.preservedPackages, runtime,
    derivation: { unchangedParentSources: Object.keys(parent.sources).length - Object.keys(OVERLAYS).length, changedParentSources: Object.keys(OVERLAYS).length,
      supplementalSources: supplementalFiles.reduce((n, items) => n + items.size, 0), newTrialSources: extensionPaths.length,
      overlayPurposes: { 'backend/src/applications/composition.js': 'Scoped responsible-directory names through the existing authority port; minimal separately pinned template excludes concurrent report authority-read optimization', 'backend/src/opportunities/httpComposition.js': 'Explicit approved Tenant034 admission', 'backend/test/opportunityV2ConsumerAdmission.test.js': 'Tenant034 admission regression' },
      workspacePolicy: 'All parent paths come from pinned archive bytes. Two exact Tenant034 overlays and enumerated trial extensions come from the workspace. The responsible-directory overlay comes from its separately pinned minimal template, not the evolving live composition. Other parallel changes are excluded.' },
    historicalWriterProof: { ...parent.physicalProof, sourceSetCorrespondence: 'NOT_EXACT_AFTER_APPROVED_RUNTIME_OVERLAYS', changedGateSources,
      reuseLimit: 'Prior writer evidence retains historical value; it does not automatically certify this derived source set or its new HTTP runtime.' },
    readiness: { functional: 'PENDING_MATCHING_ISOLATED_HTTP_PROOF', load: 'NOT_AUTHORIZED_OR_EXECUTED_BY_PREPARATION',
      evidenceMustBind: ['SOURCE_SET_DIGEST', 'TRIAL_MANIFEST_SHA256', 'IMAGE_DIGESTS', 'SEED_DIGEST', 'SCHEMA042_OR043_AND_TENANT034', 'FUNCTIONAL_ASSERTIONS', 'DRAIN', 'CLEANUP', 'UNCHANGED_SOURCES_BEFORE_AFTER'] },
    limitations: ['The parent source baseline and its historical evidence remain immutable.', 'The public backend/.env.example is a pinned test input; no actual environment configuration, TLS material or credentials is copied.',
      'Public fixtures and the isolated partner prototype/runbooks retain their original supplement provenance.', 'No SQL, gate, network, service or workload is executed by this preparation.']
  };
  function write(relative, bytes) { safeRelative(relative.startsWith('sources/') ? relative.slice(8) : relative); const target = path.resolve(folder, relative); ensure(target.startsWith(folder + path.sep), 'TRIAL_PATH_ESCAPE'); fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, bytes, { flag: 'wx' }); }
  fs.mkdirSync(folder);
  for (const [file, bytes] of files) write('sources/' + file, bytes);
  for (const [file, bytes] of provenance) write(file, bytes);
  write('sources.zip', archiveBytes); write('trial.json', Buffer.from(JSON.stringify(manifest, null, 2) + '\n'));
  for (const [file, bytes] of overlayFiles) ensure(sha(readFile(root, OVERLAYS[file].sourceOverride || file)) === sha(bytes), 'TRIAL_INPUT_CHANGED_DURING_CAPTURE', file);
  for (const [file, bytes] of extensionFiles) ensure(sha(readFile(root, file)) === sha(bytes), 'TRIAL_INPUT_CHANGED_DURING_CAPTURE', file);
  ensure(JSON.stringify(collectExtensions(root)) === JSON.stringify(extensionPaths), 'TRIAL_EXTENSION_SET_CHANGED_DURING_CAPTURE');
  const verified = verifyTrial({ manifestPath: path.join(folder, 'trial.json'), expectedSourceRoot: path.join(folder, 'sources') });
  return { ...verified, manifestPath: path.join(folder, 'trial.json'), relativeManifestPath: relativeFolder + '/trial.json' };
}
if (require.main === module) { try { parseArgs(process.argv.slice(2)); process.stdout.write(JSON.stringify(prepareTrial()) + '\n'); } catch (error) { process.stderr.write(JSON.stringify({ status: 'FAIL', code: error.code?.startsWith('TRIAL_') ? error.code : 'TRIAL_PREPARATION_FAILED', ...(error.file ? { file: error.file } : {}) }) + '\n'); process.exitCode = 1; } }
module.exports = { prepareTrial, collectExtensions, parseArgs, resolveDestination };
