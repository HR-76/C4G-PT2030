'use strict';
const fs=require('node:fs'),path=require('node:path'),{randomUUID}=require('node:crypto');
const {PARENT,OVERLAY_PATHS,TEST_OVERLAY_PATHS,EXPLICIT_SHARED,REQUIRED_HARNESS,sharedAllowed,bundleDigest,verifyParent,deriveVariant,sha,hashSources,sourceHashes,encodeZip,safeRelative,readFile,pinned,contained,ensure,verifyAB}=require('./verify-tenant-snapshot-ab.cjs');
const ROOT=path.resolve(__dirname,'..');
function parseArgs(args){ensure(args.length===3&&args[0]==='--prepare'&&args[1]==='--candidate-root','AB_EXPLICIT_PREPARE_REQUIRED');safeRelative(args[2]);ensure(args[2].startsWith('output/'),'AB_CANDIDATE_ROOT_REQUIRED');return {candidateRoot:args[2]}}
function resolveDestination(root,bundleId){ensure(/^[a-f0-9]{32}$/.test(bundleId),'AB_INVALID_BUNDLE_ID');const actual=fs.realpathSync(root),output=fs.realpathSync(path.join(actual,'output'));ensure(contained(actual,output)&&fs.statSync(output).isDirectory(),'AB_DESTINATION_ESCAPE');const destination=path.join(output,'tenant-snapshot-ab-'+bundleId);ensure(!fs.existsSync(destination),'AB_DESTINATION_EXISTS');return destination}
function readCandidate(root,candidateRoot){
 safeRelative(candidateRoot);ensure(candidateRoot.startsWith('output/'),'AB_CANDIDATE_ROOT_REQUIRED');root=fs.realpathSync(root);
 const actual=fs.realpathSync(path.join(root,candidateRoot));ensure(contained(root,actual)&&fs.statSync(actual).isDirectory(),'AB_CANDIDATE_ESCAPE');
 const actualRelative=path.relative(root,actual).split(path.sep).join('/');safeRelative(actualRelative);ensure(actualRelative.startsWith('output/'),'AB_CANDIDATE_ESCAPE');
 const allowed=[...OVERLAY_PATHS,...TEST_OVERLAY_PATHS],found=[];
 function visit(folder){for(const entry of fs.readdirSync(path.join(actual,folder),{withFileTypes:true})){const file=folder?folder+'/'+entry.name:entry.name;safeRelative(file);ensure(!entry.isSymbolicLink(),'AB_CANDIDATE_ALIAS',file);if(entry.isDirectory())visit(file);else{ensure(entry.isFile()&&allowed.includes(file),'AB_CANDIDATE_EXTRA',file);found.push(file)}}}
 visit('');ensure(found.length===allowed.length&&allowed.every(file=>found.includes(file)),'AB_CANDIDATE_INCOMPLETE');
 return {root:actual,runtime:new Map(OVERLAY_PATHS.map(file=>[file,readFile(actual,file)])),tests:new Map(TEST_OVERLAY_PATHS.map(file=>[file,readFile(actual,file)]))};
}
function collectShared(root){
 const files=new Set(EXPLICIT_SHARED),folder='test/integration/tenant-snapshot-ab';
 for(const entry of fs.readdirSync(path.join(root,folder),{withFileTypes:true})){const file=folder+'/'+entry.name;ensure(entry.isFile()&&!entry.isSymbolicLink()&&sharedAllowed(file),'AB_SHARED_PATH_REFUSED',file);files.add(file)}
 for(const entry of fs.readdirSync(path.join(root,'test'),{withFileTypes:true})){if(/^tenant-snapshot-ab(?:-[a-z0-9-]+)?\.test\.cjs$/.test(entry.name)){const file='test/'+entry.name;ensure(entry.isFile()&&!entry.isSymbolicLink(),'AB_SHARED_PATH_REFUSED',file);files.add(file)}}
 for(const file of REQUIRED_HARNESS)ensure(files.has(file),'AB_REQUIRED_HARNESS_MISSING',file);
 const result=[...files].sort();for(const file of result)readFile(root,file);return result;
}
function prepareAB({root=ROOT,candidateRoot}={}){
 root=fs.realpathSync(root);const parentBytes=pinned(root,PARENT.folder+'/ab.json',PARENT.manifestSha256),parentZip=pinned(root,PARENT.folder+'/B/sources.zip',PARENT.archiveSha256),{parent,files:original}=verifyParent(parentBytes,parentZip);
 const inputs=readCandidate(root,candidateRoot),candidate=deriveVariant(original,inputs.runtime,inputs.tests);
 const sharedPaths=collectShared(root),shared=new Map(sharedPaths.map(file=>[file,readFile(root,file)])),zipped={A:parentZip,B:encodeZip(candidate),common:encodeZip(shared)},variants={};
 for(const[arm,files]of [['A',original],['B',candidate]]){const sources=sourceHashes(files);variants[arm]={sourceRoot:arm+'/sources',sourceCount:files.size,sourceSetDigest:hashSources(sources),sources,archive:{path:arm+'/sources.zip',sha256:sha(zipped[arm]),bytes:zipped[arm].length,format:'zip-store'}}}
 const sharedHashes=sourceHashes(shared),harnessDigest=hashSources(sharedHashes),sourceSetDigest=bundleDigest({A:variants.A.sourceSetDigest,B:variants.B.sourceSetDigest,harness:harnessDigest});
 const bundleId=randomUUID().replaceAll('-',''),folder=resolveDestination(root,bundleId);
 const changes=files=>Object.fromEntries(files.map(file=>[file,{before:parent.variants.B.sources[file]??null,after:variants.B.sources[file]}]));
 const manifest={schemaVersion:1,kind:'TENANT_SECURITY_SNAPSHOT_AB',id:'tenant-snapshot-ab-'+sourceSetDigest.slice(0,16),bundleId,capturedAt:new Date().toISOString(),status:'SOURCE_SNAPSHOT_ONLY',sourceSetDigest,
  parent:{kind:'AB_VARIANT',id:PARENT.id,variant:PARENT.variant,sourceSetDigest:PARENT.sourceSetDigest,manifest:{path:'provenance/parent-ab.json',sha256:PARENT.manifestSha256},archive:{path:'provenance/parent-B-sources.zip',sha256:PARENT.archiveSha256}},
  variants,harness:{sourceRoot:'common',sourceCount:shared.size,sourceSetDigest:harnessDigest,sources:sharedHashes,archive:{path:'common.zip',sha256:sha(zipped.common),bytes:zipped.common.length,format:'zip-store'}},
  overlays:changes(OVERLAY_PATHS),testOverlays:changes(TEST_OVERLAY_PATHS),package:parent.package,preservedPackages:parent.preservedPackages,runtime:parent.runtime,
  derivation:'A is the exact pinned B-variant archive of the previous A/B. B changes one runtime SQL source and four explicitly named validation-only files: three replacements, including the dashboard observer helper and its test, plus one new regression. Validation files are distinguished from runtime changes. All candidate bytes come from the isolated candidate root.',
  limits:['No application modules, services, SQL or workloads execute during capture.','No live runtime or unspecified candidate file is copied.','Installed dependency versions and lockfiles are checked; dependency tree bytes are not archived.','Every capture uses a new directory; existing bundles and failures are preserved.']};
 function write(file,bytes){safeRelative(file.replace(/^(?:A|B)\/sources\//,''));const target=path.resolve(folder,file);ensure(contained(folder,target),'AB_PATH_ESCAPE');fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,bytes,{flag:'wx'})}
 fs.mkdirSync(folder);for(const[arm,files]of [['A',original],['B',candidate],['common',shared]])for(const[file,bytes]of files)write((arm==='common'?'common/':arm+'/sources/')+file,bytes);
 write('provenance/parent-ab.json',parentBytes);write('provenance/parent-B-sources.zip',parentZip);for(const[name,bytes]of Object.entries(zipped))write(name==='common'?'common.zip':name+'/sources.zip',bytes);write('ab.json',Buffer.from(JSON.stringify(manifest,null,2)+'\n'));
 const after=readCandidate(root,candidateRoot);for(const[file,bytes]of [...inputs.runtime,...inputs.tests])ensure(sha((after.runtime.get(file)||after.tests.get(file)))===sha(bytes),'AB_INPUT_CHANGED_DURING_CAPTURE',file);
 for(const[file,bytes]of shared)ensure(sha(readFile(root,file))===sha(bytes),'AB_INPUT_CHANGED_DURING_CAPTURE',file);ensure(JSON.stringify(collectShared(root))===JSON.stringify(sharedPaths),'AB_SHARED_SET_CHANGED_DURING_CAPTURE');
 return {...verifyAB({manifestPath:path.join(folder,'ab.json')}),manifestPath:path.join(folder,'ab.json')};
}
if(require.main===module){try{process.stdout.write(JSON.stringify(prepareAB(parseArgs(process.argv.slice(2))))+'\n')}catch(error){process.stderr.write(JSON.stringify({status:'FAIL',code:error.code?.startsWith('AB_')?error.code:'AB_PREPARATION_FAILED',...(error.file?{file:error.file}:{})})+'\n');process.exitCode=1}}
module.exports={parseArgs,resolveDestination,readCandidate,collectShared,prepareAB};
