function authEndpointCatalog(routes) {
  return routes.oidcAuth
    ? ["GET /api/auth/oidc/login", "GET /api/auth/oidc/callback", "GET /api/auth/step-up", "GET /api/auth/step-up-policy", "GET /api/auth/account-security", "POST /api/auth/account-security/email", "GET /api/auth/account", "GET /api/auth/csrf", "GET /api/auth/session", "GET /api/auth/organizations", "POST /api/auth/organization", "POST /api/auth/logout"]
    : [];
}
function opportunityEndpointCatalog() {
  return ["GET /api/opportunities", "GET /api/opportunities/:id", "POST /api/admin/central-opportunities"];
}
function importEndpointCatalog() {
  return ['POST /api/imports/xlsx','POST /api/imports/:id/preview','POST /api/imports/:id/confirm','GET /api/imports','GET /api/imports/:id','POST /api/imports/:id/cancel','POST /api/imports/:id/possible/:line/review','GET /api/imports/:id/report'];
}
function billingEndpointCatalog() {
  return [
    'GET /api/admin/billing/summary', 'GET /api/admin/billing/cycles',
    'GET /api/admin/billing/cycles/:cycleId',
    'GET/PUT /api/admin/billing/organizations/:organizationId/account',
    'POST /api/admin/billing/cycles', 'PUT /api/admin/billing/cycles/:cycleId',
    'POST /api/admin/billing/cycles/:cycleId/transitions',
    'POST /api/admin/billing/cycles/:cycleId/documents',
    'POST /api/admin/billing/documents/:documentId/transitions',
    'POST /api/admin/billing/documents/:documentId/payments',
    'POST /api/admin/billing/payments/:paymentId/reversals'
  ];
}

const { createErrorHandler } = require('./middlewares/httpErrorHandler');

function parseTrustProxyHops(value) {
  if (value === undefined || value === null || value === '') return 1;
  const hops = Number(value);
  if (!Number.isSafeInteger(hops) || hops < 0 || hops > 10) throw new TypeError('TRUST_PROXY_HOPS must be an integer between 0 and 10.');
  return hops;
}

function createApp({ express, cors, config, pool, routes, security = null, databaseReadiness = null, reportError = () => {}, observability = null, platformLogs = null, admissionBoundary = null, admissionRoutes = null }) {
  if (!express || !cors || !config || !pool || !routes) {
    throw new TypeError("createApp requires express, cors, config, pool and routes dependencies.");
  }

  const app = express();
  const production = config.nodeEnv === "production" || security?.nodeEnv === "production";
  // Set before parsers and session guards so early refusals are uncached too.
  app.use('/api/auth', (_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
  });
  if (platformLogs) app.use(platformLogs.middleware);
  if (observability && observability.contextMiddleware) app.use(observability.contextMiddleware);
  const allowedOrigins = (config.corsOrigin || "").split(",").map(value => value.trim()).filter(Boolean);
  if (!security) {
    app.use(cors({ origin: allowedOrigins.length > 0 ? allowedOrigins : config.nodeEnv !== "production" }));
  } else {
    // Must equal the number of proxies in front of the API; a larger value lets clients forge their address.
    if (typeof app.set === "function") app.set("trust proxy", config.trustProxyHops ?? 1);
    if (security.nodeEnv !== "production" && security.allowedDevelopmentOrigins.length > 0) {
      const developmentOrigins = new Set(security.allowedDevelopmentOrigins);
      app.use(cors({ origin: (origin, callback) => callback(null, !origin || developmentOrigins.has(origin)), credentials: true }));
    }
  }
  app.use((req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Referrer-Policy", "no-referrer");
    // The legacy XSS auditor is itself exploitable; the CSP below is the control.
    res.setHeader("X-XSS-Protection", "0");
    if (production) res.setHeader("Strict-Transport-Security", "max-age=31536000");
    res.setHeader("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'");
    next();
  });
  if (security) {
    // Before parsers and the session store: a refused request costs no body
    // parsing and no Central query. Addresses come from the trusted proxy hop.
    const { createRateLimiter, loadRateLimitConfig } = require('./security/rateLimit');
    const limits = config.rateLimit || loadRateLimitConfig();
    app.use(['/api/auth/oidc/login', '/api/auth/oidc/callback'], createRateLimiter({ limit: limits.authPerMinute }));
    app.use('/api', createRateLimiter({ limit: limits.apiPerMinute }));
  }
  app.use('/api/organizational-profile/pq1-activation', (req,res,next)=>{res.setHeader('Cache-Control','no-store');next();},express.json({limit:'64kb'}));
  app.use('/api/organizational-profile/pq1-publication', (req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); }, express.json({ limit: '256kb' }));
  app.use('/api/organization-profile/editorial-ui', express.json({ limit: '256kb' }));
  app.use(['/api/opportunities/:id/prequalifications','/api/opportunities/prequalifications/:id'],(req,res,next)=>{res.setHeader('Cache-Control','no-store');next();},express.json({limit:'64kb'}));
  app.use('/api/opportunities/:id/criteria', express.json({ limit: '64kb' }));
  app.use('/api/admin/billing', express.json({ limit: '64kb' }));
  app.use('/api/admin/opportunity-activation', express.json({ limit: '16kb' }));
  app.use(express.json());

  if (security) {
    // One Central schema preflight per request; see requestAdmissionScope.
    app.use(require('./security/requestAdmissionScope').requestAdmissionMiddleware);
    app.use(security.sessionMiddleware);
    app.use(security.credentialGuard);
    app.use(security.originProtection);
    app.use(security.csrfProtection);
  }

  if (admissionBoundary) app.use(admissionBoundary);
  if (admissionRoutes) app.use('/api',admissionRoutes);
  if (routes.oidcAuth) app.use("/api/auth", routes.oidcAuth);
  if (routes.catalogRead) app.use('/api/catalog-read/v1', routes.catalogRead);
  if (routes.platformDirectory) app.use('/api/admin/directory',routes.platformDirectory);
  if (routes.customerBilling) app.use('/api/billing',routes.customerBilling);
  if (routes.platformBilling) app.use('/api/admin/billing',routes.platformBilling);
  app.use('/api/admin/opportunity-activation',routes.opportunityActivation||((req,res)=>res.status(503).set('Cache-Control','no-store').json({error:{code:'OPPORTUNITY_V2_NOT_CONFIGURED'}})));
  if(routes.pq1Consumer)app.use('/api/opportunities',routes.pq1Consumer);
  app.use('/api/organizational-profile/pq1-activation',routes.pq1Activation||((req,res)=>res.status(503).json({error:{code:'SERVICE_UNAVAILABLE'}})));
  app.use("/api/opportunities", routes.opportunities || ((req,res)=>res.status(503).json({error:{code:'SERVICE_UNAVAILABLE'}})));
  if(routes.profileEditorial)app.use('/api/organization-profile/editorial',routes.profileEditorial);
  app.use('/api/organizational-profile/pq1-publication', routes.profilePq1 || ((req,res) => res.status(503).json({
    error:{code:'SERVICE_UNAVAILABLE'},correlationId:require('node:crypto').randomUUID()
  })));
  // The UI composition is admitted only after its Central protocol capability is
  // installed and validated. Never fall back to unrestricted queries.
  app.use('/api/organization-profile/editorial-ui', routes.profileEditorialUi || ((req,res) => res.status(503).json({
    error:{code:'SERVICE_UNAVAILABLE'},correlationId:require('node:crypto').randomUUID()
  })));
  app.use("/api/opportunity-interests", routes.opportunityInterests || ((req,res)=>res.status(503).json({error:{code:'SERVICE_UNAVAILABLE'}})));
  app.use("/api/applications", routes.applications || ((req,res)=>res.status(503).json({error:{code:'SERVICE_UNAVAILABLE'}})));
  if(routes.organizationDashboard)app.use('/api/organizations',routes.organizationDashboard);
  app.use('/api/organization-directory',routes.organizationDirectory||((req,res)=>res.status(503).json({error:{code:'SERVICE_UNAVAILABLE'}})));
  app.use("/api/imports", routes.imports || ((req,res)=>res.status(503).json({error:{code:'OPPORTUNITY_IMPORT_NOT_CONFIGURED'}})));
  app.use('/api/admin/integrations',routes.fundingAdmin||((req,res)=>res.status(503).json({error:{code:'FUNDING_NOT_CONFIGURED'}})));
  app.use('/api/central-opportunities',routes.centralOpportunities||((req,res)=>res.status(503).json({error:{code:'FUNDING_NOT_CONFIGURED'}})));
  app.use('/api/admin/central-opportunities',routes.platformCentralOpportunities||((req,res)=>res.status(503).json({error:{code:'FUNDING_NOT_CONFIGURED'}})));
  app.use("/api/notifications", routes.notifications || ((req,res)=>res.status(503).json({error:{code:'SERVICE_UNAVAILABLE'}})));

  // Production does not describe its routes or version to unauthenticated callers.
  app.get("/", (req, res) => production ? res.json({ app: "GCNI_C4G", status: "running" }) : res.json({
    app: "GCNI_C4G",
    version: "1.0.0",
    status: "running",
    endpoints: {
      auth: authEndpointCatalog(routes),
      opportunities: opportunityEndpointCatalog(),
      applications: ['GET /api/applications','POST /api/applications','GET /api/applications/responsibles','GET /api/applications/:id','PUT /api/applications/:id','POST /api/applications/:id/transitions','GET /api/applications/:id/history'],
      imports: importEndpointCatalog(),
      ...(routes.platformBilling ? { platform_billing: billingEndpointCatalog() } : {}),
      matching: ["GET /api/organization-directory/matching"],
      notifications: ["GET /api/notifications", "PATCH /api/notifications/read-all", "PATCH /api/notifications/:id/read", "POST /api/notifications/check-deadlines"]
    }
  }));

  app.get("/health/db", async (req, res) => {
    if (databaseReadiness) {
      const result = await databaseReadiness.check();
      return res.status(result.ready ? 200 : 503).json({
        status: result.ready ? "ok" : "unhealthy",
        dependencies: result.dependencies
      });
    }
    try {
      await pool.query("SELECT NOW()");
      return res.json({ status: "ok", dependencies: { central: { status: "healthy" } } });
    } catch {
      return res.status(503).json({ status: "unhealthy", dependencies: { central: { status: "unhealthy" } } });
    }
  });

  app.get('/health/live', (req,res)=>res.status(200).json(observability ? observability.health.live() : { status:'LIVE', schemaVersion:1 }));
  app.get('/health/ready', async (req,res)=>{const result=observability ? await observability.health.check() : {status:'UNAVAILABLE',reasons:['OBSERVABILITY_NOT_CONFIGURED']};return res.status(result.status==='UNAVAILABLE'?503:200).json({schemaVersion:1,status:result.status,reasons:result.reasons});});

  app.use((req, res) => res.status(404).json({ message: "Rota não encontrada." }));
  app.use(createErrorHandler({ nodeEnv: config.nodeEnv, reportError }));
  return app;
}

module.exports = { authEndpointCatalog, opportunityEndpointCatalog, importEndpointCatalog,
  billingEndpointCatalog, createApp, createErrorHandler, parseTrustProxyHops };
