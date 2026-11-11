'use strict';
// Local, authenticated read benchmark. No setup, migration, seed or import.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const {createHash} = require('node:crypto');
const {pathToFileURL} = require('node:url');
const {chromium} = require('../../../frontend/test-harness/node_modules/playwright');
const cfg = require('../../../backend/scripts/localPlatform/config');
const round = value => Math.round(value * 100) / 100;
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().filter(key => !['generatedAt', 'nextCursor', 'previousCursor'].includes(key)).map(key => [key, canonical(value[key])])) : value;
const digest = value => createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
function distribution(values) {
  const ordered = [...values].sort((a, b) => a - b);
  return {n: values.length, minMs: round(ordered[0]), medianMs: round((ordered[Math.floor((ordered.length - 1) / 2)] + ordered[Math.floor(ordered.length / 2)]) / 2),
    meanMs: round(values.reduce((sum, value) => sum + value, 0) / values.length), maxMs: round(ordered.at(-1))};
}

async function main() {
  assert.deepEqual(process.argv.slice(2), [], 'No target overrides are accepted.');
  const state = JSON.parse(fs.readFileSync(path.join(cfg.folder, 'runtime.json'), 'utf8'));
  assert.equal(state.phase, 'READY');
  assert.equal(state.identity.origin, 'http://localhost:3000');
  const origin = state.identity.origin;
  const startup = require('../../../scripts/start-local.cjs');
  await startup.assertApplicationPortsFree(state);
  await startup.assertExternalServices(state);
  const out = path.join(cfg.root, 'output/playwright/dashboard-loading-native-' + new Date().toISOString().replace(/[:.]/g, '-'));
  fs.mkdirSync(out, {recursive: true});
  const evidence = {observedAt: new Date().toISOString(), result: 'IN_PROGRESS', method: 'alternating same-process authenticated HTTP; reconstructed seven-query baseline; fresh security checkpoints',
    dataSource: 'existing local C4G development application', warmups: [], samples: [], pageSamples: [], blockedBusinessWrites: 0, pageErrors: []};
  const save = () => fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify(evidence, null, 2));
  const observer = require('./observer.cjs').install();
  let api, vite, browser;
  try {
    api = await require('../../../backend/scripts/localPlatform/runtime').startNative();
    const {createServer} = await import(pathToFileURL(path.join(cfg.root, 'frontend/node_modules/vite/dist/node/index.js')).href);
    vite = await createServer({root: path.join(cfg.root, 'frontend'), configFile: path.join(cfg.root, 'frontend/vite.config.js'), logLevel: 'error'});
    await vite.listen();
    console.log('DASHBOARD_MEASUREMENT_SERVERS_READY');
    browser = await chromium.launch({headless: true, executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe'});
    const context = await browser.newContext({viewport: {width: 1440, height: 1000}, reducedMotion: 'reduce'});
    const page = await context.newPage();
    page.setDefaultTimeout(45000);
    page.on('pageerror', error => evidence.pageErrors.push(error.name));
    await context.route('**/api/**', route => {
      const request = route.request(), pathname = new URL(request.url()).pathname;
      if (!pathname.startsWith('/api/auth/') && !['GET', 'HEAD', 'OPTIONS'].includes(request.method())) {
        evidence.blockedBusinessWrites++;
        return route.abort();
      }
      return route.continue();
    });
    const access = JSON.parse(fs.readFileSync(path.join(cfg.folder, 'access.json'), 'utf8'));
    await page.goto(origin + '/login');
    await page.locator('#username').waitFor();
    await page.locator('#username').fill(access.hugo.username);
    await page.locator('#password').fill(access.hugo.password);
    await page.locator('#kc-login').click();
    await page.waitForURL(url => url.origin === origin && !['/login', '/api/auth/oidc/callback'].includes(url.pathname));
    await page.waitForLoadState('networkidle');
    evidence.oidc = true;
    const target = origin + '/api/organizations/' + state.organizationId + '/dashboard/summary';
    let referenceHash, referenceFingerprints;
    async function sample(variant, phase, pair) {
      const before = observer.records.size, started = performance.now();
      const response = await context.request.get(target, {headers: {'X-C4G-Dashboard-Probe': variant, 'X-C4G-Organization': state.organizationId}, timeout: 45000});
      const body = await response.json(), ms = round(performance.now() - started);
      assert.equal(response.status(), 200, 'DASHBOARD_HTTP_' + response.status());
      assert.equal(body.report.organizationId, state.organizationId);
      assert.equal(observer.records.size, before + 1, 'ONE_OBSERVED_REQUEST_REQUIRED');
      const server = [...observer.records.values()].at(-1);
      assert.equal(server.variant, variant);
      assert.equal(server.status, 200);
      assert.equal(server.disconnected, false);
      assert.equal(server.pendingSnapshots, 0);
      assert.ok(server.snapshots > 0, 'SNAPSHOT_OBSERVER_REQUIRED');
      assert.equal(server.baseCommands, server.snapshots * (variant === 'baseline' ? 7 : 1));
      assert.deepEqual(Object.keys(server.stages), ['report', 'privateSummary', 'centralSummary', 'dashboardContext']);
      assert.ok(Object.values(server.stages).every(stage => stage.calls === 1 && stage.failures === 0));
      assert.equal(server.snapshotFailures, 0);
      const responseHash = digest(body), fingerprints = JSON.stringify(server.fingerprints);
      referenceHash ||= responseHash;
      referenceFingerprints ||= fingerprints;
      assert.equal(responseHash, referenceHash, 'RESPONSE_PARITY');
      assert.equal(fingerprints, referenceFingerprints, 'SNAPSHOT_PARITY');
      const result = {variant, pair, ms, responseHash, responseBytes: Buffer.byteLength(JSON.stringify(body)), server};
      evidence[phase].push(result); save();
      console.log(JSON.stringify({phase, variant, pair, ms, snapshots: server.snapshots, baseCommands: server.baseCommands}));
      await response.dispose();
    }
    for (const variant of ['baseline', 'candidate']) await sample(variant, 'warmups', 0);
    for (let pair = 1; pair <= 10; pair++) {
      for (const variant of pair % 2 ? ['baseline', 'candidate'] : ['candidate', 'baseline']) await sample(variant, 'samples', pair);
    }
    for (let index = 0; index < 3; index++) {
      await context.setExtraHTTPHeaders({'X-C4G-Dashboard-Probe': 'candidate'});
      const responses = [];
      const capture = response => {
        if (new URL(response.url()).pathname.endsWith('/dashboard/summary')) responses.push(response);
      };
      page.on('response', capture);
      const started = performance.now();
      await page.goto(origin + '/dashboard');
      await page.getByRole('heading', {name: 'Dashboard operacional', exact: true}).waitFor();
      const headingMs = round(performance.now() - started);
      await page.locator('.dashboard-stats .stat-num').first().waitFor();
      const readyMs = round(performance.now() - started);
      await page.waitForLoadState('networkidle');
      page.off('response', capture);
      assert.equal(await page.getByRole('alert').count(), 0, 'DASHBOARD_ALERT');
      const completed = [];
      for (const response of responses) {
        await response.finished();
        assert.equal(response.status(), 200);
        assert.equal(digest(await response.json()), referenceHash);
        completed.push(round(response.request().timing().responseEnd));
      }
      evidence.pageSamples.push({headingMs, readyMs, completedSummaryRequests: completed.length, requestMs: completed});
      save();
      console.log(JSON.stringify({phase: 'page', index, headingMs, readyMs}));
    }
    await page.screenshot({path: path.join(out, 'dashboard-1440.png'), fullPage: true, animations: 'disabled'});
    await page.setViewportSize({width: 390, height: 900});
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'MOBILE_OVERFLOW');
    await page.screenshot({path: path.join(out, 'dashboard-390.png'), fullPage: true, animations: 'disabled'});
    const baseline = evidence.samples.filter(row => row.variant === 'baseline'), candidate = evidence.samples.filter(row => row.variant === 'candidate');
    evidence.summary = {baseline: distribution(baseline.map(row => row.ms)), candidate: distribution(candidate.map(row => row.ms)),
      pairedSavingsMs: baseline.map(before => round(before.ms - candidate.find(after => after.pair === before.pair).ms)),
      pageHeading: distribution(evidence.pageSamples.map(row => row.headingMs)), pageReady: distribution(evidence.pageSamples.map(row => row.readyMs))};
    evidence.summary.meanReductionPercent = round(100 * (evidence.summary.baseline.meanMs - evidence.summary.candidate.meanMs) / evidence.summary.baseline.meanMs);
    evidence.summary.medianReductionPercent = round(100 * (evidence.summary.baseline.medianMs - evidence.summary.candidate.medianMs) / evidence.summary.baseline.medianMs);
    assert.deepEqual(evidence.pageErrors, []);
    evidence.result = 'PASS';
  } catch (error) {
    evidence.result = 'FAIL';
    evidence.error = /^[A-Z0-9_]+$/.test(error.message || '') ? error.message : error.code || error.name;
    throw error;
  } finally {
    await browser?.close();
    await vite?.close();
    await api?.close();
    observer.restore();
    evidence.testServersClosed = true;
    save();
    console.log('DASHBOARD_MEASUREMENT_ARTIFACT ' + path.relative(cfg.root, out));
  }
  console.log(JSON.stringify({result: evidence.result, summary: evidence.summary}));
}
main().catch(error => {
  console.error('DASHBOARD_MEASUREMENT_FAILED', /^[A-Z0-9_]+$/.test(error.message || '') ? error.message : error.code || error.name);
  process.exitCode = 1;
});
