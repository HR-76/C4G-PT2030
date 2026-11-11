'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {PARENT,OVERLAY_PATHS,TEST_OVERLAY_PATHS,EXPLICIT_SHARED,REQUIRED_HARNESS,deriveVariant,verifyParent,validateProtocol,verifyAB,sharedAllowed,sha,encodeZip,decodeZip,sourceHashes,hashSources}=require('../scripts/verify-tenant-snapshot-ab.cjs');
const {parseArgs,resolveDestination,readCandidate,prepareAB}=require('../scripts/prepare-tenant-snapshot-ab.cjs');
const ROOT=path.resolve(__dirname,'..'),runtime=OVERLAY_PATHS[0];
const NEW_TEST='backend/test/tenantSchemaSqlOptimization.test.js';
const COMPATIBILITY_PATHS=['backend/test/dashboardLoadingObserver.test.js','test/integration/dashboard-loading/observer.cjs'];
function temp(t){const root=fs.mkdtempSync(path.join(__dirname,'.tenant-ab-package-'));t.after(()=>{assert(path.dirname(root)===__dirname&&path.basename(root).startsWith('.tenant-ab-package-'));fs.rmSync(root,{recursive:true,force:true})});return root}
function put(root,file,bytes){const target=path.join(root,file);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,bytes)}
function originals(){return new Map([[runtime,Buffer.from('baseline tenant')],...TEST_OVERLAY_PATHS.filter(file=>file!==NEW_TEST).map(file=>[file,Buffer.from('baseline test '+file)]),['backend/src/security/authorityCoordinator.js',Buffer.from('fixed authority')]])}
function runtimeOverlay(){return new Map([[runtime,Buffer.from('candidate tenant SQL')]])}
function testOverlays(){return new Map(TEST_OVERLAY_PATHS.map(p=>[p,Buffer.from('candidate regression '+p)]))}
const protocol=()=>JSON.parse(fs.readFileSync(path.join(ROOT,'test/integration/tenant-snapshot-ab/protocol.json'),'utf8'));

test('derivation changes one runtime and explicit validation files while preserving all other parent bytes',()=>{
 const before=originals(),after=deriveVariant(before,runtimeOverlay(),testOverlays());assert.equal(after.size,before.size+1);
 assert.deepEqual(before.get(runtime),Buffer.from('baseline tenant'));assert.equal(after.get('backend/src/security/authorityCoordinator.js'),before.get('backend/src/security/authorityCoordinator.js'));
 assert.deepEqual(after.get(runtime),runtimeOverlay().get(runtime));for(const p of TEST_OVERLAY_PATHS)assert.deepEqual(after.get(p),testOverlays().get(p));
});
test('validation compatibility adds exactly the named observer helper and its test, never runtime',()=>{
 const expected=['backend/test/tenantSchemaCatalogBatch.test.js',NEW_TEST,...COMPATIBILITY_PATHS].sort();assert.deepEqual([...TEST_OVERLAY_PATHS].sort(),expected);
 assert.deepEqual(OVERLAY_PATHS,['backend/src/security/tenantSchemaFingerprint.js']);
 const before=originals(),after=deriveVariant(before,runtimeOverlay(),testOverlays());
 for(const file of COMPATIBILITY_PATHS){assert(before.has(file));assert.deepEqual(after.get(file),testOverlays().get(file));const missing=testOverlays();missing.delete(file);assert.throws(()=>deriveVariant(before,runtimeOverlay(),missing),/AB_TEST_OVERLAY_SET/);const absent=new Map(before);absent.delete(file);assert.throws(()=>deriveVariant(absent,runtimeOverlay(),testOverlays()),/AB_TEST_PARENT_SHAPE/)}
});
test('runtime additions, extra overlays, missing and unchanged overlays are refused',()=>{
 const extra=runtimeOverlay();extra.set('backend/src/security/authorityCoordinator.js',Buffer.from('changed'));
 assert.throws(()=>deriveVariant(originals(),extra,testOverlays()),/AB_OVERLAY_SET/);
 assert.throws(()=>deriveVariant(originals(),new Map(),testOverlays()),/AB_OVERLAY_SET/);
 assert.throws(()=>deriveVariant(originals(),new Map([[runtime,originals().get(runtime)]]),testOverlays()),/AB_OVERLAY_UNCHANGED/);
 const absent=originals();absent.delete(runtime);assert.throws(()=>deriveVariant(absent,runtimeOverlay(),testOverlays()),/AB_OVERLAY_PARENT/);
});
test('test supplements cannot smuggle runtime changes or silently replace an unexpected parent test',()=>{
 const extra=testOverlays();extra.set('backend/src/security/authorityCoordinator.js',Buffer.from('changed'));
 assert.throws(()=>deriveVariant(originals(),runtimeOverlay(),extra),/AB_TEST_OVERLAY_SET/);
 assert.throws(()=>deriveVariant(originals(),runtimeOverlay(),new Map()),/AB_TEST_OVERLAY_SET/);
 const existing=originals();existing.set(NEW_TEST,Buffer.from('unexpected'));
 assert.throws(()=>deriveVariant(existing,runtimeOverlay(),testOverlays()),/AB_TEST_PARENT_SHAPE/);
});
test('parent is the pinned B variant, not the preceding A or a fabricated trial',()=>{
 const manifestBytes=fs.readFileSync(path.join(ROOT,PARENT.folder,'ab.json')),archive=fs.readFileSync(path.join(ROOT,PARENT.folder,'B/sources.zip'));
 const selected=verifyParent(manifestBytes,archive);assert.equal(selected.files.size,1844);assert.equal(selected.parent.id,PARENT.id);assert.equal(hashSources(sourceHashes(selected.files)),PARENT.sourceSetDigest);
 const swapped=JSON.parse(manifestBytes);swapped.variants.B=swapped.variants.A;
 assert.throws(()=>verifyParent(Buffer.from(JSON.stringify(swapped)),archive),/AB_PARENT_MANIFEST_PIN/);
 assert.throws(()=>verifyParent(manifestBytes,fs.readFileSync(path.join(ROOT,PARENT.folder,'A/sources.zip'))),/AB_PARENT_ARCHIVE_PIN/);
});
test('tenant protocol preserves both tenant populations, authority boundaries and the complete HTTP matrix',()=>{
 validateProtocol(protocol());
 for(const mutate of [p=>p.parentVariant='A',p=>p.parentSourceSetDigest='0'.repeat(64),p=>p.metadata.tenants=[0],p=>p.metadata.totalMeasured=1200,p=>p.http.totalAttempts=280,p=>p.budgets.metadataBlock=600000,p=>p.execution.writerActive=true,p=>p.images.postgres.repositoryDigests=[]]){const p=protocol();mutate(p);assert.throws(()=>validateProtocol(p))}
});
test('common allowlist includes explicit tools and tests but excludes unrelated code and private files',()=>{
 for(const file of [...EXPLICIT_SHARED,...REQUIRED_HARNESS,'test/tenant-snapshot-ab-runner.test.cjs','test/integration/tenant-snapshot-ab/analyze.test.cjs'])assert.equal(sharedAllowed(file),true,file);
 for(const file of [runtime,'backend/.env','backend/test/unrelated.test.js','test/integration/central-snapshot-ab/run.cjs','test/integration/tenant-snapshot-ab/secret.key'])assert.equal(sharedAllowed(file),false,file);
});
test('candidate capture reads exactly the allowed isolated files and never falls back to the live runtime',t=>{
 const root=temp(t),folder='output/candidate';for(const[p,b]of [...runtimeOverlay(),...testOverlays()])put(root,folder+'/'+p,b);put(root,runtime,'unrelated live optimization');
 const candidate=readCandidate(root,folder);assert.deepEqual(candidate.runtime.get(runtime),runtimeOverlay().get(runtime));
 put(root,folder+'/backend/src/unrelated.js','extra');assert.throws(()=>readCandidate(root,folder),/AB_CANDIDATE_EXTRA/);
});
test('candidate paths refuse traversal, workspace escape and excluded aliases',t=>{
 const root=temp(t),outside=temp(t);fs.mkdirSync(path.join(root,'output'));fs.symlinkSync(outside,path.join(root,'output','candidate'),process.platform==='win32'?'junction':'dir');
 assert.throws(()=>readCandidate(root,'../candidate'));assert.throws(()=>readCandidate(root,'output/candidate'),/AB_CANDIDATE_ESCAPE/);
});
test('candidate aliases cannot select an excluded or non-output workspace tree',t=>{
 const root=temp(t);fs.mkdirSync(path.join(root,'output'));
 for(const target of ['.cache/candidate','live-candidate']){
  for(const[p,b]of [...runtimeOverlay(),...testOverlays()])put(root,target+'/'+p,b);
  const alias=path.join(root,'output',target.startsWith('.')?'excluded':'live');fs.symlinkSync(path.join(root,target),alias,process.platform==='win32'?'junction':'dir');
  assert.throws(()=>readCandidate(root,'output/'+path.basename(alias)),/AB_CANDIDATE_ESCAPE|AB_EXCLUDED_PATH/);
 }
});
test('preparation requires an explicit candidate and an unused contained destination',t=>{
 assert.deepEqual(parseArgs(['--prepare','--candidate-root','output/candidate']),{candidateRoot:'output/candidate'});
 for(const args of [[],['--prepare'],['--prepare','--candidate-root','backend'],['--prepare','--candidate-root','output/candidate','--force']])assert.throws(()=>parseArgs(args));
 const root=temp(t);fs.mkdirSync(path.join(root,'output'));const destination=resolveDestination(root,'a'.repeat(32));assert.equal(path.dirname(destination),path.join(root,'output'));
 fs.mkdirSync(destination);assert.throws(()=>resolveDestination(root,'a'.repeat(32)),/AB_DESTINATION_EXISTS/);
});
test('output junction cannot write outside the workspace',t=>{
 const root=temp(t),outside=temp(t);fs.symlinkSync(outside,path.join(root,'output'),process.platform==='win32'?'junction':'dir');assert.throws(()=>resolveDestination(root,'a'.repeat(32)),/AB_DESTINATION_ESCAPE/);assert.deepEqual(fs.readdirSync(outside),[]);
});
test('complete package retains the selected parent ZIP, separates test changes and detects tampering',t=>{
 const root=temp(t);fs.mkdirSync(path.join(root,'output'));
 for(const file of ['ab.json','B/sources.zip'])put(root,PARENT.folder+'/'+file,fs.readFileSync(path.join(ROOT,PARENT.folder,file)));
 const parent=decodeZip(fs.readFileSync(path.join(ROOT,PARENT.folder,'B/sources.zip'))),candidateRoot='output/candidate';
 for(const file of [runtime,...TEST_OVERLAY_PATHS])put(root,candidateRoot+'/'+file,Buffer.concat([parent.get(file)||Buffer.from('new test'),Buffer.from('\n// explicit candidate change\n')]));
 for(const file of new Set([...EXPLICIT_SHARED,...REQUIRED_HARNESS]))put(root,file,file.endsWith('/protocol.json')?JSON.stringify(protocol()):'fixture common source\n');
 const prepared=prepareAB({root,candidateRoot}),manifestPath=prepared.manifestPath,manifest=JSON.parse(fs.readFileSync(manifestPath,'utf8'));
 assert.equal(prepared.status,'PASS');assert.equal(prepared.variants.A.sourceCount,1844);assert.equal(prepared.variants.B.sourceCount,1845);
 assert.equal(prepared.variants.A.sourceSetDigest,PARENT.sourceSetDigest);assert.equal(sha(fs.readFileSync(path.join(path.dirname(manifestPath),'A/sources.zip'))),PARENT.archiveSha256);
 assert.deepEqual(prepared.runtimeDifferences,OVERLAY_PATHS);assert.deepEqual(prepared.testDifferences,TEST_OVERLAY_PATHS);assert.equal(manifest.parent.kind,'AB_VARIANT');assert.equal(manifest.parent.variant,'B');
 assert.equal(manifest.testOverlays[NEW_TEST].before,null);for(const file of COMPATIBILITY_PATHS)assert.equal(manifest.testOverlays[file].before,sha(parent.get(file)));assert.deepEqual(manifest.package,JSON.parse(fs.readFileSync(path.join(ROOT,PARENT.folder,'ab.json'),'utf8')).package);
 const file=path.join(prepared.variants.B.sourceRoot,'backend/src/security/authorityCoordinator.js'),original=fs.readFileSync(file);fs.appendFileSync(file,'\n// drift');assert.throws(()=>verifyAB({manifestPath}),/AB_SOURCE_CHANGED/);fs.writeFileSync(file,original);
 const archivePath=path.join(path.dirname(manifestPath),'B/sources.zip'),archive=fs.readFileSync(archivePath),corrupt=Buffer.from(archive);corrupt[40]^=1;fs.writeFileSync(archivePath,corrupt);assert.throws(()=>verifyAB({manifestPath}),/AB_PIN_CHANGED/);fs.writeFileSync(archivePath,archive);
 put(prepared.variants.B.sourceRoot,'backend/src/silent-extra.js','extra');assert.throws(()=>verifyAB({manifestPath}),/AB_UNTRACKED_SOURCE/);
});
