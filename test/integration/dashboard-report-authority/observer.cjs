'use strict';
// Test-process observer only. Production entrypoints never load this module.
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const {AsyncLocalStorage} = require('node:async_hooks');
const {createHash} = require('node:crypto');
const root = path.resolve(__dirname, '../../..');
const originalBaselinePath = path.join(__dirname, 'fixtures/composition-before.cjs');
const baselinePath = path.join(__dirname, 'fixtures/composition-shared-before.cjs');
const compositionPath = path.join(root, 'backend/src/applications/composition.js');
const originalBaselineHash = 'cec6036997941ebf27a1f4cdef370e7699eda7eed401b6f7cb083bbaa66bf0ca';
const baselineHash = '2796dd3fe64ef4482c265f39886331cdd37a5d86c5d3038111aa6da6e8270f4a';
const beforeExpression = "scope.getStore()?.method==='partnersBrowse'";
const afterExpression = "['partnersBrowse','report'].includes(scope.getStore()?.method)";
const hash = value => createHash('sha256').update(value).digest('hex');
const round = number => Math.round(number * 100) / 100;
let installed = false;

function validateSources(before, after) {
  if (hash(before) !== baselineHash) throw Error('REPORT_AUTHORITY_BASELINE_HASH_MISMATCH');
  const original = before.toString('utf8'), current = after.toString('utf8');
  if (original.split(beforeExpression).length !== 2
      || current !== original.replace(beforeExpression, afterExpression)) {
    throw Error('REPORT_AUTHORITY_CANDIDATE_SOURCE_MISMATCH');
  }
  return {baselineSha256: hash(before), candidateSha256: hash(after), originalBaselineSha256: originalBaselineHash,
    sharedBaseline: true, independentSharedChange: 'readResponsibleDirectory and its repository wiring/export'};
}

function compileBaseline(source) {
  // Original filename and module search paths preserve every relative import.
  // It is deliberately not entered into require.cache under the production ID.
  const baseline = new Module(compositionPath, module);
  baseline.filename = compositionPath;
  baseline.paths = Module._nodeModulePaths(path.dirname(compositionPath));
  baseline._compile(source.toString('utf8'), compositionPath);
  return baseline.exports.createApplicationComposition;
}

const counters = () => ({connections: 0, commands: 0, physicalBegins: 0, authorityBegins: 0,
  commits: 0, rollbacks: 0, queryFailures: 0});

// Dependency injection is confined to this test module, for isolated observer
// regressions. install() below is the only real-runtime entrypoint.
function installObserver({schema, routes, coordinator, loadCompositions, sourceEvidence = null}) {
  if (installed) throw Error('REPORT_AUTHORITY_OBSERVER_ALREADY_INSTALLED');
  const requestScope = new AsyncLocalStorage(), stageScope = new AsyncLocalStorage(), records = new Map();
  const originalSnapshot = schema.tenantSchemaSnapshot;
  const originalCoordinator = coordinator.createAuthorityCoordinator;
  const originalRouter = routes.createOrganizationDashboardRouter;
  let active = true, sequence = 0, composition, originalComposition;
  installed = true;
  const recordNow = () => active && requestScope.getStore();
  const count = (record, key) => {
    record.centralAuthority[key]++;
    const stage = stageScope.getStore();
    if (stage?.record === record) stage.entry.centralAuthority[key]++;
  };
  function observeClient(client) {
    return new Proxy(client, {get(target, key) {
      if (key === 'query') return function(...args) {
        const record = recordNow();
        if (!record) return target.query.apply(target, args);
        count(record, 'commands');
        const sql = typeof args[0] === 'string' ? args[0] : args[0]?.text;
        const statement = typeof sql === 'string' ? sql.trim().replace(/;$/, '').trim().toUpperCase() : '';
        // assertAuthorityAdmission performs its own BEGIN TRANSACTION READ ONLY
        // and COMMIT before the coordinator's exact BEGIN. Both are physical
        // transactions; only the exact BEGIN belongs to the protected authority.
        if (/^(?:BEGIN\b|START\s+TRANSACTION\b)/.test(statement)) count(record, 'physicalBegins');
        if (statement === 'BEGIN') count(record, 'authorityBegins');
        let result;
        try { result = target.query.apply(target, args); }
        catch (error) { count(record, 'queryFailures'); throw error; }
        return Promise.resolve(result).then(value => {
          if (/^COMMIT(?:\s+(?:WORK|TRANSACTION))?$/.test(statement)) count(record, 'commits');
          if (/^ROLLBACK(?:\s+(?:WORK|TRANSACTION))?$/.test(statement)) count(record, 'rollbacks');
          return value;
        }, error => { count(record, 'queryFailures'); throw error; });
      };
      const value = Reflect.get(target, key, target);
      return typeof value === 'function' ? value.bind(target) : value;
    }});
  }
  function observedCoordinator(options) {
    const pool = options.pool;
    const observedPool = new Proxy(pool, {get(target, key) {
      if (key === 'connect') return async function(...args) {
        // The coordinator's pool port is promise-based; callbacks are not used.
        if (args.some(value => typeof value === 'function')) throw Error('REPORT_AUTHORITY_CONNECT_INTERFACE_CHANGED');
        const record = recordNow();
        if (record) count(record, 'connections');
        return observeClient(await target.connect.apply(target, args));
      };
      const value = Reflect.get(target, key, target);
      return typeof value === 'function' ? value.bind(target) : value;
    }});
    return originalCoordinator.call(this, {...options, pool: observedPool});
  }
  async function observedSnapshot(client) {
    const record = recordNow();
    if (!record) return originalSnapshot.call(this, client);
    record.snapshots++; record.pendingSnapshots++;
    try {
      const snapshot = await originalSnapshot.call(this, client);
      const fingerprint = schema.tenantSchemaFingerprint(snapshot);
      record.fingerprints[fingerprint] = (record.fingerprints[fingerprint] || 0) + 1;
      return snapshot;
    } catch (error) { record.snapshotFailures++; throw error; }
    finally { record.pendingSnapshots--; }
  }
  function timed(stage, fn, receiver, args) {
    const record = recordNow();
    if (!record) return fn.apply(receiver, args);
    const entry = record.stages[stage] ||= {calls: 0, ms: 0, failures: 0, centralAuthority: counters()};
    const started = performance.now(); entry.calls++;
    return stageScope.run({record, entry}, async () => {
      try { return await fn.apply(receiver, args); }
      catch (error) { entry.failures++; throw error; }
      finally { entry.ms = round(entry.ms + performance.now() - started); }
    });
  }
  function observedRouter(options) {
    const wrapper = options.express.Router();
    wrapper.use((req, res, next) => {
      const variant = req.get('X-C4G-Report-Authority-Probe');
      if (!active || req.method !== 'GET' || !/^\/[^/]+\/dashboard\/summary\/?$/.test(req.path)
          || !['baseline', 'candidate'].includes(variant)) return next();
      const record = {id: ++sequence, variant, status: null, httpMs: null, disconnected: false,
        baselineReports: 0, candidateReports: 0, snapshots: 0, pendingSnapshots: 0,
        snapshotFailures: 0, fingerprints: {}, centralAuthority: counters(), stages: {}};
      records.set(record.id, record);
      const started = performance.now(); let finished = false;
      const finish = disconnected => {
        if (finished) return;
        finished = true; record.status = res.statusCode;
        record.httpMs = round(performance.now() - started); record.disconnected = disconnected;
      };
      res.once('finish', () => finish(false));
      res.once('close', () => finish(!res.writableFinished));
      return requestScope.run(record, next);
    });
    const applications = {...options.applications, execute(...args) {
      return timed(args[0], options.applications.execute, options.applications, args);
    }};
    const opportunities = {...options.opportunities, dashboardSummary(...args) {
      return timed('privateSummary', options.opportunities.dashboardSummary, options.opportunities, args);
    }};
    const central = options.central && {...options.central, dashboardSummary(...args) {
      return timed('centralSummary', options.central.dashboardSummary, options.central, args);
    }};
    wrapper.use(originalRouter.call(this, {...options, applications, opportunities, central}));
    return wrapper;
  }
  function observedComposition(...args) {
    const candidate = originalComposition.apply(this, args);
    const baseline = baselineFactory.apply(this, args);
    return Object.freeze({...candidate, execute(...executeArgs) {
      const record = recordNow(), report = executeArgs[0] === 'report';
      const useBaseline = report && record?.variant === 'baseline';
      if (record && report) record[useBaseline ? 'baselineReports' : 'candidateReports']++;
      const selected = useBaseline ? baseline : candidate;
      return selected.execute.apply(selected, executeArgs);
    }});
  }
  let baselineFactory;
  function restore() {
    if (!active) return;
    active = false;
    if (schema.tenantSchemaSnapshot === observedSnapshot) schema.tenantSchemaSnapshot = originalSnapshot;
    if (coordinator.createAuthorityCoordinator === observedCoordinator) coordinator.createAuthorityCoordinator = originalCoordinator;
    if (routes.createOrganizationDashboardRouter === observedRouter) routes.createOrganizationDashboardRouter = originalRouter;
    if (composition?.createApplicationComposition === observedComposition) composition.createApplicationComposition = originalComposition;
    installed = false;
  }
  try {
    schema.tenantSchemaSnapshot = observedSnapshot;
    coordinator.createAuthorityCoordinator = observedCoordinator;
    routes.createOrganizationDashboardRouter = observedRouter;
    ({composition, baselineFactory} = loadCompositions());
    originalComposition = composition.createApplicationComposition;
    if (typeof originalComposition !== 'function' || typeof baselineFactory !== 'function') throw Error('REPORT_AUTHORITY_FACTORIES_REQUIRED');
    composition.createApplicationComposition = observedComposition;
    return {records, sourceEvidence, restore};
  } catch (error) { restore(); throw error; }
}

function install() {
  if (installed) throw Error('REPORT_AUTHORITY_OBSERVER_ALREADY_INSTALLED');
  // Loading after these consumers would leave destructured collectors/factories
  // unobserved and could silently undercount the experiment.
  for (const relative of ['backend/src/applications/composition.js', 'backend/src/productionComposition.js',
    'backend/src/security/tenantRuntime.js', 'backend/src/security/authoritySecurityManifest.js']) {
    if (require.cache[path.join(root, relative)]) throw Error('REPORT_AUTHORITY_OBSERVER_INSTALL_TOO_LATE');
  }
  if (hash(fs.readFileSync(originalBaselinePath)) !== originalBaselineHash) throw Error('REPORT_AUTHORITY_ORIGINAL_BASELINE_CHANGED');
  const before = fs.readFileSync(baselinePath), after = fs.readFileSync(compositionPath);
  const sourceEvidence = validateSources(before, after);
  return installObserver({
    schema: require('../../../backend/src/security/tenantSchemaFingerprint'),
    routes: require('../../../backend/src/routes/organizationDashboardRoutes'),
    coordinator: require('../../../backend/src/security/authorityCoordinator'),
    sourceEvidence,
    loadCompositions: () => ({composition: require(compositionPath), baselineFactory: compileBaseline(before)}),
  });
}
module.exports = {install, installObserver, validateSources, baselinePath, originalBaselinePath, compositionPath};
