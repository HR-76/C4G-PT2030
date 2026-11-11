'use strict';
// Explicitly invoked authenticated A/B experiment. No setup, service restart,
// migration, seed, grant, import, writer or business mutation is performed.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const {createHash} = require('node:crypto');
const cfg = require('../../../backend/scripts/localPlatform/config');
const round = value => Math.round(value * 100) / 100;
const hash = value => createHash('sha256').update(value).digest('hex');
// These are the only fields ignored for response parity, at every depth.
const ignoredFields = ['generatedAt', 'nextCursor', 'previousCursor'];
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().filter(key => !ignoredFields.includes(key)).map(key => [key, canonical(value[key])])) : value;
const digest = value => hash(JSON.stringify(canonical(value)));
function distribution(values) {
  const ordered = [...values].sort((a, b) => a - b);
  return {n: values.length, minMs: round(ordered[0]),
    medianMs: round((ordered[Math.floor((ordered.length - 1) / 2)] + ordered[Math.floor(ordered.length / 2)]) / 2),
    meanMs: round(values.reduce((sum, value) => sum + value, 0) / values.length), maxMs: round(ordered.at(-1))};
}
function sourceSnapshot() {
  const files = [];
  const visit = folder => {
    for (const item of fs.readdirSync(folder, {withFileTypes: true})) {
      const file = path.join(folder, item.name);
      if (item.isDirectory()) visit(file);
      else if (item.isFile() && /\.(?:js|cjs|json)$/.test(item.name)) files.push(file);
    }
  };
  visit(path.join(cfg.root, 'backend/src'));
  visit(__dirname);
  for (const relative of ['backend/scripts/localPlatform/runtime.js', 'backend/scripts/localPlatform/config.js',
    'backend/scripts/localPlatform/catalogReaderConfig.js', 'backend/scripts/localPlatform/opportunityV2Runtime.js',
    'backend/scripts/localPlatform/euWriterRuntime.js']) {
    files.push(path.join(cfg.root, relative));
  }
  return Object.fromEntries([...new Set(files)].sort().map(file => [path.relative(cfg.root, file).replaceAll('\\', '/'), hash(fs.readFileSync(file))]));
}
const safeError = error => /^[A-Z0-9_]+$/.test(error?.message || '') ? error.message
  : /^[A-Z0-9_]+$/.test(error?.code || '') ? error.code : 'REPORT_AUTHORITY_MEASUREMENT_ERROR';
const safeErrorName = error => ['TimeoutError', 'AssertionError', 'Error', 'TypeError', 'RangeError'].includes(error?.name) ? error.name : 'UnknownError';
function classifyPageUrl(value) {
  try {
    const url = new URL(value);
    if (url.origin === 'http://localhost:3000') {
      return ({'/login': 'APP_LOGIN', '/api/auth/oidc/callback': 'APP_CALLBACK', '/dashboard': 'APP_DASHBOARD',
        '/catalogo': 'APP_CATALOG', '/administracao/dashboard': 'APP_PLATFORM_DASHBOARD'})[url.pathname] || 'APP_OTHER';
    }
    return url.origin === 'https://localhost:8443' ? 'LOCAL_IDP' : 'OTHER';
  } catch {return 'UNAVAILABLE';}
}
async function pageDiagnostics(page) {
  if (!page || page.isClosed()) return {urlClass: 'UNAVAILABLE'};
  const result = {urlClass: classifyPageUrl(page.url())};
  for (const [key, selector] of [['usernameControls', '#username'], ['loginControls', '#kc-login'],
    ['dashboardIndicators', '.dashboard-stats .stat-num'], ['alerts', '[role="alert"]'],
    ['loadingIndicators', '[role="status"]']]) {
    try {result[key] = await page.locator(selector).count();} catch {result[key] = null;}
  }
  return result;
}

async function main() {
  const {chromium} = require('../../../frontend/test-harness/node_modules/playwright');
  assert.deepEqual(process.argv.slice(2), [], 'REPORT_PROBE_TARGET_OVERRIDES_FORBIDDEN');
  const state = JSON.parse(fs.readFileSync(path.join(cfg.folder, 'runtime.json'), 'utf8'));
  assert.equal(state.phase, 'READY', 'REPORT_PROBE_LOCAL_CONFIGURATION_REQUIRED');
  assert.equal(state.identity.origin, 'http://localhost:3000', 'REPORT_PROBE_EXISTING_APP_REQUIRED');
  const sourcesBefore = sourceSnapshot();
  // Install before loading the production host or any metadata consumers.
  const observer = require('./observer.cjs').install();
  const out = path.join(cfg.root, 'output/dashboard-report-authority/run-' + new Date().toISOString().replace(/[:.]/g, '-'));
  fs.mkdirSync(out, {recursive: true});
  const evidence = {observedAt: new Date().toISOString(), result: 'IN_PROGRESS',
    method: 'same-process sequential AB/BA; exact pinned baseline composition versus report authority grouping',
    dataSource: 'existing local C4G configuration and data; test-owned ephemeral HTTP listener',
    latencyScope: 'authenticated API HTTP plus JSON parsing; no frontend latency claim',
    counterScope: 'dashboard router and stages; excludes application session middleware before router',
    counterDefinitions: {physicalBegins: 'all physical BEGIN/START TRANSACTION attempts, including central admission preflight',
      authorityBegins: 'exact BEGIN issued by the authority coordinator after admission',
      commits: 'successful physical COMMIT statements', connections: 'coordinator pool acquisitions'},
    responseParityIgnoredFields: ignoredFields, composition: observer.sourceEvidence,
    sourceHashes: sourcesBefore, warmups: [], samples: [], attempts: [], blockedBusinessWrites: 0, pageErrors: [],
    limitations: ['single organization and sequential requests', 'warm pools and schema metadata',
      'existing local application remains running', 'normal login and read audit effects',
      'no capacity or cold-start claim', 'cursor bytes are excluded from response parity']};
  const save = () => fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify(evidence, null, 2));
  const phases = ['HOST_START', 'BROWSER_START', 'LOGIN_NAVIGATION', 'LOGIN_FORM_WAIT', 'LOGIN_SUBMIT', 'OIDC_RETURN',
    'LOGIN_DRAIN', 'DASHBOARD_NAVIGATION', 'DASHBOARD_READY', 'PRE_SAMPLE_ENVIRONMENT', 'WARMUPS',
    'MEASUREMENTS', 'FINAL_VERIFICATION', 'COMPLETE'];
  const phase = value => {assert.ok(phases.includes(value)); evidence.phase = value; save(); console.log('REPORT_PROBE_PHASE ' + value);};
  let host, browser, page, failure;
  try {
    phase('HOST_START');
    host = await require('./host.cjs').start();
    evidence.configurationHash = host.configurationHash;
    evidence.centralSchemaHash = host.schemaHash;
    await host.assertEnvironmentUnchanged();
    console.log('REPORT_AUTHORITY_PROBE_HOST_READY');
    phase('BROWSER_START');
    browser = await chromium.launch({headless: true, executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe'});
    const context = await browser.newContext({viewport: {width: 1440, height: 1000}, reducedMotion: 'reduce'});
    page = await context.newPage();
    page.setDefaultTimeout(45000);
    page.on('pageerror', () => evidence.pageErrors.push('JAVASCRIPT_ERROR'));
    await context.route('**/api/**', route => {
      const request = route.request(), pathname = new URL(request.url()).pathname;
      if (!pathname.startsWith('/api/auth/') && !['GET', 'HEAD', 'OPTIONS'].includes(request.method())) {
        evidence.blockedBusinessWrites++; return route.abort();
      }
      return route.continue();
    });
    // Existing credentials stay in memory and are entered only into existing
    // local OIDC. Cookies remain managed by the browser context; never exported.
    const access = JSON.parse(fs.readFileSync(path.join(cfg.folder, 'access.json'), 'utf8'));
    phase('LOGIN_NAVIGATION');
    await page.goto(state.identity.origin + '/login');
    phase('LOGIN_FORM_WAIT');
    await page.locator('#username').waitFor();
    await page.locator('#username').fill(access.hugo.username);
    await page.locator('#password').fill(access.hugo.password);
    phase('LOGIN_SUBMIT');
    await page.locator('#kc-login').click();
    phase('OIDC_RETURN');
    await page.waitForURL(url => url.origin === state.identity.origin && !['/login', '/api/auth/oidc/callback'].includes(url.pathname));
    phase('LOGIN_DRAIN');
    await page.waitForLoadState('networkidle');
    evidence.loginReturnUrlClass = classifyPageUrl(page.url());
    // The current home route is the catalog; explicitly enter the dashboard.
    phase('DASHBOARD_NAVIGATION');
    await page.goto(state.identity.origin + '/dashboard');
    // Drain the existing app's initial dashboard and alert reads before sampling.
    phase('DASHBOARD_READY');
    await page.locator('.dashboard-stats .stat-num').first().waitFor();
    await page.waitForLoadState('networkidle');
    assert.deepEqual(evidence.pageErrors, [], 'REPORT_PROBE_LOGIN_PAGE_ERROR');
    evidence.oidc = true;
    phase('PRE_SAMPLE_ENVIRONMENT');
    await host.assertEnvironmentUnchanged();
    const target = host.origin + '/api/organizations/' + state.organizationId + '/dashboard/summary';
    let referenceHash, referenceFingerprints;
    async function sample(variant, phase, pair) {
      const previous = observer.records.size, started = performance.now();
      let response;
      try {
        response = await context.request.get(target, {headers: {
          'X-C4G-Report-Authority-Probe': variant, 'X-C4G-Organization': state.organizationId,
        }, timeout: 45000});
        assert.equal(response.status(), 200, 'REPORT_PROBE_HTTP_' + response.status());
        const body = await response.json(), ms = round(performance.now() - started);
        assert.equal(body.report.organizationId, state.organizationId, 'REPORT_PROBE_ORGANIZATION_MISMATCH');
        assert.equal(body.report.unitsAvailable, true, 'REPORT_PROBE_TWO_PREAUTHORIZATIONS_REQUIRED');
        assert.equal(observer.records.size, previous + 1, 'REPORT_PROBE_ONE_RECORD_REQUIRED');
        const server = [...observer.records.values()].at(-1);
        assert.equal(server.variant, variant); assert.equal(server.status, 200); assert.equal(server.disconnected, false);
        assert.equal(server.baselineReports, variant === 'baseline' ? 1 : 0);
        assert.equal(server.candidateReports, variant === 'candidate' ? 1 : 0);
        assert.equal(server.pendingSnapshots, 0); assert.ok(server.snapshots > 0, 'REPORT_PROBE_SNAPSHOTS_REQUIRED');
        assert.equal(server.snapshotFailures, 0);
        assert.equal(server.centralAuthority.queryFailures, 0);
        assert.equal(server.centralAuthority.rollbacks, 0);
        assert.ok(server.centralAuthority.authorityBegins > 0, 'REPORT_PROBE_TRANSACTIONS_REQUIRED');
        assert.equal(server.centralAuthority.physicalBegins, server.centralAuthority.commits);
        assert.equal(server.centralAuthority.connections, server.centralAuthority.authorityBegins);
        assert.deepEqual(Object.keys(server.stages), ['report', 'privateSummary', 'centralSummary', 'dashboardContext']);
        assert.ok(Object.values(server.stages).every(stage => stage.calls === 1 && stage.failures === 0));
        const responseHash = digest(body), fingerprints = digest(server.fingerprints);
        referenceHash ||= responseHash; referenceFingerprints ||= fingerprints;
        assert.equal(responseHash, referenceHash, 'REPORT_PROBE_RESPONSE_PARITY');
        assert.equal(fingerprints, referenceFingerprints, 'REPORT_PROBE_SNAPSHOT_PARITY');
        const result = {variant, pair, ms, responseHash, responseBytes: Buffer.byteLength(JSON.stringify(body)), server};
        evidence[phase].push(result); save();
        console.log(JSON.stringify({phase, variant, pair, ms, reportMs: server.stages.report.ms,
          centralPhysicalTransactions: server.centralAuthority.physicalBegins,
          centralAuthorityTransactions: server.centralAuthority.authorityBegins,
          reportPhysicalTransactions: server.stages.report.centralAuthority.physicalBegins,
          reportAuthorityTransactions: server.stages.report.centralAuthority.authorityBegins}));
      } catch (error) {
        const server = observer.records.size > previous ? [...observer.records.values()].at(-1) : null;
        evidence.attempts.push({variant, phase, pair, status: response?.status() ?? null,
          ms: round(performance.now() - started), error: safeError(error),
          ...(server?.variant === variant ? {server} : {})});
        save(); throw error;
      } finally {await response?.dispose();}
    }
    function verifyPair(rows, pair) {
      const baseline = rows.find(row => row.variant === 'baseline' && row.pair === pair);
      const candidate = rows.find(row => row.variant === 'candidate' && row.pair === pair);
      assert.equal(baseline.server.centralAuthority.authorityBegins - candidate.server.centralAuthority.authorityBegins, 2, 'REPORT_PROBE_AUTHORITY_TRANSACTION_REDUCTION');
      assert.equal(baseline.server.centralAuthority.physicalBegins - candidate.server.centralAuthority.physicalBegins, 4, 'REPORT_PROBE_PHYSICAL_TRANSACTION_REDUCTION');
      assert.equal(baseline.server.stages.report.centralAuthority.authorityBegins - candidate.server.stages.report.centralAuthority.authorityBegins, 2, 'REPORT_PROBE_REPORT_AUTHORITY_TRANSACTION_REDUCTION');
      assert.equal(baseline.server.stages.report.centralAuthority.physicalBegins - candidate.server.stages.report.centralAuthority.physicalBegins, 4, 'REPORT_PROBE_REPORT_PHYSICAL_TRANSACTION_REDUCTION');
      for (const stage of ['privateSummary', 'centralSummary', 'dashboardContext']) {
        assert.deepEqual(baseline.server.stages[stage].centralAuthority, candidate.server.stages[stage].centralAuthority,
          'REPORT_PROBE_UNCHANGED_OTHER_STAGES');
      }
    }
    phase('WARMUPS');
    for (const variant of ['baseline', 'candidate']) await sample(variant, 'warmups', 0);
    verifyPair(evidence.warmups, 0);
    phase('MEASUREMENTS');
    for (let pair = 1; pair <= 10; pair++) {
      await host.assertEnvironmentUnchanged();
      for (const variant of pair % 2 ? ['baseline', 'candidate'] : ['candidate', 'baseline']) await sample(variant, 'samples', pair);
      verifyPair(evidence.samples, pair);
    }
    phase('FINAL_VERIFICATION');
    await host.assertEnvironmentUnchanged();
    const sourcesAfter = sourceSnapshot();
    evidence.sourceDrift = [...new Set([...Object.keys(sourcesBefore), ...Object.keys(sourcesAfter)])]
      .filter(file => sourcesBefore[file] !== sourcesAfter[file]);
    assert.deepEqual(evidence.sourceDrift, [], 'REPORT_PROBE_SOURCE_DRIFT');
    const baseline = evidence.samples.filter(row => row.variant === 'baseline');
    const candidate = evidence.samples.filter(row => row.variant === 'candidate');
    evidence.summary = {baseline: distribution(baseline.map(row => row.ms)), candidate: distribution(candidate.map(row => row.ms)),
      baselineReport: distribution(baseline.map(row => row.server.stages.report.ms)),
      candidateReport: distribution(candidate.map(row => row.server.stages.report.ms)),
      pairedSavingsMs: baseline.map(before => round(before.ms - candidate.find(after => after.pair === before.pair).ms)),
      centralPhysicalTransactionsBaseline: baseline.map(row => row.server.centralAuthority.physicalBegins),
      centralPhysicalTransactionsCandidate: candidate.map(row => row.server.centralAuthority.physicalBegins),
      centralAuthorityTransactionsBaseline: baseline.map(row => row.server.centralAuthority.authorityBegins),
      centralAuthorityTransactionsCandidate: candidate.map(row => row.server.centralAuthority.authorityBegins)};
    evidence.summary.meanReductionPercent = round(100 * (evidence.summary.baseline.meanMs - evidence.summary.candidate.meanMs) / evidence.summary.baseline.meanMs);
    evidence.summary.medianReductionPercent = round(100 * (evidence.summary.baseline.medianMs - evidence.summary.candidate.medianMs) / evidence.summary.baseline.medianMs);
    evidence.result = 'PASS';
    phase('COMPLETE');
  } catch (error) {
    failure = error; evidence.result = 'FAIL'; evidence.error = safeError(error);
    evidence.errorName = safeErrorName(error); evidence.pageDiagnostics = await pageDiagnostics(page);
  }
  finally {
    const cleanupErrors = [];
    try {await browser?.close();} catch (error) {cleanupErrors.push(safeError(error));}
    try {await host?.close();} catch (error) {cleanupErrors.push(safeError(error));}
    observer.restore();
    evidence.cleanup = {testHostClosed: cleanupErrors.length === 0, existingServicesManaged: false, errors: cleanupErrors};
    if (cleanupErrors.length) {evidence.result = 'FAIL'; evidence.error ||= 'REPORT_PROBE_CLEANUP_FAILED';}
    save();
    console.log('REPORT_AUTHORITY_MEASUREMENT_ARTIFACT ' + path.relative(cfg.root, out));
  }
  if (failure || evidence.result !== 'PASS') throw failure || Error(evidence.error);
  console.log(JSON.stringify({result: evidence.result, summary: evidence.summary}));
}
if (require.main === module) main().catch(error => {
  console.error('REPORT_AUTHORITY_MEASUREMENT_FAILED', safeError(error)); process.exitCode = 1;
});
module.exports = {canonical, digest, distribution, sourceSnapshot, classifyPageUrl, safeErrorName};
