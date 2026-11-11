'use strict';

const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { PassThrough } = require('node:stream');
const test = require('node:test');
const {
  LocalStartupError,
  ServiceSupervisor,
  assertApplicationPortsFree,
  assertExternalServices,
  buildServices,
  ensureLocalIdentity,
  fetchLocalIdentity,
  isLocalIdentityReady,
  isReadyHealth,
  nodeVersionSupported,
  readRuntimeState,
  waitForReady
} = require('../scripts/start-local.cjs');

function readyState(overrides = {}) {
  return {
    phase: 'READY',
    installationId: 'local-test',
    target: { host: 'localhost', port: 5432 },
    identity: { issuer: 'https://localhost:8443/realms/c4g-native-local' },
    ...overrides
  };
}

function identityFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'c4g-local-active-identity-'));
  const composeFile = path.join(root, 'test', 'integration', 'f2', 'compose.yaml');
  const envFile = path.join(root, '.tmp', 'f2-integration', '.env');
  const proxyFile = path.join(root, '.tmp', 'f2-integration', 'demo-nginx.conf');
  fs.mkdirSync(path.dirname(composeFile), { recursive: true });
  fs.mkdirSync(path.dirname(envFile), { recursive: true });
  fs.writeFileSync(composeFile, 'services: {}\n');
  fs.writeFileSync(envFile, 'TEST_ONLY=true\n');
  fs.writeFileSync(proxyFile, [
    'location = /realms/c4g-native-local { set $native_email_backend http://native-email-idp:8080; proxy_pass $native_email_backend; }',
    'location ^~ /realms/c4g-native-local/ { set $native_email_backend http://native-email-idp:8080; proxy_pass $native_email_backend; }'
  ].join('\n'));
  const mountResult = source => ({ status: 0, stdout: JSON.stringify([
    { Type: 'bind', Source: source || proxyFile, Destination: '/etc/nginx/conf.d/default.conf' }
  ]) });
  return { root, composeFile, envFile, proxyFile, mountResult };
}

test('accepts the documented Node baseline', () => {
  assert.equal(nodeVersionSupported('24.5.0'), true);
  assert.equal(nodeVersionSupported('24.4.9'), false);
  assert.equal(nodeVersionSupported('25.0.0'), true);
  assert.equal(nodeVersionSupported('invalid'), false);
});

test('requires a prepared private runtime without exposing its contents', () => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'c4g-local-start-'));
  const filename = path.join(folder, 'runtime.json');
  assert.throws(() => readRuntimeState(filename), error => {
    assert(error instanceof LocalStartupError);
    assert.equal(error.code, 'LOCAL_DEV_SETUP_REQUIRED');
    return true;
  });
  fs.writeFileSync(filename, '{broken');
  assert.throws(() => readRuntimeState(filename), error => error.code === 'LOCAL_DEV_STATE_INVALID');
  fs.writeFileSync(filename, JSON.stringify(readyState({ privateMarker: 'must-not-be-printed' })));
  assert.equal(readRuntimeState(filename).installationId, 'local-test');
});

test('includes the funding worker only when configured', () => {
  assert.deepEqual(buildServices(readyState()).map(service => service.name), ['api', 'web']);
  assert.deepEqual(
    buildServices(readyState({ funding: { source: 'live-local' } })).map(service => service.name),
    ['api', 'worker', 'web']
  );
});

test('supervised nodemon exits on API crash so the supervisor can stop sibling services', () => {
  const api = buildServices(readyState()).find(service => service.name === 'api');
  assert.deepEqual(api.args.slice(1), ['--exitcrash', 'scripts/startDev.js']);
});

test('recognizes only the expected healthy C4G environment', () => {
  assert.equal(isReadyHealth({ status: 200, body: { ready: true, environment: 'C4G local' } }), true);
  assert.equal(isReadyHealth({ status: 200, body: { ready: true, environment: 'other' } }), false);
  assert.equal(isReadyHealth({ status: 503, body: { ready: false, environment: 'C4G local' } }), false);
});

test('reports occupied application ports including the activation bridge', async () => {
  const observed = [];
  const connect = async port => {
    observed.push(port);
    return port === 5285;
  };
  await assert.rejects(
    assertApplicationPortsFree(readyState({ memberAccess: true }), connect),
    error => error.code === 'LOCAL_DEV_PORT_IN_USE' && /5285/.test(error.message)
  );
  assert.deepEqual(observed, [3000, 5000, 5285]);
});

test('reports unavailable PostgreSQL without trying to start identity', async () => {
  let identityCalled = false;
  await assert.rejects(
    assertExternalServices(readyState(), async () => false, async () => { identityCalled = true; }),
    error => error.code === 'LOCAL_DEV_SERVICE_UNAVAILABLE'
      && /PostgreSQL \(localhost:5432\)/.test(error.message)
  );
  assert.equal(identityCalled, false);
});

test('does not invoke Docker when local identity is already available', async () => {
  let dockerCalled = false;
  const result = await ensureLocalIdentity({
    issuer: 'https://localhost:8443/realms/c4g-native-local',
    connect: async () => true,
    fetchImpl: async () => ({
      ok: true,
      json: async () => ({
        issuer: 'https://localhost:8443/realms/c4g-native-local',
        authorization_endpoint: 'https://localhost:8443/realms/c4g-native-local/protocol/openid-connect/auth'
      })
    }),
    spawnSyncImpl: () => { dockerCalled = true; }
  });
  assert.deepEqual(result, { started: false });
  assert.equal(dockerCalled, false);
});

test('starts only the existing Keycloak and proxy containers and waits for OIDC discovery', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'c4g-local-identity-'));
  const composeFile = path.join(root, 'test', 'integration', 'f2', 'compose.yaml');
  const envFile = path.join(root, '.tmp', 'f2-integration', '.env');
  fs.mkdirSync(path.dirname(composeFile), { recursive: true });
  fs.mkdirSync(path.dirname(envFile), { recursive: true });
  fs.writeFileSync(composeFile, 'services: {}\n');
  fs.writeFileSync(envFile, 'TEST_ONLY=true\n');
  const calls = [];
  let attempts = 0;
  const messages = [];
  const result = await ensureLocalIdentity({
    root,
    issuer: 'https://localhost:8443/realms/c4g-native-local',
    connect: async () => { attempts += 1; return attempts >= 2; },
    fetchImpl: async () => ({
      ok: true,
      json: async () => ({
        issuer: 'https://localhost:8443/realms/c4g-native-local',
        authorization_endpoint: 'https://localhost:8443/realms/c4g-native-local/protocol/openid-connect/auth'
      })
    }),
    spawnSyncImpl(command, args, options) {
      calls.push({ command, args, options });
      if (args[0] === 'inspect') return { status: 0, stdout: JSON.stringify([
        { Type: 'bind', Source: path.join(root, 'test', 'integration', 'f2', 'nginx.conf'), Destination: '/etc/nginx/conf.d/default.conf' }
      ]) };
      return { status: 0 };
    },
    intervalMs: 1,
    log: message => messages.push(message)
  });
  assert.deepEqual(result, { started: true });
  assert.equal(calls.length, 2);
  assert.equal(calls[0].command, 'docker');
  assert.deepEqual(calls[0].args, ['inspect', 'c4g-f2-integration-proxy-1', '--format', '{{json .Mounts}}']);
  assert.deepEqual(calls[1].args, [
    'compose', '--project-name', 'c4g-f2-integration',
    '--env-file', envFile,
    '-f', composeFile,
    'start', 'keycloak', 'proxy'
  ]);
  assert.equal(calls[1].args.includes('up'), false);
  assert.equal(calls[1].options.cwd, root);
  assert(messages.some(message => /contentores existentes/.test(message)));
  assert(messages.some(message => /disponível/.test(message)));
});

test('recovers the mounted native identity database and IdP in order before the existing proxy', async () => {
  const fixture = identityFixture(), calls = [];
  let started = false, probes = 0;
  const issuer = 'https://localhost:8443/realms/c4g-native-local';
  const result = await ensureLocalIdentity({
    root: fixture.root, issuer,
    connect: async () => started,
    fetchImpl: async () => ({ ok: true, json: async () => ({ issuer, authorization_endpoint: issuer + '/auth' }) }),
    spawnSyncImpl(command, args) {
      assert.equal(command, 'docker'); calls.push(args);
      if (args[0] === 'inspect') return fixture.mountResult();
      if (args[0] === 'exec') return { status: ++probes >= 2 ? 0 : 1 };
      if (args[0] === 'compose') started = true;
      return { status: 0 };
    },
    intervalMs: 1, log: () => {}
  });
  assert.deepEqual(result, { started: true });
  assert.deepEqual(calls.slice(0, 5), [
    ['inspect', 'c4g-f2-integration-proxy-1', '--format', '{{json .Mounts}}'],
    ['start', 'c4g-native-email-pg'],
    ['exec', 'c4g-native-email-pg', 'pg_isready', '-q'],
    ['exec', 'c4g-native-email-pg', 'pg_isready', '-q'],
    ['start', 'c4g-native-email-idp']
  ]);
  assert.deepEqual(calls[5].slice(-3), ['start', 'keycloak', 'proxy']);
  assert.equal(calls.flat().some(value => /smtp|password|recreate|restart/.test(value)), false);
});

test('unknown or ambiguous proxy mounts fail without starting containers', async () => {
  for (const source of ['unapproved-nginx.conf', null]) {
    const fixture = identityFixture(), calls = [];
    await assert.rejects(ensureLocalIdentity({
      root: fixture.root, issuer: readyState().identity.issuer,
      connect: async () => false,
      spawnSyncImpl(command, args) {
        calls.push(args);
        return source ? fixture.mountResult(path.join(fixture.root, source)) : { status: 0, stdout: '[]' };
      }, log: () => {}
    }), error => error.code === 'LOCAL_DEV_IDENTITY_PROFILE_UNKNOWN');
    assert.deepEqual(calls.map(args => args[0]), ['inspect']);
  }
});

test('native profile requires the expected realm routes and upstream before starting containers', async () => {
  const fixture = identityFixture(), calls = [];
  fs.writeFileSync(fixture.proxyFile, 'location / { proxy_pass http://unknown:8080; }');
  await assert.rejects(ensureLocalIdentity({
    root: fixture.root, issuer: readyState().identity.issuer,
    connect: async () => false,
    spawnSyncImpl(command, args) { calls.push(args); return fixture.mountResult(); },
    log: () => {}
  }), error => error.code === 'LOCAL_DEV_IDENTITY_PROFILE_UNKNOWN');
  assert.deepEqual(calls.map(args => args[0]), ['inspect']);
});

test('native identity database timeout prevents IdP and proxy startup', async () => {
  const fixture = identityFixture(), calls = [];
  await assert.rejects(ensureLocalIdentity({
    root: fixture.root, issuer: readyState().identity.issuer,
    connect: async () => false,
    spawnSyncImpl(command, args) {
      calls.push(args);
      if (args[0] === 'inspect') return fixture.mountResult();
      return { status: args[0] === 'exec' ? 1 : 0 };
    },
    databaseTimeoutMs: 1, intervalMs: 1, log: () => {}
  }), error => error.code === 'LOCAL_DEV_IDENTITY_DATABASE_TIMEOUT');
  assert(calls.some(args => args[0] === 'exec'));
  assert.equal(calls.some(args => args.includes('c4g-native-email-idp') || args[0] === 'compose'), false);
});

test('reports a missing prepared identity profile without invoking Docker', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'c4g-local-no-identity-'));
  let dockerCalled = false;
  await assert.rejects(
    ensureLocalIdentity({
      root,
      issuer: 'https://localhost:8443/realms/c4g-native-local',
      connect: async () => false,
      spawnSyncImpl: () => { dockerCalled = true; }
    }),
    error => error.code === 'LOCAL_DEV_IDENTITY_NOT_PREPARED'
      && /\.tmp\/f2-integration\/\.env/.test(error.message)
  );
  assert.equal(dockerCalled, false);
});

test('does not accept an open proxy port before OIDC discovery is ready', async () => {
  const ready = await isLocalIdentityReady('https://localhost:8443/realms/c4g-native-local', {
    connect: async () => true,
    fetchImpl: async () => ({ ok: false })
  });
  assert.equal(ready, false);
});

test('identity readiness probes the configured HTTPS proxy and rejects its failure even when direct Keycloak is healthy', async () => {
  const issuer = 'https://localhost:8443/realms/c4g-native-local';
  const urls = [];
  const ready = await isLocalIdentityReady(issuer, {
    connect: async () => true,
    fetchImpl: async url => {
      urls.push(String(url));
      return { ok: url.protocol === 'http:', json: async () => ({ issuer, authorization_endpoint: issuer + '/protocol/openid-connect/auth' }) };
    }
  });
  assert.equal(ready, false);
  assert.deepEqual(urls, [issuer + '/.well-known/openid-configuration']);
});

test('identity HTTPS requests trust only the prepared CA and keep certificate verification enabled', async () => {
  const certificate = Buffer.from('synthetic local CA');
  const controller = new AbortController();
  let observed;
  const response = await fetchLocalIdentity(new URL('https://localhost:8443/realms/c4g-native-local/.well-known/openid-configuration'), {
    signal: controller.signal,
    readCertificate: () => certificate,
    requestImpl(url, options, callback) {
      observed = { url, options };
      const request = new EventEmitter();
      const incoming = new PassThrough();
      incoming.statusCode = 200;
      process.nextTick(() => {
        callback(incoming);
        incoming.end(JSON.stringify({ issuer: 'synthetic' }));
      });
      return request;
    }
  });
  assert.equal(observed.options.ca, certificate);
  assert.equal(observed.options.rejectUnauthorized, true);
  assert.equal(observed.options.signal, controller.signal);
  assert.equal(response.ok, true);
  assert.deepEqual(await response.json(), { issuer: 'synthetic' });
});

test('identity readiness refuses nonlocal or decorated issuers before network access', async () => {
  for (const issuer of [
    'http://localhost:8443/realms/c4g-native-local',
    'https://external.invalid:8443/realms/c4g-native-local',
    'https://localhost:9443/realms/c4g-native-local',
    'https://private:private@localhost:8443/realms/c4g-native-local',
    'https://localhost:8443/realms/c4g-native-local?private=value',
    'https://localhost:8443/realms/c4g-native-local#private'
  ]) {
    let accessed = false;
    assert.equal(await isLocalIdentityReady(issuer, {
      connect: async () => { accessed = true; return true; },
      fetchImpl: async () => { accessed = true; }
    }), false);
    assert.equal(accessed, false);
  }
});

test('missing local CA has a safe actionable error before any Docker operation', async () => {
  const fixture = identityFixture();
  let dockerCalled = false;
  await assert.rejects(ensureLocalIdentity({
    root: fixture.root, issuer: readyState().identity.issuer,
    connect: async () => true,
    spawnSyncImpl: () => { dockerCalled = true; }
  }), error => error.code === 'LOCAL_DEV_IDENTITY_CA_INVALID' && !error.message.includes(fixture.root));
  assert.equal(dockerCalled, false);
});

test('waits until the full health endpoint is ready', async () => {
  const responses = [
    { status: 503, json: async () => ({ ready: false, workerReady: false, admissionReady: true }) },
    { status: 200, json: async () => ({ ready: true, environment: 'C4G local' }) }
  ];
  const result = await waitForReady({
    connect: async () => true,
    fetchImpl: async () => responses.shift(),
    timeoutMs: 100,
    intervalMs: 1
  });
  assert.equal(result.type, 'ready');
});

test('waits for the API port before probing health through Vite', async () => {
  const events = [];
  const result = await waitForReady({
    async connect(port) {
      assert.equal(port, 5000);
      events.push('api');
      return events.length === 2;
    },
    async fetchImpl(url) {
      events.push('proxy');
      assert.equal(url, 'http://localhost:3000/api/local-health');
      return { status: 200, json: async () => ({ ready: true, environment: 'C4G local' }) };
    },
    timeoutMs: 1000,
    intervalMs: 1
  });
  assert.equal(result.type, 'ready');
  assert.deepEqual(events, ['api', 'api', 'proxy']);
});

test('cancels readiness polling without retaining the timeout loop', async () => {
  const controller = new AbortController();
  const startedAt = Date.now();
  const pending = waitForReady({
    connect: async () => true,
    fetchImpl: async () => ({ status: 503, json: async () => ({ ready: false }) }),
    timeoutMs: 60000,
    intervalMs: 30000,
    signal: controller.signal
  });
  controller.abort();
  assert.deepEqual(await pending, { type: 'cancelled' });
  assert(Date.now() - startedAt < 1000);
});

test('reports an unexpected child exit and terminates the remaining supervised process', async () => {
  const children = [];
  const spawnImpl = () => {
    const child = new EventEmitter();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.exitCode = null;
    child.signalCode = null;
    child.pid = 1000 + children.length;
    children.push(child);
    return child;
  };
  const terminated = [];
  const terminateImpl = async child => {
    terminated.push(child.pid);
    child.exitCode = 0;
    child.emit('exit', 0, null);
  };
  const services = buildServices(readyState());
  const supervisor = new ServiceSupervisor(services, {
    spawnImpl,
    terminateImpl
  });
  supervisor.start();
  children[0].exitCode = 1;
  children[0].emit('exit', 1, null);
  const outcome = await supervisor.failure;
  assert.equal(outcome.type, 'failure');
  assert.match(outcome.error.message, /api terminou inesperadamente/);
  await supervisor.stop();
  assert.deepEqual(terminated, [children[1].pid]);
});

