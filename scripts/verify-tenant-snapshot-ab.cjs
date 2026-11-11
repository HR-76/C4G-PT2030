'use strict';
// Builtins and archive primitives only: no application, SQL or infrastructure.
const fs=require('node:fs'),path=require('node:path'),util=require('node:util');
const archive=require('../test/integration/tenant-snapshot-ab/archive.cjs');
const {sha,hashSources,sourceHashes,decodeZip,readFile,pinned,verifyFiles,verifySourceTree,verifyInstalledDependencies,contained,ensure,json}=archive;
const PARENT=Object.freeze({
 folder:'output/central-snapshot-ab-5b9e4e70caa94f49a881fc11b39a47bb',
 id:'central-snapshot-ab-58f2f8910abee80f',variant:'B',sourceCount:1844,
 sourceSetDigest:'30005d5709224972d241530ff197282a75826ada308f7a3699e07b73002c952c',
 manifestSha256:'252c80d48081fe9768d02e9d393060b89d1e32864b62943903aae9bcb9691278',
 archiveSha256:'fc894493de32c39e747753aeeed919cac17134f1e2653e8fc6ef22b3d8267277',
 seedDigest:'3809b44e0f34f7a5f6868b9052fb66af021051292b0b49648b9d0e8876edf3f6'
});
const OVERLAY_PATHS=Object.freeze(['backend/src/security/tenantSchemaFingerprint.js']);
// Validation-only changes: three existing files and one explicit new regression.
// The observer helper belongs to the test harness, never the runtime allowlist.
const TEST_OVERLAY_PATHS=Object.freeze(['backend/test/dashboardLoadingObserver.test.js','backend/test/tenantSchemaCatalogBatch.test.js','backend/test/tenantSchemaSqlOptimization.test.js','test/integration/dashboard-loading/observer.cjs']);
const TEST_ADDITION_PATHS=Object.freeze(['backend/test/tenantSchemaSqlOptimization.test.js']);
const EXPLICIT_SHARED=Object.freeze(['scripts/prepare-tenant-snapshot-ab.cjs','scripts/verify-tenant-snapshot-ab.cjs','context/features/tenant-snapshot-sql-performance.md','test/tenant-snapshot-ab-package.test.cjs']);
const REQUIRED_HARNESS=Object.freeze(['archive.cjs','run.cjs','metadata.cjs','tenant-equivalence.cjs','equivalence.cjs','authority-drift.cjs','readiness-observer.cjs','protocol.json','README.md','analyze.cjs','analyze.test.cjs'].map(file=>'test/integration/tenant-snapshot-ab/'+file));
const equal=(a,b)=>util.isDeepStrictEqual(a,b);
function sharedAllowed(file){return EXPLICIT_SHARED.includes(file)||/^test\/tenant-snapshot-ab(?:-[a-z0-9-]+)?\.test\.cjs$/.test(file)||/^test\/integration\/tenant-snapshot-ab\/[a-z0-9-]+(?:\.test)?\.(?:cjs|json|md)$/.test(file)||file==='test/integration/tenant-snapshot-ab/README.md'}
function bundleDigest({A,B,harness}){for(const value of [A,B,harness])ensure(/^[a-f0-9]{64}$/.test(value||''),'AB_INVALID_DIGEST');return sha(JSON.stringify({A,B,harness}))}
function verifyParent(manifestBytes,archiveBytes){
 ensure(sha(manifestBytes)===PARENT.manifestSha256,'AB_PARENT_MANIFEST_PIN');
 ensure(sha(archiveBytes)===PARENT.archiveSha256,'AB_PARENT_ARCHIVE_PIN');
 const parent=json(manifestBytes),spec=parent.variants?.[PARENT.variant];
 ensure(parent.schemaVersion===1&&parent.kind==='CENTRAL_SECURITY_SNAPSHOT_AB'&&parent.id===PARENT.id,'AB_PARENT_IDENTITY');
 ensure(spec?.sourceSetDigest===PARENT.sourceSetDigest&&spec.sourceCount===PARENT.sourceCount&&spec.archive?.sha256===PARENT.archiveSha256&&spec.archive.bytes===archiveBytes.length,'AB_PARENT_VARIANT');
 const files=decodeZip(archiveBytes);
 ensure(files.size===PARENT.sourceCount&&hashSources(spec.sources)===PARENT.sourceSetDigest&&hashSources(sourceHashes(files))===PARENT.sourceSetDigest,'AB_PARENT_CONTENT');
 return {parent,files};
}
function deriveVariant(parentFiles,overlays,tests){
 ensure(overlays instanceof Map&&equal([...overlays.keys()].sort(),[...OVERLAY_PATHS]),'AB_OVERLAY_SET');
 ensure(tests instanceof Map&&equal([...tests.keys()].sort(),[...TEST_OVERLAY_PATHS]),'AB_TEST_OVERLAY_SET');
 const result=new Map(parentFiles);
 for(const[file,bytes]of overlays){ensure(parentFiles.has(file),'AB_OVERLAY_PARENT',file);ensure(Buffer.isBuffer(bytes)&&!bytes.equals(parentFiles.get(file)),'AB_OVERLAY_UNCHANGED',file);result.set(file,bytes)}
 for(const file of TEST_OVERLAY_PATHS)ensure(parentFiles.has(file)!==TEST_ADDITION_PATHS.includes(file),'AB_TEST_PARENT_SHAPE',file);
 for(const[file,bytes]of tests){ensure(Buffer.isBuffer(bytes)&&bytes.length>0&&(!parentFiles.has(file)||!bytes.equals(parentFiles.get(file))),'AB_TEST_OVERLAY_UNCHANGED',file);result.set(file,bytes)}
 return result;
}
function validateProtocol(protocol){
 ensure(protocol?.schemaVersion===1&&protocol.id==='tenant-security-snapshot-ab-v1'&&protocol.parentId===PARENT.id&&protocol.parentVariant===PARENT.variant&&protocol.parentSourceSetDigest===PARENT.sourceSetDigest&&protocol.seedDigest===PARENT.seedDigest,'AB_PROTOCOL_IDENTITY');
 const pairOrder=[['A','B'],['B','A'],['A','B'],['B','A'],['A','B'],['B','A']];
 ensure(equal(protocol.metadata,{collector:'COMPLETE_TENANT_SCHEMA_SNAPSHOT_WITH_ALL_SECURITY_READS',centralRevision:'043',tenantRevision:'034',tenants:[0,1],pairOrder,warmupsPerBlock:10,measuredPerBlock:100,measuredPerArmPerTenant:600,totalMeasured:2400,totalWarmups:240,connectionsPerBlock:1,fixture:'ONE_SHARED_FIXTURE_TWO_TENANTS_BOTH_ARMS'}),'AB_METADATA_PROTOCOL');
 ensure(equal(protocol.http,{revision:'043',pairOrder:pairOrder.slice(0,4),attemptsPerArm:36,warmupsPerArm:7,totalAttempts:288,totalWarmups:56,fixture:'NEW_PER_ARM_WITH_FUNCTIONAL_HTTP_OIDC_READINESS',matrix:'UNCHANGED_FROZEN_EU_WRITER_HTTP_REPLICA'}),'AB_HTTP_PROTOCOL');
 ensure(equal(protocol.budgets,{setup:300000,metadataBlock:300000,httpScenario:180000,drain:30000,cleanup:120000}),'AB_BUDGETS_CHANGED');
 ensure(protocol.clock==='MONOTONIC'&&protocol.quantiles==='NEAREST_RANK'&&protocol.roundBeforeDecision===false,'AB_TIMING_PROTOCOL');
 ensure(equal(protocol.execution,{sequential:true,concurrentTestsOrBuilds:false,habitualEnvironmentAccess:false,writerActive:false,c6:false,profilingOutsideMeasurements:true}),'AB_EXECUTION_PROTOCOL');
 const images={postgres:{id:'sha256:77f585114c32fbca283dc835b0596f4e52b51b4c6662d7810b2f4084f60a1873',repositoryDigests:['postgres@sha256:77f585114c32fbca283dc835b0596f4e52b51b4c6662d7810b2f4084f60a1873'],sourceTag:'postgres:18-alpine'},keycloak:{id:'sha256:b0f60d489d51c5d113390bdf5461d4c06e6051be026c05549f2e1e10ec352bcc',repositoryDigests:['quay.io/keycloak/keycloak@sha256:b0f60d489d51c5d113390bdf5461d4c06e6051be026c05549f2e1e10ec352bcc'],sourceTag:'quay.io/keycloak/keycloak:26.8.0'}};
 ensure(equal(protocol.images,images),'AB_IMAGES_CHANGED');return protocol;
}
function verifyAB({manifestPath,expectedHarnessRoot,verifyDependencies=false}={}){
 ensure(typeof manifestPath==='string'&&path.basename(manifestPath)==='ab.json','AB_MANIFEST_REQUIRED');
 const bundleRoot=fs.realpathSync(path.dirname(path.resolve(manifestPath))),manifestBytes=readFile(bundleRoot,'ab.json'),manifest=json(manifestBytes);
 ensure(manifest.schemaVersion===1&&manifest.kind==='TENANT_SECURITY_SNAPSHOT_AB'&&/^[a-f0-9]{32}$/.test(manifest.bundleId||''),'AB_INVALID_MANIFEST');
 ensure(equal(manifest.parent,{kind:'AB_VARIANT',id:PARENT.id,variant:PARENT.variant,sourceSetDigest:PARENT.sourceSetDigest,manifest:{path:'provenance/parent-ab.json',sha256:PARENT.manifestSha256},archive:{path:'provenance/parent-B-sources.zip',sha256:PARENT.archiveSha256}}),'AB_PARENT_PIN');
 const {parent,files:original}=verifyParent(pinned(bundleRoot,'provenance/parent-ab.json',PARENT.manifestSha256),pinned(bundleRoot,'provenance/parent-B-sources.zip',PARENT.archiveSha256));
 ensure(equal(Object.keys(manifest.variants||{}).sort(),['A','B']),'AB_VARIANTS');
 ensure(equal(Object.keys(manifest.overlays||{}).sort(),[...OVERLAY_PATHS])&&equal(Object.keys(manifest.testOverlays||{}).sort(),[...TEST_OVERLAY_PATHS]),'AB_OVERLAY_SET');
 const variants={},roots={};
 for(const arm of ['A','B']){
  const spec=manifest.variants[arm];ensure(spec.sourceRoot===arm+'/sources'&&spec.archive?.path===arm+'/sources.zip','AB_VARIANT_LAYOUT');
  const root=fs.realpathSync(path.join(bundleRoot,spec.sourceRoot));ensure(contained(bundleRoot,root),'AB_PATH_ESCAPE');roots[arm]=root;
  const expected=arm==='A'?original:deriveVariant(original,new Map(OVERLAY_PATHS.map(file=>[file,readFile(root,file)])),new Map(TEST_OVERLAY_PATHS.map(file=>[file,readFile(root,file)])));
  const hashes=sourceHashes(expected),digest=hashSources(hashes),expectedCount=PARENT.sourceCount+(arm==='B'?TEST_ADDITION_PATHS.length:0);
  ensure(expected.size===expectedCount&&spec.sourceCount===expectedCount&&spec.sourceSetDigest===digest&&hashSources(spec.sources)===digest,'AB_VARIANT_DERIVATION');
  const zip=pinned(bundleRoot,spec.archive.path,spec.archive.sha256);
  ensure(spec.archive.format==='zip-store'&&spec.archive.bytes===zip.length&&hashSources(sourceHashes(decodeZip(zip)))===digest,'AB_VARIANT_ARCHIVE');
  if(arm==='A')ensure(sha(zip)===PARENT.archiveSha256&&digest===PARENT.sourceSetDigest,'AB_A_ARCHIVE_PIN');
  verifyFiles(root,hashes);verifySourceTree(root,hashes);variants[arm]={sourceRoot:root,sourceSetDigest:digest,sourceCount:expectedCount,archiveSha256:spec.archive.sha256};
  if(arm==='B')for(const[file,type]of [...OVERLAY_PATHS.map(file=>[file,'overlays']),...TEST_OVERLAY_PATHS.map(file=>[file,'testOverlays'])])ensure(equal(manifest[type][file],{before:parent.variants.B.sources[file]??null,after:hashes[file]}),'AB_OVERLAY_HASH',file);
 }
 const common=manifest.harness;ensure(common?.sourceRoot==='common'&&common.archive?.path==='common.zip','AB_HARNESS_LAYOUT');
 const harnessRoot=fs.realpathSync(path.join(bundleRoot,'common'));ensure(contained(bundleRoot,harnessRoot),'AB_PATH_ESCAPE');
 if(expectedHarnessRoot!==undefined)ensure(fs.realpathSync(expectedHarnessRoot)===harnessRoot,'AB_HARNESS_ROOT_MISMATCH');
 const sharedPaths=Object.keys(common.sources||{});ensure(sharedPaths.every(sharedAllowed)&&[...EXPLICIT_SHARED,...REQUIRED_HARNESS].every(file=>sharedPaths.includes(file)),'AB_SHARED_SET');
 const harnessDigest=hashSources(common.sources);ensure(common.sourceSetDigest===harnessDigest&&common.sourceCount===sharedPaths.length,'AB_HARNESS_IDENTITY');
 const commonZip=pinned(bundleRoot,'common.zip',common.archive.sha256);ensure(common.archive.format==='zip-store'&&common.archive.bytes===commonZip.length&&hashSources(sourceHashes(decodeZip(commonZip)))===harnessDigest,'AB_HARNESS_ARCHIVE');
 verifyFiles(harnessRoot,common.sources);verifySourceTree(harnessRoot,common.sources);
 const digest=bundleDigest({A:variants.A.sourceSetDigest,B:variants.B.sourceSetDigest,harness:harnessDigest});ensure(manifest.sourceSetDigest===digest&&manifest.id==='tenant-snapshot-ab-'+digest.slice(0,16),'AB_IDENTITY');
 ensure(equal(manifest.package,parent.package)&&equal(manifest.preservedPackages,parent.preservedPackages),'AB_PACKAGE_CHANGED');ensure(equal(manifest.runtime,parent.runtime),'AB_RUNTIME_METADATA_CHANGED');
 const protocol=validateProtocol(json(readFile(harnessRoot,'test/integration/tenant-snapshot-ab/protocol.json'))),dependencies={};
 for(const arm of ['A','B'])dependencies[arm]=verifyDependencies?verifyInstalledDependencies(roots[arm],parent.runtime.dependencyManifests):{status:'NOT_CHECKED',treeBytesPinned:false};
 return {status:'PASS',id:manifest.id,sourceSetDigest:digest,manifestSha256:sha(manifestBytes),bundleRoot,harnessRoot,harnessDigest,harnessSourceCount:sharedPaths.length,variants,dependencies,parentId:PARENT.id,parentVariant:PARENT.variant,parentSourceSetDigest:PARENT.sourceSetDigest,packageDigest:parent.package.packageDigest,archiveEntriesContentAndCrcVerified:true,runtimeDifferences:[...OVERLAY_PATHS],testDifferences:[...TEST_OVERLAY_PATHS],protocol};
}
function main(args=process.argv.slice(2)){ensure(args.length===2&&args[0]==='--manifest','AB_MANIFEST_REQUIRED');return verifyAB({manifestPath:args[1],verifyDependencies:true})}
if(require.main===module){try{process.stdout.write(JSON.stringify(main())+'\n')}catch(error){process.stderr.write(JSON.stringify({status:'FAIL',code:error.code?.startsWith('AB_')?error.code:'AB_VERIFICATION_FAILED',...(error.file?{file:error.file}:{})})+'\n');process.exitCode=1}}
module.exports={...archive,PARENT,OVERLAY_PATHS,TEST_OVERLAY_PATHS,TEST_ADDITION_PATHS,EXPLICIT_SHARED,REQUIRED_HARNESS,sharedAllowed,bundleDigest,verifyParent,deriveVariant,validateProtocol,verifyAB,main};
