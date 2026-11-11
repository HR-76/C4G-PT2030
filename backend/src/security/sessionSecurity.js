const session = require("express-session");
const connectPgSimple = require("connect-pg-simple");
const crypto = require("node:crypto");
const { csrfSync } = require("csrf-sync");
const { createOriginProtection } = require("./originProtection");

function csrfTokenForSession(req, secret) {
  if (typeof req.sessionID !== "string" || !req.sessionID) return undefined;
  return `v1.${crypto.createHmac("sha256", secret).update(`c4g-csrf-v1\0${req.sessionID}`).digest("base64url")}`;
}

function isStoreRecoveryEndpoint(req) {
  const pathname = String(req.originalUrl || req.url || "").split("?", 1)[0];
  return (req.method === "POST" && pathname === "/api/auth/logout")
    || (req.method === "GET" && pathname === "/api/auth/csrf");
}

function createSessionSecurity({ config, pool, sessionStore, sessionModule = session, authorityCoordinator = null, observeSessionTiming = null, coalesceSessionTouches = false }) {
  const PgStore = connectPgSimple(sessionModule);
  const store = sessionStore || new PgStore({ pool, schemaName: "public", tableName: "application_session_store", createTableIfMissing: false,
    ...(authorityCoordinator ? {pruneSessionInterval:false} : {}) });
  if (authorityCoordinator) require('./coordinatedSessionStore').coordinateSessionStore(store,{
    coordinator:authorityCoordinator,idleMs:config.sessionIdleMs,observeTiming:observeSessionTiming,coalesceTouches:coalesceSessionTouches,
    validateSession:require('./sessionRegistry').createPgSessionRegistry(pool).validateSession
  });
  const baseSessionMiddleware = sessionModule({
    store,
    name: config.sessionCookieName,
    secret: config.sessionSecret,
    resave: false,
    saveUninitialized: false,
    rolling: true,
    cookie: {
      secure: config.secureCookie,
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: config.sessionIdleMs
    }
  });
  const sessionMiddleware = (req, res, next) => baseSessionMiddleware(req, res, error => {
    if (!error) return next();
    if (typeof req.sessionID !== "string" || !req.sessionID || !isStoreRecoveryEndpoint(req)) return next(error);
    req.sessionLoadFailed = true;
    req.recoverySessionId = req.sessionID;
    return next();
  });
  const csrf = csrfSync({
    getTokenFromRequest: req => req.get("x-csrf-token"),
    getTokenFromState: req => csrfTokenForSession(req, config.sessionSecret),
    storeTokenInState: () => {},
    errorConfig: { statusCode: 403, code: "CSRF_INVALID", message: "Prova CSRF inválida." }
  });
  const allowedOrigins = [
    config.publicOrigin.origin,
    ...(config.nodeEnv === "production" ? [] : config.allowedDevelopmentOrigins)
  ];
  return {
    sessionStore: store,
    sessionMiddleware,
    credentialGuard: (req, res, next) => next(),
    originProtection: createOriginProtection({ allowedOrigins }),
    csrfProtection: csrf.csrfSynchronisedProtection,
    generateCsrfToken: req => {
      if (req.session) req.session.csrfBindingVersion = 1;
      return csrf.generateToken(req);
    },
    revokeCsrfToken: csrf.revokeToken,
    nodeEnv: config.nodeEnv,
    allowedDevelopmentOrigins: config.allowedDevelopmentOrigins
  };
}

module.exports = { createSessionSecurity, csrfTokenForSession };
