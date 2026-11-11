function createOidcAuthRouter({ express, controller, organizationController = null, authenticate,
  resolveOrganizationContext = null, requireServerSession = null, generateCsrfToken }) {
  const router = express.Router();
  const authenticateOrStoreRecovery = (req, res, next) => req.sessionLoadFailed ? next() : authenticate(req, res, next);
  router.get("/oidc/login", controller.login);
  router.get("/oidc/callback", controller.callback);
  router.get("/step-up", authenticate, controller.stepUp);
  router.get("/step-up-policy", authenticate, controller.stepUpPolicy);
  router.get("/account-security", authenticate, controller.accountSecurity);
  router.post("/account-security/email", authenticate, controller.emailVerification);
  router.get("/account", authenticate, controller.account);
  router.get("/csrf", authenticateOrStoreRecovery, (req, res) => res.json({ csrfToken: generateCsrfToken(req) }));
  if (organizationController && resolveOrganizationContext && requireServerSession) {
    router.get("/organizations", authenticate, requireServerSession, organizationController.list);
    router.post("/organization", authenticate, requireServerSession, organizationController.select);
    router.get("/session", authenticate, resolveOrganizationContext, organizationController.session);
  } else {
    router.get("/session", authenticate, (req, res) => res.json({ user: req.user }));
  }
  // Logout must remain available when normal authentication cannot validate a
  // stale, expired or partially persisted session. Origin and CSRF protection
  // still run before this router.
  router.post("/logout", controller.logout);
  return router;
}

module.exports = { createOidcAuthRouter };
