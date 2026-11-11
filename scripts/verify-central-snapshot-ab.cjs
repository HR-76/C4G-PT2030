'use strict';
// This verifier loads builtins and archive primitives only. It never executes
// application modules, SQL, Docker or the previous trial verifier.
const fs = require('node:fs');
const path = require('node:path');
const util = require('node:util');
const archive = require('../test/integration/central-snapshot-ab/archive.cjs');
const { sha, hashSources, sourceHashes, decodeZip, readFile, pinned, verifyFiles,
  verifySourceTree, verifyInstalledDependencies, contained, ensure, json } = archive;

const PARENT = Object.freeze({
  folder: 'output/eu-writer-trial-6c172f4fcfaa4965a4d5a357ed12da8e',
  id: 'eu-writer-trial-0ecb31dc7c705859', sourceCount: 1844,
  sourceSetDigest: '0ecb31dc7c70585959a97b38046e79c5aa0dec06b87763a557720ad3e8ce1d6c',
  manifestSha256: '767625d37bece93c7877a577c527324ce514cec3081ed57451d1677b04be7afc',
  archiveSha256: '8570b0efe3c0a3cdcaab008d488a4689e6b8179dc8f243b77ed94e0683befe6a',
  seedDigest: '3809b44e0f34f7a5f6868b9052fb66af021051292b0b49648b9d0e8876edf3f6'
});
const OVERLAY_PATHS = Object.freeze([
  'backend/src/security/authoritySecurityManifest.js',
  'backend/src/security/centralSchemaManifest.js'
]);
const REGRESSION_PATHS = Object.freeze([
  'backend/test/authoritySecuritySqlOptimization.test.js',
  'backend/test/centralSchemaCatalogBatch.test.js',
  'backend/test/centralSchemaSqlOptimization.test.js'
]);
const EXPLICIT_SHARED = Object.freeze([
  'scripts/prepare-central-snapshot-ab.cjs', 'scripts/verify-central-snapshot-ab.cjs',
  'context/features/central-security-snapshot-sql-performance.md', ...REGRESSION_PATHS
]);
const REQUIRED_HARNESS = Object.freeze([
  'archive.cjs', 'run.cjs', 'metadata.cjs', 'equivalence.cjs', 'protocol.json', 'README.md'
].map(file => 'test/integration/central-snapshot-ab/' + file));
function sharedAllowed(file) {
  return EXPLICIT_SHARED.includes(file) || /^test\/central-snapshot-ab(?:-[a-z0-9-]+)?\.test\.cjs$/.test(file) ||
    /^test\/integration\/central-snapshot-ab\/[a-z0-9-]+\.(?:cjs|json|md)$/.test(file) || file === 'test/integration/central-snapshot-ab/README.md';
}
function bundleDigest({ A, B, harness }) {
  for (const digest of [A, B, harness]) ensure(/^[a-f0-9]{64}$/.test(digest || ''), 'AB_INVALID_DIGEST');
  return sha(JSON.stringify({ A, B, harness }));
}
function deriveVariant(parentFiles, overlays) {
  ensure(util.isDeepStrictEqual([...overlays.keys()].sort(), [...OVERLAY_PATHS]), 'AB_OVERLAY_SET');
  const result = new Map(parentFiles);
  for (const [file, bytes] of overlays) {
    ensure(parentFiles.has(file), 'AB_OVERLAY_PARENT', file);
    ensure(Buffer.isBuffer(bytes) && !bytes.equals(parentFiles.get(file)), 'AB_OVERLAY_UNCHANGED', file);
    result.set(file, bytes);
  }
  return result;
}
function validateProtocol(protocol) {
  ensure(protocol?.schemaVersion === 1 && protocol.parentId === PARENT.id && protocol.seedDigest === PARENT.seedDigest, 'AB_PROTOCOL_IDENTITY');
  ensure(util.isDeepStrictEqual(protocol.metadata?.pairOrder, [['A','B'],['B','A'],['A','B'],['B','A'],['A','B'],['B','A']]) &&
    protocol.metadata.warmupsPerBlock === 10 && protocol.metadata.measuredPerBlock === 100 &&
    protocol.metadata.measuredPerArmPerRevision === 600 && protocol.metadata.connectionsPerBlock === 1, 'AB_METADATA_PROTOCOL');
  ensure(util.isDeepStrictEqual(protocol.http?.pairOrder, [['A','B'],['B','A'],['A','B'],['B','A']]) &&
    protocol.http.attemptsPerArm === 36 && protocol.http.warmupsPerArm === 7 && protocol.http.totalAttempts === 288 && protocol.http.totalWarmups === 56, 'AB_HTTP_PROTOCOL');
  ensure(util.isDeepStrictEqual(protocol.budgets, { setup:300000, metadataBlock:300000, httpScenario:180000, drain:30000, cleanup:120000 }), 'AB_BUDGETS_CHANGED');
  ensure(protocol.clock === 'MONOTONIC' && protocol.quantiles === 'NEAREST_RANK' && protocol.roundBeforeDecision === false, 'AB_TIMING_PROTOCOL');
  ensure(protocol.images?.postgres?.id === 'sha256:77f585114c32fbca283dc835b0596f4e52b51b4c6662d7810b2f4084f60a1873' &&
    protocol.images?.keycloak?.id === 'sha256:b0f60d489d51c5d113390bdf5461d4c06e6051be026c05549f2e1e10ec352bcc', 'AB_IMAGES_CHANGED');
  return protocol;
}
function verifyAB({ manifestPath, expectedHarnessRoot, verifyDependencies = false } = {}) {
  ensure(typeof manifestPath === 'string' && path.basename(manifestPath) === 'ab.json', 'AB_MANIFEST_REQUIRED');
  const bundleRoot = fs.realpathSync(path.dirname(path.resolve(manifestPath)));
  const manifestBytes = readFile(bundleRoot, 'ab.json'), manifest = json(manifestBytes);
  ensure(manifest.schemaVersion === 1 && manifest.kind === 'CENTRAL_SECURITY_SNAPSHOT_AB' && /^[a-f0-9]{32}$/.test(manifest.bundleId || ''), 'AB_INVALID_MANIFEST');
  ensure(manifest.parent?.manifest?.path === 'provenance/trial.json' && manifest.parent?.archive?.path === 'provenance/sources.zip', 'AB_PARENT_LAYOUT');
  ensure(manifest.parent.id === PARENT.id && manifest.parent.manifest.sha256 === PARENT.manifestSha256 && manifest.parent.archive.sha256 === PARENT.archiveSha256, 'AB_PARENT_PIN');
  const parent = json(pinned(bundleRoot, 'provenance/trial.json', PARENT.manifestSha256));
  const parentFiles = decodeZip(pinned(bundleRoot, 'provenance/sources.zip', PARENT.archiveSha256));
  ensure(parent.id === PARENT.id && hashSources(parent.sources) === PARENT.sourceSetDigest && hashSources(sourceHashes(parentFiles)) === PARENT.sourceSetDigest && parentFiles.size === PARENT.sourceCount, 'AB_PARENT_CONTENT');
  ensure(util.isDeepStrictEqual(Object.keys(manifest.variants || {}).sort(), ['A','B']), 'AB_VARIANTS');
  ensure(util.isDeepStrictEqual(Object.keys(manifest.overlays || {}).sort(), [...OVERLAY_PATHS]), 'AB_OVERLAY_SET');
  const roots = {}, variants = {};
  for (const arm of ['A','B']) {
    const spec = manifest.variants[arm];
    ensure(spec.sourceRoot === arm + '/sources' && spec.archive?.path === arm + '/sources.zip', 'AB_VARIANT_LAYOUT');
    if(arm==='A')ensure(spec.archive.sha256===PARENT.archiveSha256,'AB_A_ARCHIVE_PIN');
    const sourceRoot = fs.realpathSync(path.join(bundleRoot, spec.sourceRoot));
    ensure(contained(bundleRoot, sourceRoot), 'AB_PATH_ESCAPE'); roots[arm] = sourceRoot;
    const expected = arm === 'A' ? parentFiles : deriveVariant(parentFiles, new Map(OVERLAY_PATHS.map(file => [file, readFile(sourceRoot, file)])));
    const expectedHashes = sourceHashes(expected), digest = hashSources(expectedHashes);
    ensure(hashSources(spec.sources) === digest && spec.sourceSetDigest === digest && spec.sourceCount === PARENT.sourceCount, 'AB_VARIANT_DERIVATION');
    const zip = pinned(bundleRoot, spec.archive.path, spec.archive.sha256);
    ensure(hashSources(sourceHashes(decodeZip(zip))) === digest && spec.archive.bytes === zip.length && spec.archive.format === 'zip-store', 'AB_VARIANT_ARCHIVE');
    verifyFiles(sourceRoot, expectedHashes); verifySourceTree(sourceRoot, expectedHashes);
    variants[arm] = { sourceRoot, sourceSetDigest: digest, sourceCount: PARENT.sourceCount, archiveSha256: spec.archive.sha256 };
    if (arm === 'B') for (const file of OVERLAY_PATHS) ensure(manifest.overlays[file].before === parent.sources[file] && manifest.overlays[file].after === spec.sources[file], 'AB_OVERLAY_HASH', file);
  }
  const common = manifest.harness;
  ensure(common?.sourceRoot === 'common' && common.archive?.path === 'common.zip', 'AB_HARNESS_LAYOUT');
  const harnessRoot = fs.realpathSync(path.join(bundleRoot, 'common')); ensure(contained(bundleRoot, harnessRoot), 'AB_PATH_ESCAPE');
  if (expectedHarnessRoot !== undefined) ensure(fs.realpathSync(expectedHarnessRoot) === harnessRoot, 'AB_HARNESS_ROOT_MISMATCH');
  const sharedPaths = Object.keys(common.sources || {});
  ensure(sharedPaths.every(sharedAllowed) && [...EXPLICIT_SHARED, ...REQUIRED_HARNESS].every(p => sharedPaths.includes(p)), 'AB_SHARED_SET');
  const harnessDigest = hashSources(common.sources);
  ensure(harnessDigest === common.sourceSetDigest && common.sourceCount === sharedPaths.length, 'AB_HARNESS_IDENTITY');
  const commonZip = pinned(bundleRoot, 'common.zip', common.archive.sha256);
  ensure(hashSources(sourceHashes(decodeZip(commonZip))) === harnessDigest && common.archive.bytes === commonZip.length && common.archive.format === 'zip-store', 'AB_HARNESS_ARCHIVE');
  verifyFiles(harnessRoot, common.sources); verifySourceTree(harnessRoot, common.sources);
  const digest = bundleDigest({ A: variants.A.sourceSetDigest, B: variants.B.sourceSetDigest, harness: harnessDigest });
  ensure(manifest.sourceSetDigest === digest && manifest.id === 'central-snapshot-ab-' + digest.slice(0,16), 'AB_IDENTITY');
  ensure(util.isDeepStrictEqual(manifest.package, parent.package) && util.isDeepStrictEqual(manifest.preservedPackages, parent.preservedPackages), 'AB_PACKAGE_CHANGED');
  ensure(util.isDeepStrictEqual(manifest.runtime, parent.runtime), 'AB_RUNTIME_METADATA_CHANGED');
  const protocol = validateProtocol(json(readFile(harnessRoot, 'test/integration/central-snapshot-ab/protocol.json')));
  const dependencies = {};
  for (const arm of ['A','B']) dependencies[arm] = verifyDependencies ? verifyInstalledDependencies(roots[arm], parent.runtime.dependencyManifests) : { status:'NOT_CHECKED', treeBytesPinned:false };
  return { status:'PASS', id:manifest.id, sourceSetDigest:digest, manifestSha256:sha(manifestBytes), bundleRoot, harnessRoot,
    harnessDigest, harnessSourceCount:sharedPaths.length, variants, dependencies, parentId:PARENT.id, packageDigest:parent.package.packageDigest,
    archiveEntriesContentAndCrcVerified:true, runtimeDifferences:[...OVERLAY_PATHS], protocol };
}
function main(args = process.argv.slice(2)) {
  ensure(args.length === 2 && args[0] === '--manifest', 'AB_MANIFEST_REQUIRED');
  return verifyAB({ manifestPath:args[1], verifyDependencies:true });
}
if (require.main === module) {
  try { process.stdout.write(JSON.stringify(main()) + '\n'); }
  catch (error) { process.stderr.write(JSON.stringify({status:'FAIL',code:error.code?.startsWith('AB_')?error.code:'AB_VERIFICATION_FAILED',...(error.file?{file:error.file}:{})})+'\n'); process.exitCode=1; }
}
module.exports = { ...archive, PARENT, OVERLAY_PATHS, REGRESSION_PATHS, EXPLICIT_SHARED, REQUIRED_HARNESS, sharedAllowed, bundleDigest, deriveVariant, validateProtocol, verifyAB, main };
