const { organizationContextUnavailable } = require('../utils/publicHttpError');

function createOrganizationContextMiddleware({ organizationSession }) {
  const resolveOrganizationContext = async (req, res, next) => {
    try {
      await organizationSession.resolve(req);
      return next();
    } catch (error) {
      return next(organizationContextUnavailable(error));
    }
  };
  const requireServerSession = (req, res, next) => {
    if (req.session && req.session.auth) return next();
    return res.status(401).json({ code: 'SESSION_REQUIRED', message: 'Sessão válida necessária.' });
  };
  const requireOrganizationContext = (req, res, next) => {
    if (req.organizationContext) return next();
    return res.status(409).json({
      error: { code: 'ORGANIZATION_SELECTION_REQUIRED', message: 'An organization must be selected.' }
    });
  };
  return { resolveOrganizationContext, requireOrganizationContext, requireServerSession };
}

module.exports = { createOrganizationContextMiddleware };
