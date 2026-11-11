'use strict';
const STATUS = Object.freeze({ F13_AUTHORIZATION_REQUIRED: 403, F13_RESOURCE_NOT_AVAILABLE: 404,
  F13_INVALID_INPUT: 400, F13_UNKNOWN_FIELD: 400, F13_STALE_REVISION: 409, F13_STATE_CONFLICT: 409,
  F13_DIGEST_MISMATCH: 409, F13_IDEMPOTENCY_CONFLICT: 409, F13_COMPLETION_INCOMPLETE: 409,
  F13_APPROVAL_STALE: 409, F13_REFERENCE_INCOMPATIBLE: 409 });
const UNAVAILABLE = new Set(['F13_POLICY_UNAVAILABLE','F13_SOURCE_INTEGRITY_UNAVAILABLE',
  'F13_AUTHORSHIP_EVIDENCE_UNAVAILABLE','F13_PERSISTENCE_UNAVAILABLE']);
function createEditorialProfileRouter({ express, service, authenticate, organizationMiddleware }) {
  const router = express.Router();
  router.use(authenticate, organizationMiddleware.requireServerSession,
    organizationMiddleware.resolveOrganizationContext, organizationMiddleware.requireOrganizationContext);
  for (const [verb, path, method, idKey, status] of [
    ['post','/drafts/:id/submit','submit','draftId',201],
    ['post','/candidates/:id/approve','approve','candidateId',201],
    ['post','/versions/:id/publish','publish','versionId',200],
    ['get','/candidates/:id','readCandidate','candidateId',200],
    ['get','/versions/:id','readVersion','versionId',200]
  ]) router[verb](path, async (req, res) => {
    try {
      if (Object.keys(req.query).length || (verb === 'get' && req.body && Object.keys(req.body).length)
        || (verb === 'post' && (!req.body || Array.isArray(req.body) || typeof req.body !== 'object'))
        || (req.body && Object.hasOwn(req.body, idKey))) return res.status(400).json({ error: { code: 'F13_INVALID_INPUT' } });
      res.status(status).json(await service[method]({ ...(verb === 'post' ? req.body : {}), [idKey]: req.params.id }, req));
    } catch (error) {
      const code = Object.hasOwn(STATUS, error.code) || UNAVAILABLE.has(error.code) ? error.code : 'F13_PERSISTENCE_UNAVAILABLE';
      res.status(STATUS[code] || 503).json({ error: { code } });
    }
  });
  return router;
}
module.exports = { createEditorialProfileRouter };
