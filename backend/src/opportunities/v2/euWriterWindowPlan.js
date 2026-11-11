'use strict';
const fs=require('node:fs'),path=require('node:path');
const {createHash}=require('node:crypto');
const {isDeepStrictEqual}=require('node:util');
const {cloneData,deepFreeze}=require('./data');
const {hash,implementationDigest}=require('./activationArchive');
const {rawSnapshotDigest}=require('./reconciliation');
const {contentDigestV2}=require('./digests');
const {euWriterConfiguration}=require('../../fundingTenders/euWriter');
const pkg=require('../../security/opportunityEuWriterMigrationPackage');
const installed=require('../../security/opportunityV2MigrationPackage');
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/,SHA=/^[a-f0-9]{64}$/;
const ACTIONS=Object.freeze(['INSTALL_043','SELECT_CANONICAL_V2','CONFIGURE_EU_WRITER','RESUME_EU','CONTROLLED_FIRST_CYCLE','SUSPEND_EU_AND_VERIFY']);
const CONTROLLED_CYCLE=Object.freeze({source:'EU_FUNDING_TENDERS',maxCycles:1,observationWindowSeconds:300,finishState:'QUIESCED',automaticNewIdentities:false,automaticV1Migrations:false});
const PRIVATE_FILES=Object.freeze(['backend/.env','.tmp/local-platform/runtime.json','.tmp/local-platform/admissions/worker.json','.tmp/local-platform/members/worker.json','.tmp/local-platform/members/http.json','.tmp/local-platform/members/c4g-activation.properties','.tmp/f2-integration/.env']);
function fail(code='OPPORTUNITY_V2_WINDOW_INVALID'){throw Object.assign(Error(code),{code});}
const exact=(v,keys)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
const relative=p=>typeof p==='string'&&p.length<=256&&!p.includes('\\')&&!p.includes(':')&&p.split('/').every(x=>x&&x!=='.'&&x!=='..');
const instant=v=>typeof v==='string'&&Number.isFinite(Date.parse(v))&&new Date(v).toISOString()===v;
const inputPath=p=>relative(p)&&(PRIVATE_FILES.includes(p)||p==='backend/.env.example'||/^(backend\/src\/|backend\/database\/|backend\/scripts\/|backend\/test\/|scripts\/|frontend\/src\/|test\/|context\/references\/opportunity-v2\/)/.test(p));
function validateEuWriterWindowPlan(raw,now=Date.now()){
 let p;try{p=cloneData(raw,{maxBytes:1024*1024});}catch{fail();}
 if(!exact(p,['kind','windowId','createdAt','expiresAt','package','baseline','writer','source','expected','accepted','evidence','inputs','actions','controlledCycle'])||p.kind!=='eu-writer-window-plan-v1'||!UUID.test(p.windowId)||!instant(p.createdAt)||!instant(p.expiresAt))fail();
 const created=Date.parse(p.createdAt),expires=Date.parse(p.expiresAt);if(created>now+5000||expires<=created||expires>created+3600000)fail();if(expires<=now)fail('OPPORTUNITY_V2_WINDOW_EXPIRED');
 if(!isDeepStrictEqual(p.package,{packageId:pkg.PACKAGE_ID,packageDigest:pkg.packageDigest,sqlSha256:pkg.entry.upChecksum})
 ||!isDeepStrictEqual(p.baseline,{centralVersion:pkg.CENTRAL_BASELINE,tenantVersion:installed.tenantAddition.version,centralFingerprint:installed.centralEntries.at(-1).schemaFingerprint,tenantFingerprint:installed.tenantAddition.schemaFingerprint})
 ||!isDeepStrictEqual(p.writer,euWriterConfiguration())||!isDeepStrictEqual(p.actions,ACTIONS)||!isDeepStrictEqual(p.controlledCycle,CONTROLLED_CYCLE))fail();
 if(!exact(p.source,['state','fence'])||p.source.state!=='QUIESCED'||!Number.isSafeInteger(p.source.fence)||p.source.fence<1
 ||!exact(p.expected,['opportunityId','revisionId','rowVersion'])||!UUID.test(p.expected.opportunityId)||!UUID.test(p.expected.revisionId)||!Number.isSafeInteger(p.expected.rowVersion)||p.expected.rowVersion<1
 ||!exact(p.accepted,['contentDigest','snapshotDigest'])||!Object.values(p.accepted).every(v=>SHA.test(v)))fail();
 if(!exact(p.evidence,['preview','backup','validation'])||!Object.values(p.evidence).every(v=>exact(v,['path','sha256'])&&relative(v.path)&&v.path.startsWith('output/')&&v.path.endsWith('.json')&&SHA.test(v.sha256)))fail();
 if(!p.inputs||Array.isArray(p.inputs)||typeof p.inputs!=='object'||!Object.keys(p.inputs).length||Object.keys(p.inputs).length>3000||!Object.entries(p.inputs).every(([f,h])=>inputPath(f)&&SHA.test(h)))fail();
 return deepFreeze(p);
}
const planDigest=p=>hash(p);
function readSafe(root,relativePath,limit=16*1024*1024){
 if(!relative(relativePath))fail();let file=path.resolve(root);const canonicalRoot=fs.realpathSync(file);
 for(const part of relativePath.split('/')){file=path.join(file,part);if(fs.lstatSync(file).isSymbolicLink())fail();}
 const resolved=fs.realpathSync(file);if(path.relative(canonicalRoot,resolved).startsWith('..')||path.isAbsolute(path.relative(canonicalRoot,resolved))||!fs.statSync(file).isFile()||fs.statSync(file).size>limit)fail();
 return fs.readFileSync(file);
}
function verifiedFile(root,reference){if(!exact(reference,['path','sha256'])||!relative(reference.path)||!reference.path.startsWith('output/')||!reference.path.endsWith('.json')||!SHA.test(reference.sha256))fail();const bytes=readSafe(root,reference.path);if(createHash('sha256').update(bytes).digest('hex')!==reference.sha256)fail('OPPORTUNITY_V2_WINDOW_CHANGED');return JSON.parse(bytes.toString('utf8'));}
function verifyEvidence(root,p){
 const preview=verifiedFile(root,p.evidence.preview),backup=verifiedFile(root,p.evidence.backup),validation=verifiedFile(root,p.evidence.validation);
 const value=preview.central?.value,tenant=preview.tenant?.value,snapshot=preview.source?.candidateSnapshot;
 if(preview.readOnly!==true||value?.version!==p.baseline.centralVersion||value.fingerprint!==p.baseline.centralFingerprint||!isDeepStrictEqual(value.expected,p.expected)||rawSnapshotDigest(value?.acceptedSnapshot)!==p.accepted.snapshotDigest||contentDigestV2(value.acceptedSnapshot)!==p.accepted.contentDigest
 ||value.sourceControl?.state!=='QUIESCED'||value.sourceControl.fence!==p.source.fence||tenant?.version!==p.baseline.tenantVersion||tenant.fingerprint!==p.baseline.tenantFingerprint)fail('OPPORTUNITY_V2_WINDOW_EVIDENCE_INVALID');
 if(!snapshot||snapshot.financing?.allocations?.value?.length!==1||snapshot.financing.allocations.value[0].money.amount!=='120000'||snapshot.financing.allocations.value[0].money.currency.state!=='NOT_FOUND'||snapshot.schedule?.deadlines?.value?.length!==7)fail('OPPORTUNITY_V2_WINDOW_EVIDENCE_INVALID');
 const observed=Date.parse(preview.source?.metadata?.observedAt);if(!Number.isFinite(observed)||observed>Date.parse(p.createdAt)+5000||Date.parse(p.createdAt)-observed>3600000||contentDigestV2(snapshot)!==p.accepted.contentDigest||preview.source.mappingDigest!==implementationDigest('EU_FUNDING_TENDERS',snapshot.provenance.mappingVersion))fail('OPPORTUNITY_V2_WINDOW_EVIDENCE_INVALID');
 const evidenceTime=Date.parse(backup.completedAt);if(backup.status!=='PASS'||backup.profile!=='EU_WRITER_PREPARATION'||backup.windowId!==p.windowId||backup.packageDigest!==p.package.packageDigest||backup.cleanup!==true||backup.noSourceDrift!==true||backup.aclRestricted!==true||!Number.isFinite(evidenceTime)||evidenceTime>Date.parse(p.createdAt)||Date.parse(p.createdAt)-evidenceTime>3600000)fail('OPPORTUNITY_V2_WINDOW_EVIDENCE_INVALID');
 for(const name of ['central','tenant'])if(backup.baselines?.[name]?.version!==p.baseline[name+'Version']||backup.baselines[name].fingerprint!==p.baseline[name+'Fingerprint']||backup.databases?.[name]?.dataMatches!==true||backup.databases[name].sourceStillMatches!==true||backup.databases[name].preflight!==true)fail('OPPORTUNITY_V2_WINDOW_EVIDENCE_INVALID');
 if(!exact(backup.configuration,PRIVATE_FILES))fail('OPPORTUNITY_V2_WINDOW_EVIDENCE_INVALID');
 for(const file of PRIVATE_FILES){const entry=backup.configuration[file];if(entry?.copied!==true||!SHA.test(entry.sha256)||createHash('sha256').update(readSafe(root,file)).digest('hex')!==entry.sha256)fail('OPPORTUNITY_V2_WINDOW_CHANGED');}
 if(validation.status!=='PASS'||!exact(validation.gate,['path','sha256']))fail('OPPORTUNITY_V2_WINDOW_EVIDENCE_INVALID');
 const gate=verifiedFile(root,validation.gate);if(gate.status!=='PASS'||gate.cleanup!==true||gate.isolated!==true||gate.habitualEnvironmentAccess!==false||gate.gateType!=='OPPORTUNITY_V2_EU_WRITER'||gate.packageDigest!==pkg.packageDigest||gate.package?.id!==pkg.PACKAGE_ID||!isDeepStrictEqual(gate.package.entry,pkg.entry)||!Array.isArray(gate.checks)||gate.checks.some(c=>c.status!=='PASS'))fail('OPPORTUNITY_V2_WINDOW_EVIDENCE_INVALID');
 for(const name of ['EU_WRITER_REAL_QUEUE_ARCHIVE_UNCHANGED_PRESERVES_HEAD','EU_WRITER_SAFE_CHANGE_ONE_REVISION_AND_NORMALIZED_SQL','EU_WRITER_LOSS_AND_NEW_IDENTITIES_REQUIRE_DURABLE_REVIEW','EU_WRITER_TRANSIENT_RETRY_PRESERVES_LINEAGE_AND_ORIGINAL_DEADLINE','EXECUTOR_PHYSICAL_READERS_V1_V2_SQL_AND_TENANT_RLS_PRESERVATION'])if(!gate.checks.some(c=>c.name===name))fail('OPPORTUNITY_V2_WINDOW_EVIDENCE_INVALID');
 for(const tested of [validation.inputs,gate.inputHashes])if(!tested||Array.isArray(tested)||typeof tested!=='object'||!Object.keys(tested).length||Object.entries(tested).some(([file,sha])=>!inputPath(file)||!SHA.test(sha)||p.inputs[file]!==sha))fail('OPPORTUNITY_V2_WINDOW_EVIDENCE_INVALID');
 for(const [file,sha] of Object.entries(p.inputs))if(createHash('sha256').update(readSafe(root,file)).digest('hex')!==sha)fail('OPPORTUNITY_V2_WINDOW_CHANGED');
 return p;
}
function loadEuWriterWindowPlan(root,windowId,now=Date.now()){
 try{if(!UUID.test(windowId))fail();const p=validateEuWriterWindowPlan(JSON.parse(readSafe(root,`output/opportunity-eu-writer-window-${windowId}/plan.json`,1024*1024)),now);if(p.windowId!==windowId)fail();verifyEvidence(root,p);return deepFreeze({plan:p,planDigest:planDigest(p)});}catch(e){if(e.code?.startsWith('OPPORTUNITY_V2_WINDOW_'))throw e;fail('OPPORTUNITY_V2_WINDOW_EVIDENCE_INVALID');}
}
module.exports={ACTIONS,CONTROLLED_CYCLE,PRIVATE_FILES,validateEuWriterWindowPlan,planDigest,loadEuWriterWindowPlan,readSafe,verifyEvidence};
