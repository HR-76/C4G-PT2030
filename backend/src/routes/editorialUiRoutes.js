'use strict';
const { randomUUID } = require('node:crypto');
const { validate } = require('../organizationalProfile/editorialUiContracts');
const errors = { INVALID_INPUT: 400, INVALID_CURSOR: 400, SESSION_REQUIRED: 401, NOT_AUTHORIZED: 403, RESOURCE_NOT_AVAILABLE: 404,
  STALE_REVISION: 409, STATE_CONFLICT: 409, IDEMPOTENCY_CONFLICT: 409, COMPLETION_INCOMPLETE: 409, APPROVAL_STALE: 409,
  REFERENCE_INCOMPATIBLE: 409, CONCURRENCY_TOKEN_INVALID: 409, CONCURRENCY_TOKEN_EXPIRED: 409, REFERENCE_UNAVAILABLE: 503 };
function createEditorialUiRouter({ express, service, authenticate, organizationMiddleware }) {
  const router = express.Router();
  router.use((req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
  router.use(authenticate, organizationMiddleware.requireServerSession, organizationMiddleware.resolveOrganizationContext, organizationMiddleware.requireOrganizationContext);
  const entries = [['get', '/context', 'context'], ['get', '/catalog', 'catalog'], ['post', '/drafts', 'create'],
    ['put', '/drafts/:id', 'edit'], ['post', '/drafts/:id/submit', 'submit'], ['post', '/candidates/:id/approve', 'approve'],
    ['post', '/versions/:id/publish', 'publish'], ['post', '/intentions/lookup', 'lookup'],
    ...['drafts', 'candidates', 'versions'].flatMap(name => [['get', '/' + name, name], ['get', '/' + name + '/:id', name.slice(0, -1)]])];
  for (const [verb, path, method] of entries) router[verb](path, async (req, res) => {
    const correlationId = randomUUID();
    try {
      if (!service) return res.status(503).json({ error: { code: 'SERVICE_UNAVAILABLE' }, correlationId });
      if ((verb !== 'get' && Object.keys(req.query).length) || (verb === 'get' && req.body && Object.keys(req.body).length)) throw Object.assign(new Error(), { code: 'INVALID_INPUT' });
      const input = validate(method, verb === 'get' ? { ...req.query } : req.body, req.params.id);
      const result = await service.execute(method, input, req.params.id, req, correlationId);
      res.status(['create', 'submit', 'approve'].includes(method) ? 201 : 200).json(result);
    } catch (error) {
      let code = String(error.code || '').replace(/^F13_/, '');
      if (code === 'AUTHORIZATION_REQUIRED' || code === 'AUTHORITY_REQUIRED' || code === 'AUTHORITY_DENIED') code = 'NOT_AUTHORIZED';
      if (!Object.hasOwn(errors, code)) code = 'SERVICE_UNAVAILABLE';
      res.status(errors[code] || 503).json({ error: { code }, correlationId });
    }
  });
  return router;
}
module.exports = { createEditorialUiRouter };
