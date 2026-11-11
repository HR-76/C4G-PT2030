'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { PARENT, OVERLAY_PATHS, EXPLICIT_SHARED, REQUIRED_HARNESS, sharedAllowed, bundleDigest, deriveVariant,
  sha, hashSources, sourceHashes, encodeZip, decodeZip, safeRelative, readFile, pinned, contained, ensure, verifyAB } = require('./verify-central-snapshot-ab.cjs');
const ROOT = path.resolve(__dirname, '..');
function parseArgs(args) { ensure(args.length === 1 && args[0] === '--prepare', 'AB_EXPLICIT_PREPARE_REQUIRED'); return { prepare:true }; }
function resolveDestination(root, bundleId) {
  ensure(/^[a-f0-9]{32}$/.test(bundleId), 'AB_INVALID_BUNDLE_ID');
  const actualRoot = fs.realpathSync(root), output = fs.realpathSync(path.join(actualRoot, 'output'));
  ensure(contained(actualRoot, output) && fs.statSync(output).isDirectory(), 'AB_DESTINATION_ESCAPE');
  const destination = path.join(output, 'central-snapshot-ab-' + bundleId);
  ensure(!fs.existsSync(destination), 'AB_DESTINATION_EXISTS'); return destination;
}
function collectShared(root) {
  const files = new Set(EXPLICIT_SHARED);
  const folder = 'test/integration/central-snapshot-ab';
  for (const entry of fs.readdirSync(path.join(root,folder), {withFileTypes:true})) {
    const file = folder + '/' + entry.name;
    ensure(entry.isFile() && !entry.isSymbolicLink() && sharedAllowed(file), 'AB_SHARED_PATH_REFUSED', file); files.add(file);
  }
  for (const entry of fs.readdirSync(path.join(root,'test'), {withFileTypes:true})) {
    const file = 'test/' + entry.name;
    if (/^central-snapshot-ab(?:-[a-z0-9-]+)?\.test\.cjs$/.test(entry.name)) {
      ensure(entry.isFile() && !entry.isSymbolicLink(), 'AB_SHARED_PATH_REFUSED', file); files.add(file);
    }
  }
  for (const file of REQUIRED_HARNESS) ensure(files.has(file), 'AB_REQUIRED_HARNESS_MISSING', file);
  const result = [...files].sort(); for (const file of result) readFile(root,file); return result;
}
function prepareAB({ root = ROOT } = {}) {
  root = fs.realpathSync(root);
  const parentBytes = pinned(root,PARENT.folder+'/trial.json',PARENT.manifestSha256), parent = JSON.parse(parentBytes);
  const parentZip = pinned(root,PARENT.folder+'/sources.zip',PARENT.archiveSha256), original = decodeZip(parentZip);
  ensure(hashSources(sourceHashes(original)) === PARENT.sourceSetDigest && original.size === PARENT.sourceCount, 'AB_PARENT_CONTENT');
  const overlayFiles = new Map(OVERLAY_PATHS.map(file=>[file,readFile(root,file)])), candidate = deriveVariant(original,overlayFiles);
  const sharedPaths = collectShared(root), shared = new Map(sharedPaths.map(file=>[file,readFile(root,file)]));
  const variants = {}, zipped = { A:parentZip, B:encodeZip(candidate), common:encodeZip(shared) };
  for (const [arm,files] of [['A',original],['B',candidate]]) {
    const sources = sourceHashes(files);
    variants[arm] = { sourceRoot:arm+'/sources', sourceCount:files.size, sourceSetDigest:hashSources(sources), sources,
      archive:{path:arm+'/sources.zip',sha256:sha(zipped[arm]),bytes:zipped[arm].length,format:'zip-store'} };
  }
  const sharedHashes = sourceHashes(shared), harnessDigest = hashSources(sharedHashes);
  const sourceSetDigest = bundleDigest({ A:variants.A.sourceSetDigest,B:variants.B.sourceSetDigest,harness:harnessDigest });
  const bundleId = randomUUID().replaceAll('-',''), folder = resolveDestination(root,bundleId);
  const manifest = { schemaVersion:1,kind:'CENTRAL_SECURITY_SNAPSHOT_AB',id:'central-snapshot-ab-'+sourceSetDigest.slice(0,16),bundleId,
    capturedAt:new Date().toISOString(),status:'SOURCE_SNAPSHOT_ONLY',sourceSetDigest,
    parent:{id:PARENT.id,manifest:{path:'provenance/trial.json',sha256:PARENT.manifestSha256},archive:{path:'provenance/sources.zip',sha256:PARENT.archiveSha256}},
    variants,harness:{sourceRoot:'common',sourceCount:shared.size,sourceSetDigest:harnessDigest,sources:sharedHashes,archive:{path:'common.zip',sha256:sha(zipped.common),bytes:zipped.common.length,format:'zip-store'}},
    overlays:Object.fromEntries(OVERLAY_PATHS.map(file=>[file,{before:parent.sources[file],after:variants.B.sources[file]}])),
    package:parent.package,preservedPackages:parent.preservedPackages,runtime:parent.runtime,
    derivation:'A is the exact pinned 1844-source archive. B replaces only the two named runtime files. Shared harness, contract and regression sources are separately pinned; validation overlays never modify workload roots.',
    limits:['Installed dependency versions and lockfiles are pinned; installed tree bytes are not archived.','No real environment configuration, credentials, TLS files or dependency trees are copied.','No infrastructure, SQL, workload, tests or service is executed by preparation.','Any exploratory failure requires a new bundle; existing bundles remain immutable.'] };
  function write(file,bytes) {
    safeRelative(file.replace(/^(?:A|B)\/sources\//,'')); const target=path.resolve(folder,file); ensure(contained(folder,target),'AB_PATH_ESCAPE');
    fs.mkdirSync(path.dirname(target),{recursive:true}); fs.writeFileSync(target,bytes,{flag:'wx'});
  }
  fs.mkdirSync(folder);
  for (const [arm,files] of [['A',original],['B',candidate],['common',shared]]) for (const [file,bytes] of files) write((arm==='common'?'common/':arm+'/sources/')+file,bytes);
  write('provenance/trial.json',parentBytes);write('provenance/sources.zip',parentZip);
  write('A/sources.zip',zipped.A);write('B/sources.zip',zipped.B);write('common.zip',zipped.common);
  write('ab.json',Buffer.from(JSON.stringify(manifest,null,2)+'\n'));
  for (const [file,bytes] of [...overlayFiles,...shared]) ensure(sha(readFile(root,file))===sha(bytes),'AB_INPUT_CHANGED_DURING_CAPTURE',file);
  ensure(JSON.stringify(collectShared(root))===JSON.stringify(sharedPaths),'AB_SHARED_SET_CHANGED_DURING_CAPTURE');
  const result = verifyAB({manifestPath:path.join(folder,'ab.json')});
  return {...result,manifestPath:path.join(folder,'ab.json')};
}
if (require.main===module) {
  try { parseArgs(process.argv.slice(2));process.stdout.write(JSON.stringify(prepareAB())+'\n'); }
  catch (error) { process.stderr.write(JSON.stringify({status:'FAIL',code:error.code?.startsWith('AB_')?error.code:'AB_PREPARATION_FAILED',...(error.file?{file:error.file}:{})})+'\n');process.exitCode=1; }
}
module.exports={prepareAB,parseArgs,resolveDestination,collectShared};
