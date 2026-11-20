'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { createRequestPhaseTiming, configuredRequestPhaseTiming, routeTemplate } = require('../src/observability/requestPhaseTiming');

function exchange(url, method = 'GET') {
  const res = new EventEmitter();
  res.statusCode = 200;
  return { req: { method, originalUrl: url }, res };
}

test('phase timing is off unless explicitly configured, and rejects unknown modes', () => {
  assert.equal(configuredRequestPhaseTiming({}), null);
  assert.equal(configuredRequestPhaseTiming({ REQUEST_PHASE_TIMING: '' }), null);
  assert.equal(configuredRequestPhaseTiming({ REQUEST_PHASE_TIMING: 'off' }), null);
  assert.throws(() => configuredRequestPhaseTiming({ REQUEST_PHASE_TIMING: 'header' }), TypeError);
  const timing = configuredRequestPhaseTiming({ REQUEST_PHASE_TIMING: 'log' });
  assert.equal(typeof timing.middleware, 'function');
  assert.equal(typeof timing.observe, 'function');
});

test('one line per request sums the phases observed inside it', async () => {
  const lines = [];
  let clock = 1000;
  const timing = createRequestPhaseTiming({ write: line => lines.push(JSON.parse(line)), now: () => clock, clock: () => new Date(0) });
  const { req, res } = exchange('/api/applications/3f2b8c1e-0000-4000-8000-000000000001/team?secret=1');
  timing.observe('authority.lock', 99); // outside any request: ignored
  await new Promise(resolve => timing.middleware(req, res, async () => {
    timing.observe('authority.lock', 10.04);
    await Promise.resolve();
    timing.observe('authority.lock', 5);
    timing.observe('touch.total', 7);
    timing.observe('user-supplied', 3); // not a known phase: ignored
    timing.observe('authority.verify', NaN);
    resolve();
  }));
  clock = 1250.26;
  res.statusCode = 201;
  res.emit('finish');
  res.emit('close'); // must not emit twice
  assert.deepEqual(lines, [{
    signalCode: 'c4g.api.request_phases', timestamp: '1970-01-01T00:00:00.000Z', method: 'GET',
    route: '/api/applications/:id/team', status: 201, totalMs: 250.3,
    phases: { 'authority.lock': { count: 2, ms: 15 }, 'touch.total': { count: 1, ms: 7 } }
  }]);
});

test('concurrent requests keep their own phases', async () => {
  const lines = [];
  const timing = createRequestPhaseTiming({ write: line => lines.push(JSON.parse(line)) });
  const a = exchange('/api/auth/session'), b = exchange('/api/notifications');
  let releaseA;
  const gate = new Promise(resolve => { releaseA = resolve; });
  const first = new Promise(resolve => timing.middleware(a.req, a.res, async () => { await gate; timing.observe('authority.lock', 1); resolve(); }));
  await new Promise(resolve => timing.middleware(b.req, b.res, async () => { timing.observe('sessionRead.verify', 2); resolve(); }));
  releaseA(); await first;
  a.res.emit('finish'); b.res.emit('close');
  assert.deepEqual(lines.map(line => [line.route, Object.keys(line.phases)]),
    [['/api/auth/session', ['authority.lock']], ['/api/notifications', ['sessionRead.verify']]]);
});

test('a failing writer never reaches the response', async () => {
  const timing = createRequestPhaseTiming({ write: () => { throw new Error('stdout closed'); } });
  const { req, res } = exchange('/api/auth/session');
  await new Promise(resolve => timing.middleware(req, res, resolve));
  assert.doesNotThrow(() => res.emit('finish'));
});

test('route templates carry no identifiers or query strings', () => {
  assert.equal(routeTemplate('/api/organizations/42/dashboard?x=1'), '/api/organizations/:id/dashboard');
  assert.equal(routeTemplate('/api/catalog-read/v1/Items/a_b'), '/api/catalog-read/:id/:id/:id');
  assert.equal(routeTemplate('/api/opportunity-interests'), '/api/opportunity-interests');
  assert.equal(routeTemplate(undefined), '/');
  assert.equal(routeTemplate('/api/' + 'a'.repeat(41)), '/api/:id');
});

test('the app mounts phase timing before the session and only when given', () => {
  const { createApp } = require('../src/app');
  const order = [];
  const named = name => Object.assign((req, res, next) => next(), { marker: name });
  const express = () => ({ use(...args) { for (const arg of args.flat()) if (arg?.marker) order.push(arg.marker); }, get() {}, set() {} });
  express.json = () => (req, res, next) => next();
  const security = { nodeEnv: 'production', allowedDevelopmentOrigins: [], sessionMiddleware: named('session'),
    credentialGuard: named('guard'), originProtection: named('origin'), csrfProtection: named('csrf') };
  const base = { express, cors: () => named('cors'), config: { nodeEnv: 'production', rateLimit: { authPerMinute: 10, apiPerMinute: 10 } }, pool: {}, routes: {}, security };
  createApp({ ...base, phaseTiming: named('phases') });
  assert.deepEqual(order.slice(0, 2), ['phases', 'session']);
  order.length = 0;
  createApp(base);
  assert.equal(order[0], 'session');
});

test('phases observed by the session store, including the touch at the end of the response, reach the line', async () => {
  const express = require('express'), session = require('express-session'), http = require('node:http');
  const lines = [];
  const timing = createRequestPhaseTiming({ write: line => lines.push(JSON.parse(line)) });
  const later = () => new Promise(resolve => setTimeout(resolve, 2));
  class Store extends session.Store {
    constructor() { super(); this.rows = new Map(); }
    get(sid, done) { later().then(() => { timing.observe('authority.lock', 1); done(null, this.rows.get(sid) || null); }); }
    set(sid, value, done) { later().then(() => { this.rows.set(sid, JSON.parse(JSON.stringify(value))); done(null); }); }
    touch(sid, value, done) { later().then(() => { timing.observe('touch.total', 3); done(null); }); }
    destroy(sid, done) { this.rows.delete(sid); done(null); }
  }
  const app = express();
  app.use('/api', timing.middleware);
  app.use(session({ store: new Store(), secret: 'test-only', resave: false, saveUninitialized: false, rolling: true }));
  app.get('/api/things/:id', async (req, res) => { req.session.seen = true; await later(); timing.observe('authority.verify', 2); res.json({}); });
  const server = http.createServer(app);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const url = `http://127.0.0.1:${server.address().port}/api/things/123?q=x`;
    const first = await fetch(url);
    await first.arrayBuffer();
    const second = await fetch(url, { headers: { cookie: first.headers.get('set-cookie').split(';')[0] } });
    await second.arrayBuffer();
    await later();
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
  assert.equal(lines.length, 2);
  assert.equal(lines[1].route, '/api/things/:id');
  assert.deepEqual(Object.keys(lines[1].phases).sort(), ['authority.lock', 'authority.verify', 'touch.total']);
});

test('measurePhase is a plain call while the diagnostic is off and records success and failure while on', async () => {
  const { measurePhase, setActiveRequestPhaseTiming } = require('../src/observability/requestPhaseTiming');
  const previous = setActiveRequestPhaseTiming(null);
  try {
    const pending = Promise.resolve(1);
    assert.equal(measurePhase('tenant.work', () => pending), pending);
    assert.equal(measurePhase('tenant.work', () => undefined), undefined);
    assert.throws(() => measurePhase('tenant.work', () => { throw new Error('sync'); }), /sync/);

    const lines = [];
    const timing = createRequestPhaseTiming({ write: line => lines.push(JSON.parse(line)) });
    setActiveRequestPhaseTiming(timing);
    const { req, res } = exchange('/api/applications/my-work');
    const failure = new Error('work failed');
    await new Promise(resolve => timing.middleware(req, res, async () => {
      assert.equal(await measurePhase('tenant.work', async () => 7), 7);
      assert.equal(measurePhase('tenant.verify', () => undefined), undefined);
      await assert.rejects(measurePhase('tenant.commit', async () => { throw failure; }), error => error === failure);
      assert.throws(() => measurePhase('tenant.guard', () => { throw failure; }), error => error === failure);
      resolve();
    }));
    res.emit('finish');
    assert.deepEqual(Object.fromEntries(Object.entries(lines[0].phases).map(([name, phase]) => [name, phase.count])),
      { 'tenant.work': 1, 'tenant.verify': 1, 'tenant.commit': 1, 'tenant.guard': 1 });
    assert.equal('aborted' in lines[0], false);
  } finally { setActiveRequestPhaseTiming(previous); }
});

test('a response the client abandoned is marked aborted', async () => {
  const lines = [];
  const timing = createRequestPhaseTiming({ write: line => lines.push(JSON.parse(line)) });
  const { req, res } = exchange('/api/applications/browse-page');
  res.writableFinished = false;
  await new Promise(resolve => timing.middleware(req, res, resolve));
  res.emit('close');
  assert.equal(lines[0].aborted, true);
});

test('the authority transaction reports its setup, work and commit', async () => {
  const seen = [];
  const { createAuthorityCoordinator } = require('../src/security/authorityCoordinator');
  const client = { host: 'h', port: 1, database: 'd', query: async sql => /session_user/.test(sql) ? { rows: [{ session_user: 'c4g_authority_runtime', current_user: 'c4g_authority_runtime' }] }
    : /c4g_database_identity/.test(sql) ? { rows: [{ valid: true }] } : { rows: [] }, release() {} };
  // The schema admission and the security snapshot need a real Central; only the phases around them are under test.
  const manifest = require('../src/security/authoritySecurityManifest');
  const { assertAuthorityAdmission, assertAuthoritySecurity } = manifest;
  manifest.assertAuthorityAdmission = async () => ({}); manifest.assertAuthoritySecurity = async () => {};
  try {
    const coordinator = createAuthorityCoordinator({ pool: { connect: async () => client, query: async () => ({ rows: [] }) },
      permitSecret: 'a'.repeat(64), observeTiming: name => seen.push(name) });
    await coordinator.withAuthority(async () => {});
  } finally { Object.assign(manifest, { assertAuthorityAdmission, assertAuthoritySecurity }); }
  for (const name of ['authority.setup', 'authority.work', 'authority.commit']) assert.ok(seen.includes(name), name);
});
