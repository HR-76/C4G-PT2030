const { safeReturnPath } = require("../security/authConfig");
const { buildAssuranceEvidence, evaluateAssurance } = require("../security/assurance");
const { sealAccountToken, readEmailPreference } = require('../security/emailAccount');

function regenerateSession(req) {
  return new Promise((resolve, reject) => req.session.regenerate(error => error ? reject(error) : resolve()));
}

function destroySession(req) {
  return new Promise((resolve, reject) => req.session.destroy(error => error ? reject(error) : resolve()));
}

function saveSession(req) {
  if (typeof req.session.save !== "function") return Promise.resolve();
  return new Promise((resolve, reject) => req.session.save(error => error ? reject(error) : resolve()));
}

async function persistRotatedAuthenticationSession({ req, sessionRegistry, rotation }) {
  try {
    await saveSession(req);
    await sessionRegistry.rotateSession(rotation);
  } catch (error) {
    try {
      await destroySession(req);
    } catch (cleanupError) {
      throw new AggregateError(
        [error, cleanupError],
        "Authentication session persistence and compensation failed.",
        { cause: error }
      );
    }
    throw error;
  }
}

function createOidcAuthController({ config, oidcClient, identityRepository, membershipRepository = null, sessionRegistry, audit = () => {}, now = () => Date.now() }) {
  async function begin(req, res, next, stepUp = false, accountAction = null) {
    try {
      const category = stepUp ? String(req.query.category || "") : null;
      const requirement = stepUp ? config.assurancePolicy[category] : null;
      if (stepUp && (!req.session.auth || !requirement)) {
        return res.status(stepUp ? 400 : 401).json({ code: "ASSURANCE_CATEGORY_INVALID", message: "Categoria de autenticação inválida." });
      }
      const returnPath = accountAction ? '/conta/seguranca' : safeReturnPath(req.query.returnTo, "/");
      const result = await oidcClient.begin({
        stepUp,
        maxAge: requirement && requirement.maxAgeSeconds,
        acrValues: requirement ? requirement.acceptedAcr : [],
        returnPath, accountAction
      });
      req.session.oidcTransaction = { ...result.transaction, category, ...(accountAction ? {
        accountAction, expectedIdentity: req.session.auth.identity
      } : {}) };
      await saveSession(req);
      await sessionRegistry.registerOidcTransaction({
        sid: req.sessionID,
        state: result.transaction.state,
        expiresAt: result.transaction.createdAt + config.oidcTransactionMs
      });
      if (accountAction) return res.set('Cache-Control', 'no-store').json({ redirectUrl: result.redirectUrl });
      return res.redirect(302, result.redirectUrl);
    } catch (error) {
      return next(error);
    }
  }

  async function callback(req, res, next) {
    res.set?.('Cache-Control', 'no-store');
    const transaction = req.session && req.session.oidcTransaction;
    const instant = now();
    const invalidDate = transaction && (!Number.isSafeInteger(transaction.createdAt) || transaction.createdAt > instant);
    if (!transaction || invalidDate || instant - transaction.createdAt >= config.oidcTransactionMs) {
      audit('authentication.callback_failed', { reason: !transaction ? 'OIDC_TRANSACTION_MISSING'
        : invalidDate ? 'OIDC_TRANSACTION_INVALID' : 'OIDC_TRANSACTION_EXPIRED' });
      // Wildcard/API Accept headers retain the JSON error contract. Never copy
      // callback parameters into the recovery URL or automatically retry OIDC.
      const accept = req.get?.('accept') || '';
      if (/(?:^|,)\s*text\/html\s*(?:;|,|$)/i.test(accept)
        && req.accepts?.(['json', 'html']) === 'html') {
        return res.redirect(303, '/login?authentication=expired');
      }
      return res.status(400).json({ code: "OIDC_TRANSACTION_INVALID", message: "Transação OIDC inválida ou expirada." });
    }
    if (!req.query || typeof req.query.state !== "string" || req.query.state !== transaction.state) {
      audit("authentication.callback_failed", { reason: "OIDC_STATE_MISMATCH" });
      return res.status(400).json({ code: "OIDC_CALLBACK_REJECTED", message: "Resposta de autenticação recusada." });
    }
    delete req.session.oidcTransaction;
    let consumed;
    try {
      consumed = await sessionRegistry.consumeOidcTransaction({ sid: req.sessionID, state: transaction.state, now: now() });
    } catch {
      audit("authentication.callback_dependency_unavailable", { reason: "OIDC_TRANSACTION_REGISTRY_UNAVAILABLE" });
      return res.status(503).json({ code: "AUTHENTICATION_DEPENDENCY_UNAVAILABLE", message: "Não foi possível validar a transação de autenticação." });
    }
    if (!consumed) {
      return res.status(400).json({ code: "OIDC_TRANSACTION_ALREADY_USED", message: "Transação OIDC já utilizada ou inválida." });
    }
    if (req.query.error === 'access_denied') {
      await saveSession(req);
      return res.redirect(303, transaction.accountAction && req.session.auth
        ? '/conta/seguranca?verification=cancelled' : '/login?authentication=cancelled');
    }
    let oidcValidated = false;
    try {
      const { claims, accountAccessToken, accountTokenExpiresAt } = await oidcClient.callback(`${config.publicOrigin.origin}${req.originalUrl}`, transaction);
      oidcValidated = true;
      if (transaction.accountAction && (claims.iss !== transaction.expectedIdentity?.issuer || claims.sub !== transaction.expectedIdentity?.subject)) {
        return res.status(403).json({ code: 'ACCOUNT_IDENTITY_MISMATCH', message: 'A identidade não corresponde à sessão.' });
      }
      const evidence = buildAssuranceEvidence(claims, config.policyVersion);
      const previousAbsoluteExpiresAt = req.session.auth && req.session.auth.absoluteExpiresAt;
      const originalIdentity = req.session.auth && req.session.auth.identity;
      let user = req.session.auth && req.session.auth.user;
      if (!transaction.stepUp) {
        user = await identityRepository.resolve(claims);
        if (!user) {
          audit("authentication.denied", { reason: "IDENTITY_NOT_ACTIVE" });
          return res.status(403).json({ code: "IDENTITY_NOT_ACTIVE", message: "Identidade sem acesso ativo." });
        }
        const claimRoles = Array.isArray(claims.realm_access && claims.realm_access.roles) ? claims.realm_access.roles : [];
        const privileged = [...(user.platformRoles || []), ...claimRoles].some(role => config.privilegedRoleNames.includes(role));
        if (privileged) {
          const requirement = config.assurancePolicy[config.privilegedLoginCategory];
          const decision = evaluateAssurance({
            evidence, requirement, nowSeconds: Math.floor(now() / 1000), expectedPolicyVersion: config.policyVersion
          });
          if (!decision.allowed) {
            audit("authentication.denied", { reason: decision.reason, globalUserId: user.id });
            return res.status(403).json({ code: decision.reason, message: requirement.mfa
              ? "MFA recente obrigatório para este perfil." : "É necessário voltar a autenticar para este perfil." });
          }
        }
      } else {
        if (!originalIdentity || claims.iss !== originalIdentity.issuer || claims.sub !== originalIdentity.subject) {
          audit("authentication.step_up_denied", { reason: "STEP_UP_IDENTITY_MISMATCH", globalUserId: user && user.id });
          return res.status(403).json({ code: "STEP_UP_IDENTITY_MISMATCH", message: "A identidade do step-up não corresponde à sessão." });
        }
        const requirement = config.assurancePolicy[transaction.category];
        const decision = evaluateAssurance({
          evidence, requirement, nowSeconds: Math.floor(now() / 1000), expectedPolicyVersion: config.policyVersion
        });
        if (!decision.allowed) {
          audit("authentication.step_up_denied", { reason: decision.reason, globalUserId: user && user.id });
          return res.status(403).json({ code: decision.reason, message: "Evidência de autenticação insuficiente." });
        }
      }
      const previousSid = req.sessionID;
      let organizationContext = req.session.auth && req.session.auth.organizationContext;
      if (!transaction.stepUp && membershipRepository) {
        const eligibleMemberships = await membershipRepository.listEligible(user.id, now());
        organizationContext = eligibleMemberships.length === 1 ? eligibleMemberships[0] : null;
      }
      await regenerateSession(req);
      req.session.auth = {
        user,
        identity: { issuer: claims.iss, subject: claims.sub },
        evidence,
        policyVersion: config.policyVersion,
        revocationVersion: user.sessionRevocationVersion,
        authenticatedAt: now(),
        absoluteExpiresAt: transaction.stepUp && previousAbsoluteExpiresAt
          ? Math.min(previousAbsoluteExpiresAt, now() + config.sessionAbsoluteMs)
          : now() + config.sessionAbsoluteMs,
        organizationContext: organizationContext || null
      };
      if (config.emailVerification) req.session.auth.accountToken = sealAccountToken(config,
        req.session.auth.identity, accountAccessToken, accountTokenExpiresAt);
      try {
        await persistRotatedAuthenticationSession({
          req,
          sessionRegistry,
          rotation: {
            previousSid,
            sid: req.sessionID,
            globalUserId: user.id,
            revocationVersion: user.sessionRevocationVersion,
            expiresAt: req.session.auth.absoluteExpiresAt,
            organizationContext
          }
        });
      } catch (error) {
        if (error instanceof AggregateError) {
          audit("authentication.session_reconciliation_required", {
            globalUserId: user.id,
            reason: "SESSION_BIND_AND_COMPENSATION_FAILED"
          });
        }
        audit("authentication.session_persistence_failed", { globalUserId: user.id, reason: "SESSION_REGISTRY_UNAVAILABLE" });
        return res.status(503).json({ code: "SESSION_PERSISTENCE_UNAVAILABLE", message: "Não foi possível concluir a sessão." });
      }
      audit(transaction.stepUp ? "authentication.step_up_succeeded" : "authentication.login_succeeded", { globalUserId: user.id });
      return res.redirect(302, transaction.accountAction && req.query.kc_action_status === 'cancelled'
        ? '/conta/seguranca?verification=cancelled' : safeReturnPath(transaction.returnPath));
    } catch {
      if (oidcValidated) {
        audit("authentication.callback_dependency_unavailable", { reason: "AUTHENTICATION_PERSISTENCE_UNAVAILABLE" });
        return res.status(503).json({ code: "AUTHENTICATION_DEPENDENCY_UNAVAILABLE", message: "Não foi possível concluir a autenticação." });
      }
      audit("authentication.callback_failed", { reason: "OIDC_VALIDATION_FAILED" });
      return res.status(400).json({ code: "OIDC_CALLBACK_REJECTED", message: "Resposta de autenticação recusada." });
    }
  }

  async function logout(req, res, next) {
    const globalUserId = req.session && req.session.auth && req.session.auth.user && req.session.auth.user.id;
    const sid = req.recoverySessionId || req.sessionID;
    const failures = [];
    res.clearCookie(config.sessionCookieName, { secure: config.secureCookie, httpOnly: true, sameSite: "lax", path: "/" });
    try {
      if (!sessionRegistry || !sid) throw new Error("Session metadata unavailable.");
      await sessionRegistry.revokeSession(sid, "LOCAL_LOGOUT");
    } catch {
      failures.push("SESSION_METADATA_REVOCATION_FAILED");
    }
    try {
      if (!req.session || typeof req.session.destroy !== "function") throw new Error("Session store unavailable.");
      await destroySession(req);
    } catch {
      failures.push("SESSION_STORE_DESTROY_FAILED");
    }
    let identityLogoutUnavailable = false;
    const redirectUrl = await oidcClient.endSessionUrl().catch(() => {
      identityLogoutUnavailable = true;
      audit("authentication.identity_logout_unavailable", { globalUserId });
      return config.postLogoutRedirectUri.href;
    });
    if (failures.length > 0) {
      audit("authentication.logout_reconciliation_required", { globalUserId, failures });
      return res.status(503).json({
        code: "LOGOUT_INCOMPLETE",
        message: "Sessão local limpa; revogação persistente requer reconciliação e novo logout após recuperação.",
        redirectUrl,
        retryRequired: true
      });
    }
    audit("authentication.logout", { globalUserId });
    return res.status(200).json({ redirectUrl, identityLogoutUnavailable });
  }

  return {
    stepUpPolicy: (_req, res) => res.set('Cache-Control', 'no-store')
      .json({ mfaOptional: config.policyVersion === 'c4g-user-mfa-v1' }),
    accountSecurity: async (req, res) => {
      const settings = { managementPath: '/api/auth/account', mfaOptional: config.policyVersion === 'c4g-user-mfa-v1' };
      if (!config.emailVerification) return res.json(settings);
      res.set('Cache-Control', 'no-store');
      try { return res.json({ ...settings, emailVerification: await readEmailPreference(config, req.session.auth) }); }
      catch (error) {
        if (error.code === 'ACCOUNT_REAUTH_REQUIRED') return res.json({ ...settings,
          emailVerification: { available: false, reauthenticationRequired: true } });
        return res.status(503)
          .json({ code: error.code, message: 'Não foi possível confirmar o estado no fornecedor de identidade.' });
      }
    },
    emailVerification: (req, res, next) => {
      if (!config.emailVerification) return res.status(503).json({ code: 'ACCOUNT_PROVIDER_UNAVAILABLE' });
      if (!req.session?.auth?.identity) return res.status(401).json({ code: 'AUTHENTICATION_REQUIRED' });
      if (!req.body || Object.keys(req.body).some(key => key !== 'action') || !['enable', 'disable'].includes(req.body.action)) {
        return res.status(400).json({ code: 'ACCOUNT_ACTION_INVALID' });
      }
      return begin(req, res, next, false, req.body.action);
    },
    account: (req, res) => {
      const url = new URL(config.issuer.href.replace(/\/$/, '') + '/account/account-security/signing-in');
      url.searchParams.set('referrer', config.clientId);
      return res.redirect(302, url.href);
    },
    login: (req, res, next) => begin(req, res, next, false),
    stepUp: (req, res, next) => begin(req, res, next, true),
    callback,
    logout
  };
}

module.exports = { createOidcAuthController, persistRotatedAuthenticationSession };
