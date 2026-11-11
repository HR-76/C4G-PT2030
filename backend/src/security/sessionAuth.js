let configured = { now: () => Date.now(), sessionRegistry: null, policyVersion: null };
// A request whose session was validated by an earlier middleware of the same
// request is not validated against the registry again. The mark lives outside
// the request object, so request data can never forge it; policy and expiry
// are still checked on every call.
const validatedRequests = new WeakSet();

function configureSessionAuthentication(options) {
  configured = { ...configured, ...options };
}

async function authenticateSession(req, res, next) {
  const auth = req.session && req.session.auth;
  if (!auth || !auth.user || !auth.absoluteExpiresAt || !auth.identity || !auth.revocationVersion) return false;
  if (!configured.policyVersion || auth.policyVersion !== configured.policyVersion
    || !auth.evidence || auth.evidence.policyVersion !== configured.policyVersion) {
    res.status(401).json({ code: "SESSION_POLICY_VERSION_MISMATCH", message: "Session authentication policy is no longer current." });
    return true;
  }
  if (configured.now() >= auth.absoluteExpiresAt) {
    const failures = [];
    try {
      if (!configured.sessionRegistry) throw new Error("Session registry unavailable.");
      await configured.sessionRegistry.expireSession(req.sessionID);
    } catch {
      failures.push("SESSION_METADATA_EXPIRY_FAILED");
    }
    try {
      await new Promise((resolve, reject) => req.session.destroy(error => error ? reject(error) : resolve()));
    } catch {
      failures.push("SESSION_STORE_DESTROY_FAILED");
    }
    if (failures.length > 0) {
      res.status(503).json({ code: "SESSION_EXPIRY_INCOMPLETE", message: "A sessão expirou, mas a limpeza persistente requer reconciliação." });
      return true;
    }
    res.status(401).json({ code: "SESSION_EXPIRED", message: "Sessão expirada." });
    return true;
  }
  if (!configured.sessionRegistry) {
    res.status(503).json({ code: "SESSION_VALIDATION_UNAVAILABLE", message: "Não foi possível validar a sessão." });
    return true;
  }
  try {
    const valid = validatedRequests.has(req) || await configured.sessionRegistry.validateSession({
      sid: req.sessionID,
      globalUserId: auth.user.id,
      revocationVersion: auth.revocationVersion,
      now: configured.now()
    });
    if (!valid) {
      res.status(401).json({ code: "SESSION_REVOKED", message: "Sessão inválida ou revogada." });
      return true;
    }
  } catch {
    res.status(503).json({ code: "SESSION_VALIDATION_UNAVAILABLE", message: "Não foi possível validar a sessão." });
    return true;
  }
  validatedRequests.add(req);
  req.user = auth.user;
  req.authContext = {
    sessionId: req.sessionID,
    evidence: auth.evidence,
    policyVersion: auth.policyVersion
  };
  next();
  return true;
}

function hasSession(req) {
  return Boolean(req.session && req.session.auth);
}

module.exports = { authenticateSession, configureSessionAuthentication, hasSession };
