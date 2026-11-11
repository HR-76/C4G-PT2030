const { organizationContextUnavailable } = require('../utils/publicHttpError');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function publicOrganization(context) {
  if (!context) return null;
  // Presentation only: permissions remain enforced by the authorization engine.
  const profileLabel = {
    ORG_ADMIN: 'Administrador do cliente',
    FUNDING_MANAGER: 'Gestor de candidaturas',
    CONTRIBUTOR: 'Membro da organização',
    VIEWER: 'Consulta'
  }[context.baseRoleCode];
  return { ...context.organization, ...(typeof profileLabel === 'string' ? { profileLabel, profileCode: context.baseRoleCode } : {}) };
}

function createOrganizationAuthController({ organizationSession, generateCsrfToken }) {
  return {
    async list(req, res, next) {
      try {
        const contexts = await organizationSession.organizations(req.user.id);
        return res.json({ organizations: contexts.map(publicOrganization) });
      } catch (error) { return next(organizationContextUnavailable(error)); }
    },
    async select(req, res, next) {
      const body = req.body;
      if (!body || Object.getPrototypeOf(body) !== Object.prototype
        || Object.keys(body).length !== 1 || typeof body.organizationId !== 'string' || !UUID.test(body.organizationId)) {
        return res.status(400).json({ error: { code: 'ORGANIZATION_SELECTION_INVALID', message: 'Invalid organization selection.' } });
      }
      try {
        const context = await organizationSession.select(req, body.organizationId);
        if (!context) {
          return res.status(403).json({ error: { code: 'ORGANIZATION_NOT_SELECTABLE', message: 'The organization cannot be selected.' } });
        }
        return res.json({ user: req.user, organization: publicOrganization(context), csrfToken: generateCsrfToken(req) });
      } catch (error) { return next(organizationContextUnavailable(error)); }
    },
    session(req, res) {
      const organization = publicOrganization(req.organizationContext);
      return res.json({ user: req.user, organization, organizationSelectionRequired: organization === null && !req.admissionContext?.limited,
        ...(req.admissionContext ? {admissions:req.admissionContext} : {}) });
    }
  };
}

module.exports = { createOrganizationAuthController };
