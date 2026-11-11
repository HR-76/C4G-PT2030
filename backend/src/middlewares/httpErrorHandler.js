'use strict';

const { PublicHttpError } = require('../utils/publicHttpError');
const { currentContext } = require('../observability/context');
const errorCorrelation = () => currentContext()?.correlationId || require('node:crypto').randomUUID();

function createErrorHandler({ reportError = () => {} } = {}) {
  return (err, req, res, next) => {
    const requestPath = String(req.originalUrl || '').split('?', 1)[0];
    if (res.headersSent) {
      try {
        reportError(err, { method: req.method, path: requestPath, responseStarted: true });
      } catch { /* Reporting must not replace the connection-level error handling. */ }
      return next(err);
    }
    if (err.code === 'CSRF_INVALID' && (err.statusCode === 403 || err.status === 403)) {
      return res.status(403).set('Cache-Control','no-store').json({error:{code:'CSRF_INVALID'}});
    }
    if (/^\/api\/(?:imports|admin\/(?:directory|billing|opportunity-activation)|admissions|organization-directory\/access\/users)(?:\/|$)/.test(requestPath)) {
      const correlation = requestPath.startsWith('/api/admin/billing')
        ? { correlationId: errorCorrelation() } : {};
      const invalid = err.type === 'entity.parse.failed' || err.type === 'entity.too.large';
      if (!invalid) {
        try { reportError({ code: 'SERVICE_UNAVAILABLE' }, { method: req.method, path: requestPath, ...correlation }); }
        catch { /* Observation must not change the public response. */ }
      }
      res.setHeader('Cache-Control', 'no-store');
      return res.status(invalid ? (err.type === 'entity.too.large' ? 413 : 400) : 503).json({
        error: { code: invalid ? 'INVALID_INPUT' : 'SERVICE_UNAVAILABLE' }, ...correlation
      });
    }
    if (/^\/api\/organizational-profile\/pq1-(?:publication|activation)(?:\/|$)/.test(requestPath) || requestPath.startsWith('/api/organization-profile/editorial-ui') || /^\/api\/opportunities\/(?:prequalifications(?:\/|$)|[^/]+\/(?:criteria|prequalifications)(?:\/|$))/.test(requestPath)) {
      const invalid = err.type === 'entity.parse.failed' || err.type === 'entity.too.large';
      const correlationId = errorCorrelation();
      if (!invalid) {
        try { reportError({ code: 'SERVICE_UNAVAILABLE' }, { method: req.method, path: requestPath, correlationId }); }
        catch { /* Observation must not change the public response. */ }
      }
      return res.status(invalid ? (err.type === 'entity.too.large' ? 413 : 400) : 503).json({
        error: { code: invalid ? 'INVALID_INPUT' : 'SERVICE_UNAVAILABLE' }, correlationId
      });
    }
    try {
      reportError(err, { method: req.method, path: requestPath });
    } catch { /* Reporting must not replace or duplicate the HTTP error response. */ }
    if (req.method === "POST" && requestPath === "/api/auth/organization"
      && err instanceof SyntaxError && err.status === 400 && Object.prototype.hasOwnProperty.call(err, "body")) {
      return res.status(400).json({ error: { code: "ORGANIZATION_SELECTION_INVALID", message: "Invalid organization selection." } });
    }
    if (err instanceof PublicHttpError) {
      return res.status(err.statusCode).json({ error: { code: err.code, message: err.publicMessage } });
    }
    const status = Number.isInteger(err.status) && err.status >= 400 && err.status <= 599 ? err.status : 500;
    res.setHeader('Cache-Control', 'no-store');
    return res.status(status).json({ message: 'Erro interno do servidor.' });
  };
}

module.exports = { createErrorHandler };
