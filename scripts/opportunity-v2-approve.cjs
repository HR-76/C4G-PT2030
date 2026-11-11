'use strict';
// Explicit, single-call operation over the ordinary browser/OIDC/session/CSRF
// path. Importing this module performs no I/O and creates no authentication.
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID, createHash } = require('node:crypto');
const { isDeepStrictEqual } = require('node:util');
const { contentDigestV2 } = require('../backend/src/opportunities/v2/digests');
const { rawSnapshotDigest } = require('../backend/src/opportunities/v2/reconciliation');
const { implementationDigest } = require('../backend/src/opportunities/v2/activationArchive');
const pkg = require('../backend/src/security/opportunityV2MigrationPackage');
const ROOT = path.resolve(__dirname, '..');
const ORIGIN = 'http://localhost:3000';
const ISSUER = 'https://localhost:8443/realms/c4g-native-local';
const API = '/api/admin/opportunity-activation';
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const SHA = /^[a-f0-9]{64}$/;
// Content of the 11145 candidate under mapping eu-funding-type8-v2.1 (examples/eu-11145-v2.1.json).
// The revision already accepted with mapping v2.0 keeps digest 355df5dc… in acceptedEu11145.js.
const NORMATIVE_CONTENT = 'fe959c4b3ce9dd3b160f16c0e8f6ab96f12d74a868f9342ba16b02dc9e1cc648';
const WINDOW_PATTERN = /^output\/opportunity-v2-habitual-([a-f0-9-]{36})\/window\.json$/;
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const digest = value => createHash('sha256').update(value).digest('hex');
function fail(code) { throw Object.assign(new Error(code), { code }); }
function requireValue(ok, code) { if (!ok) fail(code); }
function keys(value, expected) { return value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === expected.length && expected.every(key => Object.hasOwn(value, key)); }
function cas(value) { return keys(value, ['opportunityId', 'revisionId', 'rowVersion']) && UUID.test(value.opportunityId) && UUID.test(value.revisionId) && Number.isSafeInteger(value.rowVersion) && value.rowVersion > 0; }
function args(argv) {
  if (isDeepStrictEqual(argv, ['--inspect-auth'])) return { mode: 'inspect' };
  requireValue(argv.length === 2 && argv[0] === '--execute-11145' && argv[1].startsWith('--window='), 'APPROVAL_ARGUMENTS_INVALID');
  const relative = argv[1].slice('--window='.length), match = WINDOW_PATTERN.exec(relative);
  requireValue(match && UUID.test(match[1]), 'APPROVAL_WINDOW_PATH_INVALID');
  return { mode: 'execute', relative };
}
function validateWindow(value, now = Date.now()) {
  requireValue(value?.kind === 'opportunity11145habitualwindow-v1' && UUID.test(value.windowId) && value.result === 'PASS'
    && value.packageDigest === pkg.packageDigest && cas(value.expected), 'APPROVAL_WINDOW_INVALID');
  const age = now - Date.parse(value.completedAt);
  requireValue(Number.isFinite(age) && age >= 0 && age <= 3600000, 'APPROVAL_WINDOW_EXPIRED');
  requireValue(value.source?.source === 'EU_FUNDING_TENDERS' && value.source.externalIdentifier === 'CASCADE:11145'
    && value.source.contentDigest === NORMATIVE_CONTENT && SHA.test(value.source.mappingDigest), 'APPROVAL_SOURCE_CHANGED');
  requireValue(SHA.test(value.acceptedBinding?.snapshotDigest) && SHA.test(value.acceptedBinding?.protectedStateDigest), 'APPROVAL_BINDING_REQUIRED');
  requireValue(value.installed?.centralVersion === '042_opportunity_eu_source_control_v2' && value.installed?.tenantVersion === '034_application_snapshot_v2', 'APPROVAL_PACKAGE_REQUIRED');
  const backup = value.backup?.backupId;
  requireValue(typeof backup === 'string' && (UUID.test(backup) || backup.startsWith('opportunity-v2-backup-') && UUID.test(backup.slice('opportunity-v2-backup-'.length)))
    && value.backup.result === 'PASS' && value.backup.noSourceDrift === true && value.resume?.health === true, 'APPROVAL_BACKUP_OR_HEALTH_REQUIRED');
  return value;
}
function readWindow(relative) {
  const checked = args(['--execute-11145', '--window=' + relative]);
  const filename = path.join(ROOT, checked.relative);
  // Reject symlinks/junctions at every supplied component, not just lexical ../.
  let current = ROOT;
  for (const part of checked.relative.split('/')) { current = path.join(current, part); requireValue(!fs.lstatSync(current).isSymbolicLink(), 'APPROVAL_WINDOW_PATH_INVALID'); }
  requireValue(fs.realpathSync(filename) === filename && fs.statSync(filename).size <= 2 * 1024 * 1024, 'APPROVAL_WINDOW_PATH_INVALID');
  const bytes = fs.readFileSync(filename), value = validateWindow(JSON.parse(bytes.toString('utf8')));
  requireValue(path.basename(path.dirname(filename)) === 'opportunity-v2-habitual-' + value.windowId, 'APPROVAL_WINDOW_PATH_INVALID');
  return { filename, value, digest: digest(bytes) };
}
function administrator(session) {
  requireValue(UUID.test(session?.user?.id) && Array.isArray(session.user.platformRoles) && session.user.platformRoles.includes('C4G_ADMIN'), 'APPROVAL_ADMINISTRATOR_REQUIRED');
  return session.user.id;
}
function sourceState(value, expected = null) {
  requireValue(value?.family === 'EU_FUNDING_TENDERS' && ['ACTIVE', 'SUSPEND_REQUESTED', 'QUIESCED'].includes(value.state)
    && Number.isSafeInteger(value.fence) && value.fence > 0 && ['activeLeases', 'queuedRuns', 'pendingRuns', 'otherPendingRuns', 'acceptedV2'].every(key => Number.isSafeInteger(value[key]) && value[key] >= 0)
    && (!expected || value.state === expected), 'APPROVAL_SOURCE_STATE_INVALID');
  return value;
}
function validateCollected(value, window, fence, now = Date.now()) {
  requireValue(UUID.test(value?.runId) && value.opportunityId === window.expected.opportunityId && isDeepStrictEqual(value.expected, window.expected)
    && keys(value.archive, ['kind', 'runId', 'externalIdentifier']) && value.archive.kind === 'FUNDING' && value.archive.runId === value.runId && value.archive.externalIdentifier === 'CASCADE:11145'
    && value.contentDigest === window.source.contentDigest && SHA.test(value.payloadDigest) && value.sourceFence === fence
    && Number.isSafeInteger(value.received) && value.received >= 1 && value.received <= 5 && value.candidates === 1, 'APPROVAL_COLLECTION_CHANGED');
  const age = now - Date.parse(value.observedAt);
  requireValue(Number.isFinite(age) && age >= -5000 && age <= 180000, 'APPROVAL_COLLECTION_EXPIRED');
  return value;
}
function validatePlan(plan, window, collected, now = Date.now()) {
  const item = plan?.preview?.items?.[0], snapshot = plan?.candidate?.snapshot;
  requireValue(UUID.test(plan?.planId) && SHA.test(plan.planDigest) && plan.source === 'EU_FUNDING_TENDERS'
    && plan.state === 'DRAFT' && Number.isSafeInteger(plan.fence) && plan.fence >= 1 && Date.parse(plan.expiresAt) > now
    && plan.review?.canApprove === true && plan.review.currentPreviewMatches === true && plan.review.unexpired === true && plan.review.reasonCode === null,
  'APPROVAL_PLAN_NOT_REVIEWABLE');
  requireValue(isDeepStrictEqual(plan.expected, window.expected) && isDeepStrictEqual(plan.current, { ...window.expected, lifecycleState: 'ACTIVE' })
    && isDeepStrictEqual(plan.archive, collected.archive), 'APPROVAL_PLAN_CAS_CHANGED');
  requireValue(plan.preview.items.length === 1 && plan.preview.totalCandidates === 1 && plan.preview.totalAccepted === 1 && SHA.test(plan.preview.previewDigest)
    && item.action === 'CHANGE_REQUIRES_APPROVAL' && item.aliasDecisionIds?.length === 0 && item.conflictFields?.length === 0
    && isDeepStrictEqual(item.identities, [{ namespace: 'EU_FUNDING_TENDERS', externalId: 'CASCADE:11145' }])
    && Array.isArray(item.reasonCodes) && item.reasonCodes.every(code => ['LEGACY_MIGRATION_REQUIRES_REVIEW', 'MAPPING_BASELINE_UNAVAILABLE'].includes(code)), 'APPROVAL_PLAN_SCOPE_CHANGED');
  requireValue(['opportunityId', 'revisionId', 'rowVersion'].every(key => item.accepted?.[key] === window.expected[key])
    && item.accepted.snapshotDigest === window.acceptedBinding.snapshotDigest && item.accepted.protectedStateDigest === window.acceptedBinding.protectedStateDigest, 'APPROVAL_PROTECTED_STATE_CHANGED');
  const normative = JSON.parse(fs.readFileSync(path.join(ROOT, 'context/references/opportunity-v2/examples/eu-11145-v2.1.json')));
  requireValue(contentDigestV2(normative) === NORMATIVE_CONTENT && contentDigestV2(snapshot) === NORMATIVE_CONTENT
    && plan.candidate.mappingDigest === window.source.mappingDigest && implementationDigest('EU_FUNDING_TENDERS', snapshot.provenance.mappingVersion) === window.source.mappingDigest
    && rawSnapshotDigest(snapshot) === plan.candidate.snapshotDigest && item.candidate?.snapshotDigest === plan.candidate.snapshotDigest
    && item.candidate.contentDigest === NORMATIVE_CONTENT && item.candidate.mappingDigest === window.source.mappingDigest, 'APPROVAL_FACTS_CHANGED');
  requireValue(snapshot.financing.allocations.state === 'PRESENT' && snapshot.financing.allocations.value.length === 1
    && snapshot.financing.allocations.value[0].money.amount === '120000' && snapshot.financing.allocations.value[0].money.currency.state === 'NOT_FOUND'
    && snapshot.relatedProject.acronym.value === 'SUSA' && snapshot.relatedProject.grantAgreementNumber.value === '101190010' && snapshot.schedule.deadlines.value.length === 7,
  'APPROVAL_FACTS_CHANGED');
  return plan;
}
function validateReceipt(value, window) {
  requireValue(value?.opportunityId === window.expected.opportunityId && UUID.test(value.revisionId) && value.revisionId !== window.expected.revisionId
    && value.rowVersion === window.expected.rowVersion + 1 && Number.isSafeInteger(value.revisionNumber) && value.revisionNumber > 1
    && value.action === 'REVISION_CREATED' && value.sourceVersion === 2 && value.contentDigest === window.source.contentDigest, 'APPROVAL_RECEIPT_INVALID');
  return value;
}
function catalogRowVersion(value) {
  // PostgreSQL bigint is returned as decimal text by this existing reader.
  // Do not coerce whitespace, exponent notation, leading zeros or unsafe values.
  const normalized = typeof value === 'string' && /^[1-9][0-9]{0,15}$/.test(value) ? Number(value) : value;
  requireValue(typeof normalized === 'number' && Number.isSafeInteger(normalized) && normalized > 0, 'APPROVAL_READER_PARITY_FAILED');
  return normalized;
}
// Test port covers client sequencing only. Actual authorization remains entirely
// in the ordinary HTTP middleware and locked server transactions.
async function execute11145({ window, request, authenticatedAt, clock = Date.now, onProgress = () => {} }) {
  validateWindow(window, clock());
  const recent = () => requireValue(Number.isFinite(authenticatedAt) && clock() - authenticatedAt >= 0 && clock() - authenticatedAt < 240000, 'APPROVAL_REAUTHENTICATION_REQUIRED');
  recent(); const actorId = administrator(await request('GET', '/api/auth/session'));
  const initial = sourceState(await request('GET', API + '/sources/eu'), 'ACTIVE');
  requireValue(initial.acceptedV2 === 0 && initial.activeLeases === 0 && initial.queuedRuns === 0 && initial.pendingRuns === 0 && initial.otherPendingRuns === 0, 'APPROVAL_SOURCE_NOT_IDLE');
  async function write(stage, url, body, expectedStatus = 200) {
    recent(); await onProgress({ stage, status: 'ATTEMPTING', requestId: body.requestId, at: new Date(clock()).toISOString() });
    const value = await request('POST', url, body, expectedStatus);
    await onProgress({ stage, status: 'RESPONDED', requestId: body.requestId, at: new Date(clock()).toISOString() });
    return value;
  }
  const collected = validateCollected(await write('collect', API + '/calls/11145/collect', { requestId: randomUUID(), expectedSourceFence: initial.fence }, 201), window, initial.fence, clock());
  await onProgress({ stage: 'collection-verified', status: 'PASS', runId: collected.runId, contentDigest: collected.contentDigest, payloadDigest: collected.payloadDigest });
  const suspended = sourceState(await write('suspend', API + '/sources/eu/suspend', { requestId: randomUUID(), expectedFence: initial.fence }), 'SUSPEND_REQUESTED');
  requireValue(suspended.fence === initial.fence + 1, 'APPROVAL_SOURCE_FENCE_CHANGED');
  let drained = suspended;
  for (let attempt = 0; drained.canQuiesce !== true && attempt < 60; attempt++) { recent(); await pause(500); drained = sourceState(await request('GET', API + '/sources/eu'), 'SUSPEND_REQUESTED'); requireValue(drained.fence === suspended.fence, 'APPROVAL_SOURCE_FENCE_CHANGED'); }
  requireValue(drained.canQuiesce === true && drained.activeLeases === 0, 'APPROVAL_SOURCE_NOT_QUIESCENT');
  const quiet = sourceState(await write('quiesce', API + '/sources/eu/quiesce', { requestId: randomUUID(), expectedFence: drained.fence }), 'QUIESCED');
  requireValue(quiet.fence === suspended.fence + 1 && quiet.activeLeases === 0, 'APPROVAL_SOURCE_FENCE_CHANGED');
  const prepared = await write('prepare', API + '/calls/11145/plans', { requestId: randomUUID(), runId: collected.runId }, 201);
  requireValue(UUID.test(prepared?.planId) && SHA.test(prepared.planDigest), 'APPROVAL_PLAN_NOT_REVIEWABLE');
  await onProgress({ stage: 'prepare', status: 'PREPARED', planId: prepared.planId, planDigest: prepared.planDigest });
  const detail = validatePlan(await request('GET', API + '/plans/' + prepared.planId), window, collected, clock());
  requireValue(detail.planDigest === prepared.planDigest && detail.planId === prepared.planId, 'APPROVAL_PLAN_CHANGED');
  await onProgress({ stage: 'review', status: 'PASS', planId: detail.planId, planDigest: detail.planDigest, previewDigest: detail.preview.previewDigest,
    expected: window.expected, candidateContentDigest: NORMATIVE_CONTENT, amount: '120000', currencyState: 'NOT_FOUND', acronym: 'SUSA', grantAgreement: '101190010', cutoffs: 7 });
  recent(); requireValue(administrator(await request('GET', '/api/auth/session')) === actorId, 'APPROVAL_ACTOR_CHANGED');
  const approved = await write('approve', API + '/plans/' + detail.planId + '/approve', { requestId: randomUUID(), planDigest: detail.planDigest });
  requireValue(approved?.state === 'APPROVED' && approved.planId === detail.planId && approved.planDigest === detail.planDigest && approved.fence === detail.fence + 1
    && approved.preview?.previewDigest === detail.preview.previewDigest && approved.expiresAt === detail.expiresAt, 'APPROVAL_CHANGED');
  const source = sourceState(await request('GET', API + '/sources/eu'), 'QUIESCED');
  requireValue(source.fence === quiet.fence && source.activeLeases === 0, 'APPROVAL_SOURCE_FENCE_CHANGED');
  const acceptanceInput = { requestId: randomUUID(), planDigest: approved.planDigest, fence: approved.fence, sourceFence: source.fence };
  const url = API + '/calls/11145/plans/' + approved.planId + '/accept';
  const accepted = validateReceipt(await write('accept', url, acceptanceInput), window);
  await onProgress({ stage: 'accepted', status: 'PASS', ...accepted, planId: approved.planId, sourceFence: source.fence, requestId: acceptanceInput.requestId });
  // This is an intentional replay only after a verified successful response.
  // A timeout/network failure above never reaches this branch and is not retried.
  requireValue(isDeepStrictEqual(await write('accept-replay', url, acceptanceInput), accepted), 'APPROVAL_REPLAY_CHANGED');
  const read = await request('GET', '/api/admin/central-opportunities/' + accepted.opportunityId);
  requireValue(read?.opportunityId === accepted.opportunityId && read.revisionId === accepted.revisionId && catalogRowVersion(read.rowVersion) === accepted.rowVersion
    && read.readModel?.sourceVersion === 2 && rawSnapshotDigest(read.snapshot) === detail.candidate.snapshotDigest && contentDigestV2(read.snapshot) === NORMATIVE_CONTENT, 'APPROVAL_READER_PARITY_FAILED');
  const finalSource = sourceState(await request('GET', API + '/sources/eu'), 'QUIESCED');
  requireValue(finalSource.fence === quiet.fence && finalSource.acceptedV2 >= 1 && finalSource.activeLeases === 0, 'APPROVAL_FINAL_SOURCE_INVALID');
  return { actorId, collected: { runId: collected.runId, observedAt: collected.observedAt, contentDigest: collected.contentDigest, payloadDigest: collected.payloadDigest, received: collected.received, candidates: 1 },
    plan: { planId: approved.planId, planDigest: approved.planDigest, fence: approved.fence, expiresAt: approved.expiresAt }, accepted,
    source: { state: finalSource.state, fence: finalSource.fence }, replayVerified: true, readerParityVerified: true };
}
function httpCommand(method, url, body) {
  requireValue(['GET', 'POST'].includes(method) && typeof url === 'string' && !/[?#\\]/.test(url), 'APPROVAL_HTTP_SCOPE_INVALID');
  if (method === 'GET') {
    requireValue(body === undefined && (['/api/auth/session', '/api/admin/integrations/funding-tenders', API + '/sources/eu'].includes(url)
      || new RegExp('^' + API + '/plans/[a-f0-9-]{36}$').test(url) || /^\/api\/admin\/central-opportunities\/[a-f0-9-]{36}$/.test(url)), 'APPROVAL_HTTP_SCOPE_INVALID');
    return;
  }
  let fields;
  if (url === API + '/calls/11145/collect') fields = ['requestId', 'expectedSourceFence'];
  if (url === API + '/calls/11145/plans') fields = ['requestId', 'runId'];
  if ([API + '/sources/eu/suspend', API + '/sources/eu/quiesce'].includes(url)) fields = ['requestId', 'expectedFence'];
  if (new RegExp('^' + API + '/plans/[a-f0-9-]{36}/approve$').test(url)) fields = ['requestId', 'planDigest'];
  if (new RegExp('^' + API + '/calls/11145/plans/[a-f0-9-]{36}/accept$').test(url)) fields = ['requestId', 'planDigest', 'fence', 'sourceFence'];
  requireValue(fields && keys(body, fields) && UUID.test(body.requestId), 'APPROVAL_HTTP_SCOPE_INVALID');
}
function safeCode(error) {
  const code = error?.code;
  return typeof code === 'string' && /^(APPROVAL_[A-Z0-9_]+|OPPORTUNITY_V2_[A-Z0-9_]+|AUTH_INTERACTION_REQUIRED|CSRF_INVALID|SESSION_[A-Z0-9_]+)$/.test(code) ? code : 'APPROVAL_OPERATION_FAILED';
}
async function browserSession() {
  const folder = path.join(ROOT, '.tmp/local-platform'), state = JSON.parse(fs.readFileSync(path.join(folder, 'runtime.json')));
  requireValue(state.identity?.origin === ORIGIN && state.identity.issuer === ISSUER && state.identity.policyVersion === 'c4g-user-mfa-v1', 'APPROVAL_IDENTITY_TARGET_INVALID');
  const access = JSON.parse(fs.readFileSync(path.join(folder, 'access.json')));
  requireValue(typeof access.admin?.username === 'string' && access.admin.username.length > 0 && typeof access.admin.password === 'string' && access.admin.password.length > 0, 'APPROVAL_CREDENTIAL_REQUIRED');
  const { chromium } = require('../frontend/test-harness/node_modules/playwright');
  const browser = await chromium.launch({ headless: true, executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
  try {
    const context = await browser.newContext({ serviceWorkers: 'block' }), page = await context.newPage();
    page.setDefaultTimeout(20000); let permitted = null;
    await context.route('**/*', route => {
      const request = route.request(), url = new URL(request.url()), read = ['GET', 'HEAD', 'OPTIONS'].includes(request.method());
      if (![ORIGIN, new URL(ISSUER).origin].includes(url.origin)) return route.abort();
      if (url.origin === ORIGIN && url.pathname.startsWith('/api/') && !read
        && !(permitted && request.method() === 'POST' && url.pathname === permitted)) return route.abort();
      if (url.origin === new URL(ISSUER).origin && !read && !(request.method() === 'POST' && url.pathname === '/realms/c4g-native-local/login-actions/authenticate')) return route.abort();
      return route.continue();
    });
    try {
      await page.goto(ORIGIN + '/api/auth/oidc/login?returnTo=%2Fadministracao%2Fdashboard');
      await page.locator('#username').waitFor();
      requireValue(new URL(page.url()).origin === new URL(ISSUER).origin, 'AUTH_INTERACTION_REQUIRED');
      const action = new URL(await page.locator('#kc-form-login').getAttribute('action'), page.url());
      requireValue(action.origin === new URL(ISSUER).origin && action.pathname === '/realms/c4g-native-local/login-actions/authenticate', 'AUTH_INTERACTION_REQUIRED');
      await page.locator('#username').fill(access.admin.username); await page.locator('#password').fill(access.admin.password);
      await page.locator('#kc-login').click();
      await page.waitForURL(url => url.origin === ORIGIN && url.pathname === '/administracao/dashboard');
    } catch { fail('AUTH_INTERACTION_REQUIRED'); }
    const authenticatedAt = Date.now();
    // Neither browser storage/cookies nor tokens are exported to the process,
    // reports or a reusable Playwright storageState file.
    async function request(method, url, body, status = 200) {
      httpCommand(method, url, body); permitted = method === 'POST' ? url : null;
      try {
        const response = await page.evaluate(async ({ method, url, body }) => {
          if (location.origin !== 'http://localhost:3000') return { status: 0, code: 'APPROVAL_ORIGIN_CHANGED' };
          const headers = { Accept: 'application/json' };
          if (method === 'POST') {
            const csrf = await fetch('/api/auth/csrf', { credentials: 'same-origin', cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(15000) });
            if (!csrf.ok) return { status: csrf.status, code: 'APPROVAL_CSRF_UNAVAILABLE' };
            const value = await csrf.json(); if (typeof value.csrfToken !== 'string' || !value.csrfToken) return { status: 0, code: 'APPROVAL_CSRF_UNAVAILABLE' };
            headers['X-CSRF-Token'] = value.csrfToken; headers['Content-Type'] = 'application/json';
          }
          const response = await fetch(url, { method, credentials: 'same-origin', cache: 'no-store', redirect: 'error', headers, ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(url.endsWith('/collect') ? 45000 : 30000) });
          const reader = response.body.getReader(), chunks = []; let length = 0;
          try { for (;;) { const item = await reader.read(); if (item.done) break; length += item.value.byteLength; if (length > 2 * 1024 * 1024) return { status: 0, code: 'APPROVAL_HTTP_LIMIT' }; chunks.push(item.value); } }
          finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
          const bytes = new Uint8Array(length); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
          const value = JSON.parse(new TextDecoder().decode(bytes));
          if (!response.ok) return { status: response.status, code: value?.error?.code || value?.code };
          if (url === '/api/auth/session') return { status: response.status, value: { user: { id: value.user?.id, platformRoles: value.user?.platformRoles } } };
          if (url === '/api/admin/integrations/funding-tenders') return { status: response.status, value: { administratorRead: true } };
          return { status: response.status, value };
        }, { method, url, body });
        if (response.status !== status) fail(safeCode({ code: response.code }));
        return response.value;
      } finally { permitted = null; }
    }
    return { request, authenticatedAt, close: () => browser.close() };
  } catch (error) { await browser.close(); throw error; }
}
async function main(argv = process.argv.slice(2)) {
  const command = args(argv), selected = command.mode === 'execute' ? readWindow(command.relative) : null;
  const id = randomUUID(), directory = selected ? path.dirname(selected.filename) : path.join(ROOT, 'output', 'opportunity-v2-auth-' + id);
  if (!selected) fs.mkdirSync(directory, { recursive: false });
  const output = path.join(directory, 'approval-' + id + '.json');
  const report = { kind: 'opportunity11145authenticatedoperation-v1', mode: command.mode, result: 'IN_PROGRESS', startedAt: new Date().toISOString(),
    ...(selected ? { windowId: selected.value.windowId, windowDigest: selected.digest, packageDigest: selected.value.packageDigest } : {}), steps: [], credentialsExported: false, sessionFabricated: false };
  fs.writeFileSync(output, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
  const save = () => { const temporary = output + '.' + randomUUID() + '.writing'; fs.writeFileSync(temporary, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' }); fs.renameSync(temporary, output); };
  let session;
  try {
    session = await browserSession();
    const actorId = administrator(await session.request('GET', '/api/auth/session'));
    await session.request('GET', '/api/admin/integrations/funding-tenders');
    report.authentication = { providerLogin: 'OIDC', policy: 'c4g-user-mfa-v1', administrator: true, actorId, credentialsExported: false };
    save();
    if (selected) {
      requireValue(digest(fs.readFileSync(selected.filename)) === selected.digest, 'APPROVAL_WINDOW_CHANGED');
      report.execution = await execute11145({ window: selected.value, request: session.request, authenticatedAt: session.authenticatedAt,
        onProgress: event => { report.steps.push(event); save(); } });
    }
    report.result = 'PASS';
  } catch (error) { report.result = 'FAIL'; report.failure = safeCode(error); process.exitCode = 1; }
  finally {
    if (session) await session.close().catch(() => { report.browserCleanup = false; });
    report.browserCleanup ??= true; report.completedAt = new Date().toISOString(); save();
    console.log(JSON.stringify({ result: report.result, mode: report.mode, failure: report.failure || null, evidence: path.relative(ROOT, output).replaceAll('\\', '/') }));
  }
  return report;
}
if (require.main === module) main().catch(() => { console.error('APPROVAL_OPERATION_FAILED'); process.exitCode = 1; });
module.exports = { args, validateWindow, readWindow, administrator, validateCollected, validatePlan, validateReceipt, catalogRowVersion, execute11145, httpCommand, main };
