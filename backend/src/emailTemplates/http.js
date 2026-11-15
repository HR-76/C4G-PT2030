'use strict';

const { randomUUID } = require('node:crypto');

// Public error codes of the email template API: a closed list. Anything else is
// reported as SERVICE_UNAVAILABLE, with no internal detail.
const STATUS = Object.freeze({
  INVALID_INPUT: 400,
  EMAIL_TEMPLATE_INVALID: 400,
  C4G_ADMIN_REQUIRED: 403,
  RESOURCE_NOT_AVAILABLE: 404,
  STALE_REVISION: 409,
  IDEMPOTENCY_CONFLICT: 409,
  EMAIL_TEMPLATE_NOT_CUSTOMIZED: 409,
  STATE_CONFLICT: 409,
  EMAIL_DELIVERY_UNAVAILABLE: 503,
  EMAIL_PUBLISH_UNAVAILABLE: 503,
  EMAIL_PUBLICATION_DRIFT: 409
});

// Why a template was refused. Only these codes, and only a variable name, ever leave the server.
const REASON_CODES = Object.freeze([
  'SUBJECT_REQUIRED', 'SUBJECT_TOO_LONG', 'SUBJECT_LINE_BREAK', 'BODY_REQUIRED', 'BODY_TOO_LONG', 'RESERVED_TEXT',
  'UNKNOWN_VARIABLE', 'VARIABLE_NOT_ALLOWED_IN_SUBJECT', 'REQUIRED_VARIABLE_MISSING'
]);
const VARIABLE_NAME = /^[A-Za-z][A-Za-z0-9]{0,63}$/;

function publicReasons(error) {
  if (!Array.isArray(error?.reasons)) return [];
  return error.reasons
    .filter(reason => REASON_CODES.includes(reason?.code))
    .slice(0, 50)
    .map(reason => (typeof reason.variable === 'string' && VARIABLE_NAME.test(reason.variable)
      ? { code: reason.code, variable: reason.variable } : { code: reason.code }));
}

function publicError(error) {
  const code = String(error?.code || '');
  if (!Object.hasOwn(STATUS, code)) return Object.freeze({ status: 503, body: { code: 'SERVICE_UNAVAILABLE' } });
  return Object.freeze({
    status: STATUS[code],
    body: code === 'EMAIL_TEMPLATE_INVALID' ? { code, reasons: publicReasons(error) } : { code }
  });
}

function hasBody(request) {
  if (request.body === undefined) return false;
  return !request.body || Array.isArray(request.body)
    || Object.getPrototypeOf(request.body) !== Object.prototype
    || Object.keys(request.body).length > 0;
}

// Admin C4G routes, mounted at /api/admin/email. The session, origin and CSRF checks are the application's;
// who is an administrator is confirmed by the service on every request.
// logos is optional: without it the /logo routes answer OPERATION_NOT_AVAILABLE like any unknown path.
function createPlatformEmailRouter({ express, service, authenticate, logos = null }) {
  const methods = ['types', 'template', 'save', 'reset', 'preview', 'test'];
  if (!express?.Router || typeof authenticate !== 'function'
      || methods.some(method => typeof service?.[method] !== 'function')) {
    throw new TypeError('Platform email HTTP composition is incomplete.');
  }
  if (logos) require('./logoHttp').requireLogoService(logos);
  const router = express.Router();
  router.use((request, response, next) => {
    response.set({ 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' });
    return next();
  }, authenticate, (request, response, next) => {
    if (request.method === 'HEAD') {
      return response.status(405).json({ error: { code: 'OPERATION_NOT_AVAILABLE' }, correlationId: randomUUID() });
    }
    return next();
  });

  const handle = (mode, work) => async (request, response) => {
    const correlationId = randomUUID();
    try {
      if (Object.keys(request.query || {}).length > 0 || (mode === 'read' && hasBody(request))) {
        throw Object.assign(new Error('Platform email request refused.'), { code: 'INVALID_INPUT' });
      }
      return response.status(200).json(await work(request));
    } catch (error) {
      const failure = publicError(error);
      return response.status(failure.status).json({ error: failure.body, correlationId });
    }
  };

  // The same operations for the global template and for one organization's own template.
  const mount = (prefix, scope) => {
    router.get(`${prefix}/:type`, handle('read', request => service.template(request.params.type, scope(request), request)));
    router.put(`${prefix}/:type`, handle('command', request => service.save(request.params.type, scope(request), request.body, request)));
    router.post(`${prefix}/:type/reset`, handle('command', request => service.reset(request.params.type, scope(request), request.body, request)));
    router.post(`${prefix}/:type/preview`, handle('command', request => service.preview(request.params.type, scope(request), request.body, request)));
    router.post(`${prefix}/:type/test`, handle('command', request => service.test(request.params.type, scope(request), request.body, request)));
  };
  router.get('/templates', handle('read', request => service.types(request)));
  mount('/templates', () => null);
  mount('/organizations/:organizationId/templates', request => request.params.organizationId);
  // The C4G logo. An entity's logo is changed only by that entity, in /api/organization-directory/email-logo.
  if (logos) require('./logoHttp').mountLogoRoutes(router, '/logo', { express, read: logos.platformLogo, set: logos.platformLogoSet, remove: logos.platformLogoRemove });

  router.use((request, response) => response.status(405).json({
    error: { code: 'OPERATION_NOT_AVAILABLE' }, correlationId: randomUUID()
  }));
  return router;
}

module.exports = { STATUS, REASON_CODES, createPlatformEmailRouter, publicError };
