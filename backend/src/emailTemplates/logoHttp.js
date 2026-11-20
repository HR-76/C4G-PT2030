'use strict';

const { randomUUID } = require('node:crypto');
const { LOGO_LIMITS } = require('./logoImage');

// Public error codes of the logo routes: a closed list. Anything else is SERVICE_UNAVAILABLE, with no detail.
const LOGO_STATUS = Object.freeze({
  INVALID_INPUT: 400,
  EMAIL_LOGO_INVALID: 400,
  EMAIL_LOGO_DIMENSIONS: 400,
  C4G_ADMIN_REQUIRED: 403,
  NOT_AUTHORIZED: 403,
  STALE_REVISION: 409,
  IDEMPOTENCY_CONFLICT: 409,
  EMAIL_LOGO_NOT_SET: 409,
  STATE_CONFLICT: 409,
  EMAIL_LOGO_TOO_LARGE: 413
});
const LOGO_TYPES = Object.freeze(['image/png', 'image/jpeg']);
const SERVICE_METHODS = Object.freeze(['platformLogo', 'platformLogoSet', 'platformLogoRemove',
  'organizationLogo', 'organizationLogoSet', 'organizationLogoRemove', 'publicImage']);

function requireLogoService(logos) {
  if (SERVICE_METHODS.some(method => typeof logos?.[method] !== 'function')) throw new TypeError('Email logo HTTP composition is incomplete.');
}

function refuse(response, error) {
  const known = Object.hasOwn(LOGO_STATUS, String(error?.code || ''));
  const code = known ? error.code : 'SERVICE_UNAVAILABLE';
  return response.status(known ? LOGO_STATUS[code] : 503).json({ error: { code }, correlationId: randomUUID() });
}

const invalid = code => Object.assign(new Error(code), { code });

// The revision and the idempotency key travel in headers, because the body of an upload is the image itself.
function commandHeaders(request) {
  const revision = request.get('X-Logo-Revision'), key = request.get('Idempotency-Key');
  if (typeof revision !== 'string' || !/^(0|[1-9][0-9]{0,9})$/.test(revision) || typeof key !== 'string') throw invalid('INVALID_INPUT');
  return { expectedRevision: Number(revision), idempotencyKey: key };
}

// GET, PUT and DELETE of one logo, on a router that has already authenticated the request.
// read/set/remove are the service methods of the scope (the C4G logo or the session's entity).
function mountLogoRoutes(router, path, { express, read, set, remove }) {
  if (!express?.raw || [read, set, remove].some(method => typeof method !== 'function')) throw new TypeError('Email logo HTTP composition is incomplete.');
  const parse = express.raw({ type: [...LOGO_TYPES], limit: LOGO_LIMITS.bytes });
  // A body over the limit is refused while it is read, before it reaches the service.
  const bytes = (request, response, next) => parse(request, response, error => (error
    ? refuse(response, invalid(error.type === 'entity.too.large' ? 'EMAIL_LOGO_TOO_LARGE' : 'INVALID_INPUT')) : next()));
  const handle = work => async (request, response) => {
    try {
      if (Object.keys(request.query || {}).length > 0) throw invalid('INVALID_INPUT');
      return response.status(200).json(await work(request));
    } catch (error) {
      return refuse(response, error);
    }
  };
  router.get(path, handle(request => {
    if (Number(request.get('Content-Length') || 0) > 0) throw invalid('INVALID_INPUT');
    return read(request);
  }));
  router.put(path, bytes, handle(request => {
    const input = commandHeaders(request);
    if (!Buffer.isBuffer(request.body) || request.body.length === 0) throw invalid('EMAIL_LOGO_INVALID');
    return set(request.body, input, request);
  }));
  router.delete(path, handle(request => {
    if (Number(request.get('Content-Length') || 0) > 0) throw invalid('INVALID_INPUT');
    return remove(commandHeaders(request), request);
  }));
}

// GET /api/public/email-logos/:id — the only route that serves uploaded content without a session. It is mounted
// before the session middleware, so it neither reads nor sets a cookie. It serves nothing but validated PNG and
// JPEG logos, with the stored type, and never records who asked: an email client opening a message is not tracked.
function createPublicEmailLogoRouter({ express, logos }) {
  if (!express?.Router) throw new TypeError('Email logo HTTP composition is incomplete.');
  requireLogoService(logos);
  const router = express.Router();
  router.get('/:id', async (request, response) => {
    try {
      const image = await logos.publicImage(request.params.id);
      if (!image) return response.status(404).set('Cache-Control', 'no-store').json({ error: { code: 'RESOURCE_NOT_AVAILABLE' } });
      // A version is immutable and its name is never reused, so it may be cached for good.
      response.status(200).set({
        'Content-Type': image.mime, 'Content-Length': String(image.content.length),
        'Cache-Control': 'public, max-age=31536000, immutable', 'X-Content-Type-Options': 'nosniff',
        'Content-Disposition': 'inline', 'Cross-Origin-Resource-Policy': 'cross-origin'
      });
      return response.end(image.content);
    } catch {
      return response.status(503).set('Cache-Control', 'no-store').json({ error: { code: 'SERVICE_UNAVAILABLE' } });
    }
  });
  router.use((request, response) => response.status(405).set('Cache-Control', 'no-store').json({ error: { code: 'OPERATION_NOT_AVAILABLE' } }));
  return router;
}

module.exports = { mountLogoRoutes, createPublicEmailLogoRouter, requireLogoService, LOGO_STATUS, LOGO_TYPES };
