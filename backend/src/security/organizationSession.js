function regenerateSession(req) {
  return new Promise((resolve, reject) => req.session.regenerate(error => error ? reject(error) : resolve()));
}

function saveSession(req) {
  if (typeof req.session.save !== 'function') return Promise.resolve();
  return new Promise((resolve, reject) => req.session.save(error => error ? reject(error) : resolve()));
}

function destroySession(req) {
  return new Promise((resolve, reject) => req.session.destroy(error => error ? reject(error) : resolve()));
}

function createOrganizationSessionService({ membershipRepository, sessionRegistry, now = () => Date.now() }) {
  async function rotate(req, context) {
    const previousSid = req.sessionID;
    const auth = req.session.auth;
    await regenerateSession(req);
    req.session.auth = { ...auth, organizationContext: context || null };
    try {
      await saveSession(req);
      await sessionRegistry.rotateSession({
        previousSid,
        sid: req.sessionID,
        globalUserId: auth.user.id,
        revocationVersion: auth.revocationVersion,
        expiresAt: auth.absoluteExpiresAt,
        organizationContext: context
      });
    } catch (error) {
      try {
        await destroySession(req);
      } catch (cleanupError) {
        throw new AggregateError([error, cleanupError], 'Organization session persistence and compensation failed.', { cause: error });
      }
      throw error;
    }
    return context;
  }

  return {
    async organizations(globalUserId) {
      return membershipRepository.listEligible(globalUserId, now());
    },
    async select(req, organizationId) {
      const context = await membershipRepository.resolveEligible(req.user.id, organizationId, now());
      if (!context) return null;
      return rotate(req, context);
    },
    async resolve(req) {
      const result = await sessionRegistry.resolveOrganizationContext({ sid: req.sessionID, globalUserId: req.user.id, now: now() });
      req.organizationContextState = result.state;
      if (result.state === 'VALID') {
        req.organizationContext = result.context;
        return result.context;
      }
      const expressHasContext = Boolean(req.session.auth && req.session.auth.organizationContext);
      if (result.state === 'INVALID' || (result.state === 'NONE' && expressHasContext)) await rotate(req, null);
      return null;
    },
    rotate
  };
}

module.exports = { createOrganizationSessionService };
