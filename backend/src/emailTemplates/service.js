'use strict';

const { createHash, randomUUID } = require('node:crypto');
const {
  TEMPLATE_TYPES, BODY_VARIABLES, SUBJECT_VARIABLES, REQUIRED_BODY_VARIABLES, fail
} = require('./contracts');
const { validateTemplate, renderTemplate, insertActivationLink } = require('./render');
const { defaultTemplate } = require('./defaultTemplates');
const { createEmailTemplateRepository } = require('./repository');
const { logoForScope } = require('./logoService');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
// The names the HTTP API uses for the template types kept in the database.
const API_TYPES = Object.freeze({ 'member-invitation': TEMPLATE_TYPES.MEMBER_INVITATION });
const EXAMPLE_ORGANIZATION = 'Entidade de exemplo';
const EXAMPLE_LINK = 'https://exemplo.invalid/ativacao-de-exemplo';
const DAY_MS = 24 * 60 * 60 * 1000;
// The image every email carries while the C4G administrator has not uploaded a logo.
const BUILT_IN_LOGO_PATH = '/logo-c4g.png';
// What the database write function raises, by name. Anything else stays internal.
const DATABASE_CODES = Object.freeze([
  'C4G_ADMIN_REQUIRED', 'INVALID_INPUT', 'RESOURCE_NOT_AVAILABLE', 'IDEMPOTENCY_CONFLICT',
  'STALE_REVISION', 'EMAIL_TEMPLATE_NOT_CUSTOMIZED'
]);

const sha256 = value => createHash('sha256').update(value).digest('hex');

function plainObject(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) fail('INVALID_INPUT');
  const present = Object.keys(value);
  if (present.length !== keys.length || present.some(key => !keys.includes(key))) fail('INVALID_INPUT');
  return value;
}

function revision(value) {
  if (!Number.isInteger(value) || value < 0 || value > 2147483646) fail('INVALID_INPUT');
  return value;
}

function requestId(value) {
  if (typeof value !== 'string' || !UUID.test(value)) fail('INVALID_INPUT');
  return value.toLowerCase();
}

function translate(error) {
  if (error?.code && !/^[0-9A-Z]{5}$/.test(String(error.code))) return error;
  const code = DATABASE_CODES.find(item => error?.message === item);
  if (code) return Object.assign(new Error(code), { code });
  if (['23505', '40001', '40P01', '55P03'].includes(error?.code)) return Object.assign(new Error('STATE_CONFLICT'), { code: 'STATE_CONFLICT' });
  if (error?.code === '23514') return Object.assign(new Error('INVALID_INPUT'), { code: 'INVALID_INPUT' });
  return error;
}

// Admin C4G API of the invitation template (increment 3 of the email plan).
// Templates are read and written only here; sending still uses the fixed text.
// publicBaseUrl is the HTTPS origin emails point at for the logo; without it the preview carries no image.
function createEmailTemplateService({
  centralPool, repository = createEmailTemplateRepository(), clock = () => new Date(), uuid = randomUUID, publicBaseUrl = null
}) {
  if (typeof centralPool?.connect !== 'function' || typeof clock !== 'function' || typeof uuid !== 'function'
      || !['isPlatformAdmin', 'organization', 'latest', 'summary', 'write', 'latestLogo'].every(name => typeof repository?.[name] === 'function')) {
    throw new TypeError('Email template service composition is invalid.');
  }
  let publicOrigin = null;
  if (publicBaseUrl !== null && publicBaseUrl !== undefined && publicBaseUrl !== '') {
    let parsed = null;
    try { parsed = new URL(publicBaseUrl); } catch { /* refused below */ }
    if (!parsed || !['https:', 'http:'].includes(parsed.protocol) || parsed.username || parsed.password) throw new TypeError('Email template public base URL is invalid.');
    // Email clients only get HTTPS images; a plain HTTP origin (local development) leaves the preview without one.
    if (parsed.protocol === 'https:') publicOrigin = parsed.origin;
  }

  function actor(request) {
    const sessionId = request?.authContext?.sessionId;
    const actorId = request?.user?.id;
    if (!sessionId || sessionId !== request.sessionID || typeof actorId !== 'string' || !UUID.test(actorId)) fail('C4G_ADMIN_REQUIRED');
    return { sessionId, actorId };
  }

  function templateType(value) {
    if (typeof value !== 'string' || !Object.hasOwn(API_TYPES, value)) fail('RESOURCE_NOT_AVAILABLE');
    return { api: value, stored: API_TYPES[value] };
  }

  function scopeId(value) {
    if (value === null || value === undefined) return null;
    if (typeof value !== 'string' || !UUID.test(value)) fail('RESOURCE_NOT_AVAILABLE');
    return value.toLowerCase();
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

  async function authorize(client, request) {
    const who = actor(request);
    if (!(await repository.isPlatformAdmin(client, who.sessionId, who.actorId))) fail('C4G_ADMIN_REQUIRED');
    return who;
  }

  async function scope(client, value) {
    const organizationId = scopeId(value);
    if (!organizationId) return { organizationId: null, name: null };
    const row = await repository.organization(client, organizationId);
    if (!row) fail('RESOURCE_NOT_AVAILABLE');
    return { organizationId, name: row.display_name };
  }

  async function view(client, type, organizationId) {
    const global = await repository.latest(client, type.stored, null);
    const own = organizationId ? await repository.latest(client, type.stored, organizationId) : null;
    const current = organizationId ? own : global;
    const stored = organizationId && own?.action === 'SAVE' ? ['ORGANIZATION', own]
      : global?.action === 'SAVE' ? ['GLOBAL', global] : null;
    const content = stored ? stored[1] : defaultTemplate(type.stored);
    return {
      type: type.api,
      source: stored ? stored[0] : 'DEFAULT',
      subject: content.subject,
      html: content.html,
      revision: current?.version || 0,
      updatedAt: stored ? new Date(stored[1].created_at).toISOString() : null,
      updatedBy: stored ? stored[1].author : null,
      variables: { body: [...BODY_VARIABLES], subject: [...SUBJECT_VARIABLES], required: [...REQUIRED_BODY_VARIABLES] },
      logo: await logoForScope(repository, client, organizationId)
    };
  }

  async function types(request) {
    return transaction('read', async client => {
      await authorize(client, request);
      const items = [];
      for (const [api, stored] of Object.entries(API_TYPES)) {
        const row = await repository.summary(client, stored);
        items.push({ type: api, globalCustomized: row?.global_customized === true, organizations: Number(row?.organizations || 0) });
      }
      return { items };
    });
  }

  async function template(typeValue, scopeValue, request) {
    const type = templateType(typeValue);
    return transaction('read', async client => {
      await authorize(client, request);
      const { organizationId } = await scope(client, scopeValue);
      return view(client, type, organizationId);
    });
  }

  async function write(action, typeValue, scopeValue, body, request) {
    const type = templateType(typeValue);
    return transaction('write', async client => {
      // Authorization comes first, so someone who is not an administrator learns nothing from the validation.
      const who = await authorize(client, request);
      const input = plainObject(body, action === 'SAVE'
        ? ['subject', 'html', 'expectedRevision', 'idempotencyKey'] : ['expectedRevision', 'idempotencyKey']);
      const expectedRevision = revision(input.expectedRevision);
      const idempotencyKey = requestId(input.idempotencyKey);
      // Validation and sanitization happen before the write function is called: an invalid template is never stored.
      const checked = action === 'SAVE' ? validateTemplate({ subject: input.subject, html: input.html }) : null;
      await repository.write(client, {
        sessionId: who.sessionId, actorId: who.actorId, type: type.stored, organizationId: scopeId(scopeValue),
        id: uuid(), action,
        subject: checked?.subject ?? null, html: checked?.html ?? null,
        contentSha256: checked ? sha256(`${checked.subject}\n${checked.html}`) : null,
        requestId: idempotencyKey, expectedRevision
      });
      const result = await view(client, type, scopeId(scopeValue));
      return checked ? { ...result, removed: [...checked.removed] } : result;
    });
  }

  async function preview(typeValue, scopeValue, body, request) {
    const type = templateType(typeValue);
    return transaction('read', async client => {
      await authorize(client, request);
      const { organizationId, name } = await scope(client, scopeValue);
      const input = plainObject(body, ['subject', 'html']);
      const checked = validateTemplate({ subject: input.subject, html: input.html });
      const logo = publicOrigin ? await logoForScope(repository, client, organizationId) : null;
      const rendered = insertActivationLink(renderTemplate({ subject: checked.subject, html: checked.html }, {
        organizationName: name || EXAMPLE_ORGANIZATION, expiresAt: new Date(clock().getTime() + DAY_MS),
        logoUrl: logo ? publicOrigin + (logo.url || BUILT_IN_LOGO_PATH) : null,
        logoAlt: logo?.source === 'ORGANIZATION' ? name : 'C4G'
      }), EXAMPLE_LINK);
      return { type: type.api, subject: rendered.subject, html: rendered.html, text: rendered.text, removed: [...checked.removed] };
    });
  }

  // Sending, including the test message, arrives with increment 4.
  async function test(typeValue, scopeValue, body, request) {
    templateType(typeValue);
    await transaction('read', async client => {
      await authorize(client, request);
      await scope(client, scopeValue);
    });
    return fail('EMAIL_DELIVERY_UNAVAILABLE');
  }

  return Object.freeze({
    types, template, preview, test,
    save: (type, scopeValue, body, request) => write('SAVE', type, scopeValue, body, request),
    reset: (type, scopeValue, body, request) => write('RESET', type, scopeValue, body, request)
  });
}

module.exports = { createEmailTemplateService, API_TYPES };
