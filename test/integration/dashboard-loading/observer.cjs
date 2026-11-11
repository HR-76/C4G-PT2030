'use strict';
// Test-process A/B observer. Install before loading the local runtime consumers.
// Never loaded by the application entrypoints. No SQL, parameters or data values
// are retained in its telemetry; the baseline changes only seven catalog reads.
const {AsyncLocalStorage} = require('node:async_hooks');
const legacy = require('../../../backend/test/support/tenantSchemaLegacyQueries.json');
const normalize = sql => sql.replace(/\s+/g, ' ').trim();
const fields = Object.freeze(['schemas', 'tables', 'columns', 'constraints', 'indexes', 'triggers', 'functions']);
// Two closed SQL signatures. The seven-statement baseline must use the same
// projection as the observed aggregate, so batching never changes SQL semantics.
const canonicalConstraints = normalize(legacy.base.constraints)
  .replace(' ELSE pg_catalog.pg_get_constraintdef', " WHEN con.contype='n' AND NOT con.condeferrable AND NOT con.condeferred " +
    'AND array_ndims(con.conkey)=1 AND array_lower(con.conkey,1)=1 AND array_length(con.conkey,1)=1 ' +
    "AND nn.attnum>0 AND NOT nn.attisdropped THEN 'NOT NULL '||pg_catalog.quote_ident(nn.attname) ELSE pg_catalog.pg_get_constraintdef")
  .replace(' WHERE n.nspname', " LEFT JOIN pg_catalog.pg_attribute nn ON con.contype='n' AND nn.attrelid = con.conrelid AND nn.attnum = con.conkey[1] WHERE n.nspname");
const projections = Object.freeze([
  {name: 'legacy', base: legacy.base},
  {name: 'canonical-not-null', base: Object.freeze({...legacy.base, constraints: canonicalConstraints})},
].map(projection => Object.freeze({...projection, expectedQuery: normalize('SELECT ' + fields.map(field =>
  `(SELECT COALESCE(json_agg(catalog_row), '[]'::json) FROM (${normalize(projection.base[field])}) AS catalog_row) AS "${field}"`
).join(', '))})));
const round = number => Math.round(number * 100) / 100;
let installed = false;

function install({routes: suppliedRoutes} = {}) {
  if (installed) throw Error('DASHBOARD_OBSERVER_ALREADY_INSTALLED');
  const schema = require('../../../backend/src/security/tenantSchemaFingerprint');
  const routes = suppliedRoutes || require('../../../backend/src/routes/organizationDashboardRoutes');
  const originalSnapshot = schema.tenantSchemaSnapshot;
  const originalFactory = routes.createOrganizationDashboardRouter;
  const scope = new AsyncLocalStorage(), records = new Map();
  let active = true, sequence = 0;
  installed = true;

  const observedSnapshot = async function(client) {
    const record = active && scope.getStore();
    if (!record) return originalSnapshot.call(this, client);
    record.snapshots++; record.pendingSnapshots++;
    let first = true;
    const query = async function(sql, values) {
      if (!first) {
        record.securityCommands++;
        return client.query.call(client, sql, values);
      }
      first = false;
      // Refuse a changed query or schema set rather than silently measuring a
      // different baseline. Every statement uses this same original client.
      const projection = typeof sql === 'string' && projections.find(value => value.expectedQuery === normalize(sql));
      if (!projection
        || !Array.isArray(values) || values.length !== 1
        || JSON.stringify(values[0]) !== JSON.stringify(schema.TENANT_SCHEMAS)) {
        throw Object.assign(Error('DASHBOARD_BASELINE_QUERY_MISMATCH'), {code: 'DASHBOARD_BASELINE_QUERY_MISMATCH'});
      }
      record.projections[projection.name] = (record.projections[projection.name] || 0) + 1;
      if (record.variant === 'candidate') {
        record.baseCommands++;
        return client.query.call(client, sql, values);
      }
      const row = {};
      for (const field of fields) {
        record.baseCommands++;
        const result = await client.query.call(client, projection.base[field], values);
        if (!Array.isArray(result?.rows)) throw Error('DASHBOARD_BASELINE_RESULT_INVALID');
        row[field] = result.rows;
      }
      return {rows: [row], rowCount: 1};
    };
    const proxy = new Proxy(client, {get(target, key) {
      if (key === 'query') return query;
      const value = Reflect.get(target, key, target);
      return typeof value === 'function' ? value.bind(target) : value;
    }});
    try {
      const snapshot = await originalSnapshot.call(this, proxy);
      const digest = schema.tenantSchemaFingerprint(snapshot);
      record.fingerprints[digest] = (record.fingerprints[digest] || 0) + 1;
      return snapshot;
    } catch (error) { record.snapshotFailures++; throw error; }
    finally { record.pendingSnapshots--; }
  };
  schema.tenantSchemaSnapshot = observedSnapshot;

  function timed(stage, original, receiver, args) {
    const record = active && scope.getStore();
    if (!record) return original.apply(receiver, args);
    const entry = record.stages[stage] ||= {calls: 0, ms: 0, failures: 0};
    const started = performance.now(); entry.calls++;
    let result;
    try { result = original.apply(receiver, args); }
    catch (error) { entry.ms = round(entry.ms + performance.now() - started); entry.failures++; throw error; }
    return Promise.resolve(result).then(value => {
      entry.ms = round(entry.ms + performance.now() - started); return value;
    }, error => { entry.ms = round(entry.ms + performance.now() - started); entry.failures++; throw error; });
  }

  const observedFactory = function(options) {
    const wrapper = options.express.Router();
    wrapper.use((req, res, next) => {
      const variant = req.get('X-C4G-Dashboard-Probe');
      if (!active || req.method !== 'GET' || !/^\/[^/]+\/dashboard\/summary\/?$/.test(req.path)
        || !['baseline', 'candidate'].includes(variant)) return next();
      const record = {id: ++sequence, variant, status: null, httpMs: null, disconnected: false,
        snapshots: 0, baseCommands: 0, securityCommands: 0, pendingSnapshots: 0,
        snapshotFailures: 0, fingerprints: {}, projections: {}, stages: {}};
      records.set(record.id, record);
      const started = performance.now();
      let finished = false;
      const finish = disconnected => {
        if (finished) return;
        finished = true; record.status = res.statusCode; record.httpMs = round(performance.now() - started);
        record.disconnected = disconnected;
      };
      res.once('finish', () => finish(false));
      res.once('close', () => finish(!res.writableFinished));
      return scope.run(record, next);
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
    wrapper.use(originalFactory.call(this, {...options, applications, opportunities, central}));
    return wrapper;
  };
  routes.createOrganizationDashboardRouter = observedFactory;

  return {records, restore() {
    if (!active) return;
    active = false;
    if (schema.tenantSchemaSnapshot === observedSnapshot) schema.tenantSchemaSnapshot = originalSnapshot;
    if (routes.createOrganizationDashboardRouter === observedFactory) routes.createOrganizationDashboardRouter = originalFactory;
    installed = false;
  }};
}

module.exports = {install};
