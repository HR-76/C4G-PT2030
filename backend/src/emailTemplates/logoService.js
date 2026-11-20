'use strict';

const { randomBytes, randomUUID } = require('node:crypto');
const { fail } = require('./contracts');
const { inspectLogo } = require('./logoImage');
const { createEmailTemplateRepository } = require('./repository');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PUBLIC_ID = /^[a-f0-9]{32}$/;
const PUBLIC_LOGO_PATH = '/api/public/email-logos/';
// What the database write function raises, by name. Anything else stays internal.
const DATABASE_CODES = Object.freeze([
  'C4G_ADMIN_REQUIRED', 'NOT_AUTHORIZED', 'INVALID_INPUT', 'IDEMPOTENCY_CONFLICT', 'STALE_REVISION', 'EMAIL_LOGO_NOT_SET'
]);

function translate(error) {
  if (error?.code && !/^[0-9A-Z]{5}$/.test(String(error.code))) return error;
  const code = DATABASE_CODES.find(item => error?.message === item);
  if (code) return Object.assign(new Error(code), { code });
  if (['23505', '40001', '40P01', '55P03'].includes(error?.code)) return Object.assign(new Error('STATE_CONFLICT'), { code: 'STATE_CONFLICT' });
  if (error?.code === '23514') return Object.assign(new Error('INVALID_INPUT'), { code: 'INVALID_INPUT' });
  return error;
}

// Where a stored logo is served from. Relative, so the application shows it from its own origin.
const logoPath = row => (row?.action === 'SET' && PUBLIC_ID.test(row.public_id || '') ? PUBLIC_LOGO_PATH + row.public_id : null);

// The logo an email of one scope carries: the organization's own while it has one, otherwise the C4G logo
// (url null while the C4G administrator has not uploaded one: the built-in image applies).
async function logoForScope(repository, client, organizationId) {
  if (organizationId) {
    const own = logoPath(await repository.latestLogo(client, organizationId));
    if (own) return { source: 'ORGANIZATION', url: own };
  }
  return { source: 'C4G', url: logoPath(await repository.latestLogo(client, null)) };
}

// Logos of the emails (increment 5 of the email plan): the C4G logo, edited by the C4G administrator; each
// entity's logo, edited only by that entity's own administrator; and the public read by unguessable name.
function createEmailLogoService({
  centralPool, repository = createEmailTemplateRepository(), uuid = randomUUID,
  publicId = () => randomBytes(16).toString('hex')
}) {
  if (typeof centralPool?.connect !== 'function' || typeof uuid !== 'function' || typeof publicId !== 'function'
      || !['isPlatformAdmin', 'isOrganizationAdmin', 'latestLogo', 'writeLogo', 'publicLogo'].every(name => typeof repository?.[name] === 'function')) {
    throw new TypeError('Email logo service composition is invalid.');
  }

  async function transaction(mode, work) {
    const client = await centralPool.connect();
    try {
      await client.query(mode === 'read' ? 'BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY' : 'BEGIN');
      const result = await work(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      try { await client.query('ROLLBACK'); } catch { /* the original failure is the one reported */ }
      throw translate(error);
    } finally {
      client.release();
    }
  }

  // scope 'platform': the C4G logo and a C4G administrator. scope 'organization': the entity the session selected
  // and that entity's administrator. The entity is never taken from the request's parameters or body.
  async function authorize(client, scope, request) {
    const sessionId = request?.authContext?.sessionId, actorId = request?.user?.id;
    const denied = scope === 'platform' ? 'C4G_ADMIN_REQUIRED' : 'NOT_AUTHORIZED';
    if (!sessionId || sessionId !== request.sessionID || typeof actorId !== 'string' || !UUID.test(actorId)) fail(denied);
    if (scope === 'platform') {
      if (!(await repository.isPlatformAdmin(client, sessionId, actorId))) fail(denied);
      return { sessionId, actorId, organizationId: null };
    }
    const organizationId = request.organizationContext?.organizationId;
    if (typeof organizationId !== 'string' || !UUID.test(organizationId)) fail(denied);
    if (!(await repository.isOrganizationAdmin(client, sessionId, actorId, organizationId))) fail(denied);
    return { sessionId, actorId, organizationId: organizationId.toLowerCase() };
  }

  function view(row) {
    const url = logoPath(row);
    return { url, revision: row?.version || 0, updatedAt: url ? new Date(row.created_at).toISOString() : null };
  }

  function command(input) {
    const expectedRevision = input?.expectedRevision, idempotencyKey = input?.idempotencyKey;
    if (!Number.isInteger(expectedRevision) || expectedRevision < 0 || expectedRevision > 2147483646) fail('INVALID_INPUT');
    if (typeof idempotencyKey !== 'string' || !UUID.test(idempotencyKey)) fail('INVALID_INPUT');
    return { expectedRevision, requestId: idempotencyKey.toLowerCase() };
  }

  async function read(scope, request) {
    return transaction('read', async client => {
      const who = await authorize(client, scope, request);
      return view(await repository.latestLogo(client, who.organizationId));
    });
  }

  async function write(scope, bytes, input, request) {
    return transaction('write', async client => {
      // Authorization comes first, so someone who may not change the logo learns nothing from the validation.
      const who = await authorize(client, scope, request);
      const { expectedRevision, requestId } = command(input);
      // The type and the dimensions come from the bytes, never from the declared content type or a file name.
      const image = bytes === null ? null : inspectLogo(bytes);
      await repository.writeLogo(client, {
        sessionId: who.sessionId, actorId: who.actorId, organizationId: who.organizationId, id: uuid(),
        publicId: image ? publicId() : null, mime: image?.mime ?? null, width: image?.width ?? null, height: image?.height ?? null,
        content: bytes, requestId, expectedRevision
      });
      return view(await repository.latestLogo(client, who.organizationId));
    });
  }

  // No session: the name is the only credential, and it only ever reaches a validated PNG or JPEG.
  async function publicImage(id) {
    if (typeof id !== 'string' || !PUBLIC_ID.test(id)) return null;
    const client = await centralPool.connect();
    try {
      const row = await repository.publicLogo(client, id);
      if (!row || !['image/png', 'image/jpeg'].includes(row.mime_type) || !Buffer.isBuffer(row.content)) return null;
      return { mime: row.mime_type, content: row.content };
    } finally {
      client.release();
    }
  }

  return Object.freeze({
    platformLogo: request => read('platform', request),
    platformLogoSet: (bytes, input, request) => write('platform', bytes, input, request),
    platformLogoRemove: (input, request) => write('platform', null, input, request),
    organizationLogo: request => read('organization', request),
    organizationLogoSet: (bytes, input, request) => write('organization', bytes, input, request),
    organizationLogoRemove: (input, request) => write('organization', null, input, request),
    publicImage
  });
}

module.exports = { createEmailLogoService, logoForScope, logoPath, PUBLIC_LOGO_PATH };
