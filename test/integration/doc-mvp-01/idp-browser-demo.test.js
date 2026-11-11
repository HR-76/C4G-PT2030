'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const gate = require('./idp-browser-demo');

const source = fs.readFileSync(path.join(__dirname, 'idp-browser-demo.js'), 'utf8');

test('proposed limits preserve historical consumption and require new remote authorization', () => {
  gate.validateParentJournal();
  const cumulative = gate.cumulative(gate.PHASE_LIMITS);
  for (const key of Object.keys(gate.CUMULATIVE_LIMITS).filter(key => key !== 'unresolvedMultipart')) {
    assert.equal(cumulative[key], gate.CUMULATIVE_LIMITS[key]);
  }
  assert.equal(cumulative.unresolvedMultipart, 0);
  assert.equal(cumulative.unresolvedMultipart <= gate.CUMULATIVE_LIMITS.unresolvedMultipart, true);
  assert.deepEqual(gate.assertBudget(gate.PHASE_LIMITS), cumulative);
  assert.equal(gate.PHASE_RUN_ID, '5f6360f0-696a-4b8e-9147-e1db4321dd83');
  assert.deepEqual(gate.REMOTE_PLAN, { functionalRequests: 42, cleanupRequests: 5, applicationBytes: 7308,
    objectIntentions: 1, completedObjects: 1, multipartIntentions: 0, unresolvedMultipart: 0 });
  assert.doesNotThrow(() => gate.assertRemotePlan(gate.PHASE_BASELINE.budget));
  assert.match(source, /replaySharedBudget/);
  assert.match(source, /VERIFIED_API_A_B_42_5_EXPLICIT_AUTHORIZATION/);
  assert.equal(gate.validatePhaseJournal().sequence,399);
});

test('every R2 transport in the integrated gate is constructed behind the shared safeguards', () => {
  assert.equal((source.match(/providerClient\(target, safeguards\)/g) || []).length, 2);
  assert.doesNotMatch(source, /new\s+(?:s3\.)?S3Client\s*\(/);
  assert.match(source, /createR2AdapterBoundary\(target\.configuration,[\s\S]*client: remoteClient/);
  assert.doesNotMatch(source, /installBrowserBudget|Fetch\.fulfillRequest/);
  assert.match(source, /SIGNED_DOWNLOAD_FORBIDDEN_IN_THIS_PROOF/);
  assert.match(source, /createDownloadStaging/);
  assert.match(source, /proxy:browserBlocker.proxy/);
  assert.match(source, /registerObjectIntent\(\{ Bucket: QUARANTINE_BUCKET/);
});

test('verified download uses private product staging and real OTP evidence rather than a two-second fixture window',()=>{
  assert.match(source,/addLoaFlow\(formsFlow, 'doc-mvp01-loa2', 2, 300/);
  assert.match(source,/locator\('#otp'\)\.fill\(totp\(user.totp\)\)/);
  assert.match(source,/stagingAcl\.rules\.every/);
  assert.match(source,/downloadStaging\.snapshot\(\),\{active:0,reserved:0\}/);
  assert.match(source,/new URL\(download.url\(\)\)\.origin,ORIGIN/);
  assert.doesNotMatch(source,/Fetch\.fulfillRequest|controlledStorageServer\.listen/);
});

test('diagnostics preserve candidate ordering, worker outcome and tenant state before teardown', () => {
  for (const token of ['requestSequence', 'responseSequence', 'candidateProjection', 'prepareBrowserWorker',
    'execution_id', 'persisted', 'DOCUMENT_SCAN_COMPLETED', 'diagnosticSnapshot', "preserveDiagnostic('FAILURE')",
    "status: 'PRESERVED_STOPPED'"]) assert.match(source, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.ok(source.indexOf("preserveDiagnostic('FAILURE')") < source.indexOf("docker('rm', '-f', '-v', name)"));
  assert.match(source, /SELECT v\.organization_id,v\.document_id,v\.version_id,v\.object_id,v\.state,v\.scan_state/);
  assert.match(source, /FROM document_storage\.scan_result/);
  assert.match(source, /FROM async_exec\.inbox/);
});

test('explicit inventory occurs after OIDC; earlier worker readiness is separately metered', () => {
  const secondLogin = source.indexOf("b = await login(users[1])");
  const firstProviderOperation = source.indexOf('initialInventory = await inventoryPrefix');
  assert(secondLogin > 0);
  assert(firstProviderOperation > secondLogin);
  assert.match(source.slice(secondLogin, firstProviderOperation), /Object\.entries\(localStorage\)/);
});

test('the proof uses productive composition with explicit real ports and keeps FreshClam disabled', () => {
  assert.match(source, /createProductionComposition\(\{ env, dependencies \}\)/);
  assert.match(source, /applicationDocumentInfrastructure: documentInfrastructure/);
  assert.match(source, /CLAMAV_NO_FRESHCLAMD=true/);
  assert.doesNotMatch(source, /testProvider|CONTROLLED_DOUBLE|ignoreHTTPSErrors|ignore-certificate-errors/);
});

test('local upload diagnosis selects only the explicit closed storage double and blocks browser R2', () => {
  assert.match(source, /LOCAL_UPLOAD_DIAGNOSTIC_2026_10_24/);
  assert.match(source, /LOCAL_FULL_DIAGNOSTIC_2026_10_24/);
  assert.match(source, /storage = observedLocalStorage\(storageEvents, provider.create/);
  assert.match(source, /LOCAL_DIAGNOSTIC_R2_FORBIDDEN/);
  assert.match(source, /startBrowserEgressBlocker/);
  assert.match(source, /SAME_ORIGIN_API/);
  assert.doesNotMatch(source, /controlledStorageServer\.listen|Fetch\.fulfillRequest/);
  assert.match(source, /ASSOCIATION_STATE/);
  assert.match(source, /polling: 'raf'/);
  assert.doesNotMatch(source, /polling: 'mutation'/);
  assert.match(source, /storage: localDiagnostic \? 'CONTROLLED_LOCAL_DOUBLE' : 'REAL_R2'/);
});

test('browser gate has no competing consumer and only the real loader consumes jobs', () => {
  assert.doesNotMatch(source, /boss\.fetch|worker\.handlers|makeWorker/);
  assert.match(source, /VERIFIED_API_A_B_42_5_EXPLICIT_AUTHORIZATION/);
  const helper = fs.readFileSync(path.join(__dirname, 'browser-worker.js'), 'utf8');
  assert.match(helper, /documentWorkerEntrypointChild\.js/);
  assert.match(helper, /enqueueLineage/);
  assert.doesNotMatch(helper, /boss\.fetch|\.handlers\[/);
});

test('upload diagnosis records only public HTTP metadata and fails on the first UI refusal', () => {
  for (const token of ['HTTP_REQUEST_FAILED', 'HTTP_RESPONSE', 'publicCode', 'correlationId', 'uploadPhase', 'UPLOAD_UI_REFUSED']) {
    assert.match(source, new RegExp(token));
  }
  assert.match(source, /Promise\.race/);
  assert.match(source, /browserContext/);
  assert.match(source, /body\?\.organization\?\.id === expected/);
  assert.doesNotMatch(source, /response\.headers\(\)\[['"]authorization/);
});

test('the real API audit uses the dedicated F7 writer rather than the document metadata role', () => {
  assert.match(source, /transaction\(pool, 'c4g_audit_writer', organizationId, client => append\.append\(event, client\)\)/);
  assert.doesNotMatch(source, /transaction\(pool, 'c4g_document_runtime', organizationId, client => append\.append\(event, client\)\)/);
});

test('availability polling lets the frontend refresh complete without reload loops', () => {
  assert.match(source, /availableOption\.waitFor\(\{ state: 'attached', timeout: 30000 \}\)/);
  assert.doesNotMatch(source, /await sleep\(500\); await a\.page\.reload\(\)/);
});

test('the PostgreSQL bootstrap administrator remains distinct from the canonical DDL executor', () => {
  assert.match(source, /POSTGRES_USER=postgres/);
  assert.match(source, /postgresql:\/\/postgres:/);
  assert.doesNotMatch(source, /POSTGRES_USER=c4g_f12_admin/);
});

test('the browser path uses distinct contexts, real MFA input and one synthetic object intention', () => {
  assert.match(source, /browser\.newContext/);
  assert.match(source, /locator\('#username'\)\.waitFor/);
  assert.doesNotMatch(source, /getByRole\('button', \{ name: 'Entrar na C4G'/);
  assert.match(source, /waitUntil: 'domcontentloaded'/);
  assert.match(source, /OIDC_LOGIN_NOT_COMPLETED/);
  assert.match(source, /publicCode = JSON\.parse\(document\.body\.innerText\)\.code/);
  assert.match(source, /user\.subject = matches\[0\]\.id/);
  assert.match(source, /user\.id, issuer, user\.subject/);
  assert.match(source, /locator\('#otp'\)\.fill\(totp\(user\.totp\)\)/);
  assert.match(source, /conditional-level-of-authentication/);
  assert.match(source, /OIDC_ASSURANCE_OBSERVED/);
  assert.match(source, /assert\.equal\(evidence\?\.acr, 'c4g-loa2'\)/);
  assert.match(source, /\/api\/auth\/step-up\?category=recent-mfa/);
  assert.match(source, /await observeAssurance\(users\[1\], true\)/);
  assert.match(source, /if \(await password\.isVisible/);
  assert.equal((source.match(/setInputFiles\(/g) || []).length, 1);
  assert.match(source, /changeStatus\(\{ membershipId: memberBA, status: 'REMOVED'/);
  assert.match(source, /memberBA, \['application\.read', 'application\.review\.decide', 'opportunity\.read'/);
  assert.match(source, /await b\.page\.close\(\); b\.page = await b\.context\.newPage\(\)/);
  assert.match(source, /REVOCATION_UI_STATE/);
  assert.match(source, /protectedLookupAttempted: false, retryOffered: false/);
  assert.match(source, /LOCAL_TEARDOWN_QUIESCED/);
});
