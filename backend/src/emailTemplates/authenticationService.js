'use strict';

const { fail, escapeHtml } = require('./contracts');
const { validateTemplate } = require('./render');
const { htmlToText } = require('./text');
const { compilePasswordReset, DEFAULT_PASSWORD_RESET } = require('./keycloakPasswordReset');
const { createEmailTemplateRepository } = require('./repository');
const { logoForScope } = require('./logoService');

const TYPE = 'password-reset';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const METHODS = ['types', 'template', 'save', 'reset', 'preview', 'test'];
const PROVIDER_ERRORS = ['STALE_REVISION', 'IDEMPOTENCY_CONFLICT', 'EMAIL_PUBLICATION_DRIFT', 'INVALID_INPUT'];
const VARIABLES = Object.freeze({ body: ['LigacaoRecuperacao', 'Validade', 'Logotipo'], subject: [], required: ['LigacaoRecuperacao', 'Validade'] });
const EXAMPLE_LINK = 'https://exemplo.invalid/recuperacao-de-exemplo';

function exact(input, keys) {
  if (!input || Object.getPrototypeOf(input) !== Object.prototype || Object.keys(input).length !== keys.length
      || Object.keys(input).some(key => !keys.includes(key))) fail('INVALID_INPUT');
}

// Decorates invitation operations; authentication versions live atomically with
// the published localization in Keycloak, never in Central's invitation table.
function createAuthenticationEmailService({ baseService, centralPool, publisher = null,
  repository = createEmailTemplateRepository(), publicBaseUrl = null }) {
  if (METHODS.some(method => typeof baseService?.[method] !== 'function') || typeof centralPool?.connect !== 'function'
      || typeof repository?.isPlatformAdmin !== 'function' || typeof repository?.latestLogo !== 'function'
      || (publisher && ['read', 'publish'].some(method => typeof publisher[method] !== 'function'))) {
    throw new TypeError('Authentication email composition is incomplete.');
  }
  let origin = null;
  if (publicBaseUrl) {
    let parsed;
    try { parsed = new URL(publicBaseUrl); } catch { throw new TypeError('Email public origin is invalid.'); }
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) throw new TypeError('Email public origin is invalid.');
    if (parsed.protocol === 'https:') origin = parsed.origin;
  }

  async function authorized(request, authorId = null) {
    const actorId = request?.user?.id, sessionId = request?.authContext?.sessionId;
    if (!UUID.test(actorId || '') || !sessionId || request.sessionID !== sessionId) fail('C4G_ADMIN_REQUIRED');
    const client = await centralPool.connect();
    try {
      await client.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
      if (!(await repository.isPlatformAdmin(client, sessionId, actorId))) fail('C4G_ADMIN_REQUIRED');
      const logo = await logoForScope(repository, client, null);
      const updatedBy = authorId && repository.recipient ? await repository.recipient(client, authorId) : null;
      await client.query('COMMIT');
      return { actorId: actorId.toLowerCase(), logo, updatedBy, logoUrl: origin ? origin + (logo.url || '/logo-c4g.png') : null };
    } catch (error) {
      try { await client.query('ROLLBACK'); } catch { /* Original failure wins. */ }
      throw error;
    } finally {
      client.release();
    }
  }

  function globalOnly(scope) {
    if (scope !== null && scope !== undefined) fail('RESOURCE_NOT_AVAILABLE');
    if (!publisher) fail('EMAIL_PUBLISH_UNAVAILABLE');
  }

  async function remote(method, payload) {
    try { return await publisher[method](payload); } catch (error) {
      fail(PROVIDER_ERRORS.includes(error?.code) ? error.code : 'EMAIL_PUBLISH_UNAVAILABLE');
    }
  }

  function checkedState(state) {
    if (!state || !Number.isInteger(state.revision) || state.revision < 0) fail('EMAIL_PUBLISH_UNAVAILABLE');
    if (state.configured === false && state.revision === 0) return state;
    if (state.configured !== true || state.revision < 1 || !['SAVE', 'RESET'].includes(state.action)
        || !UUID.test(state.actorId || '') || !Number.isFinite(Date.parse(state.updatedAt))) fail('EMAIL_PUBLISH_UNAVAILABLE');
    try {
      const template = validateTemplate(state.template, TYPE);
      if (template.removed.length || template.subject !== state.template.subject || template.html !== state.template.html) fail('EMAIL_PUBLICATION_DRIFT');
      const expected = compilePasswordReset(template, { logoUrl: state.logoUrl }).messages;
      if (Object.keys(expected).some(key => state.messages?.[key] !== expected[key])) fail('EMAIL_PUBLICATION_DRIFT');
      return state;
    } catch { fail('EMAIL_PUBLICATION_DRIFT'); }
  }

  function view(state, context) {
    const template = state.configured ? state.template : DEFAULT_PASSWORD_RESET;
    return {
      type: TYPE, source: state.configured && state.action === 'SAVE' ? 'GLOBAL' : 'DEFAULT',
      subject: template.subject, html: template.html, revision: state.revision,
      updatedAt: state.configured ? state.updatedAt : null, updatedBy: context.updatedBy,
      variables: VARIABLES, logo: context.logo, capabilities: { test: false },
      publication: state.configured ? 'PUBLISHED' : 'UNPUBLISHED'
    };
  }

  async function types(request) {
    const result = await baseService.types(request);
    // Independent authorization also covers injected/base implementations.
    await authorized(request);
    let state = null;
    if (publisher) {
      try { state = checkedState(await remote('read')); } catch { /* Capability remains unavailable. */ }
    }
    await authorized(request);
    return { items: [...result.items, { type: TYPE, configurable: Boolean(state),
      globalCustomized: state?.configured === true && state.action === 'SAVE', organizations: 0 }] };
  }

  async function template(scope, request) {
    await authorized(request);
    globalOnly(scope);
    const state = checkedState(await remote('read'));
    return view(state, await authorized(request, state.actorId));
  }

  async function write(action, scope, body, request) {
    let context = await authorized(request);
    globalOnly(scope);
    exact(body, action === 'SAVE' ? ['subject', 'html', 'expectedRevision', 'idempotencyKey'] : ['expectedRevision', 'idempotencyKey']);
    if (!Number.isInteger(body.expectedRevision) || body.expectedRevision < 0 || body.expectedRevision > 2147483645
        || !UUID.test(body.idempotencyKey || '')) fail('INVALID_INPUT');
    const checked = validateTemplate(action === 'SAVE' ? body : DEFAULT_PASSWORD_RESET, TYPE);
    // Recheck current authority immediately before the external mutation, and
    // obtain the current C4G logo. The payload is fixed for this one attempt.
    context = await authorized(request);
    const prepared = { subject: checked.subject, html: checked.html };
    const payload = { action, expectedRevision: body.expectedRevision, idempotencyKey: body.idempotencyKey.toLowerCase(),
      actorId: context.actorId, template: prepared,
      messages: compilePasswordReset(prepared, { logoUrl: context.logoUrl }).messages, logoUrl: context.logoUrl };
    const state = checkedState(await remote('publish', payload));
    if (!state.configured || state.revision !== body.expectedRevision + 1 || state.action !== action
        || state.actorId !== context.actorId || state.logoUrl !== payload.logoUrl
        || state.template.subject !== prepared.subject || state.template.html !== prepared.html) fail('EMAIL_PUBLISH_UNAVAILABLE');
    return { ...view(state, await authorized(request, state.actorId)), removed: [...checked.removed] };
  }

  async function preview(scope, body, request) {
    const context = await authorized(request);
    globalOnly(scope);
    exact(body, ['subject', 'html']);
    const checked = validateTemplate(body, TYPE);
    const values = { LigacaoRecuperacao: EXAMPLE_LINK, Validade: '15 minutos (exemplo)', Logotipo: '' };
    const replace = (value, replacements) => value.replace(/\{(LigacaoRecuperacao|Validade|Logotipo)\}/g, (_, key) => replacements[key]);
    const text = replace(htmlToText(checked.html), values).trim();
    const htmlValues = Object.fromEntries(Object.entries(values).map(([key, value]) => [key, escapeHtml(value)]));
    htmlValues.Logotipo = context.logoUrl ? `<img src="${escapeHtml(context.logoUrl)}" alt="C4G" style="max-width:240px;height:auto;border:0">` : '';
    return { type: TYPE, subject: checked.subject,
      html: `<!doctype html><html lang="pt"><body>${replace(checked.html, htmlValues)}</body></html>`, text, removed: [...checked.removed] };
  }

  return Object.freeze({
    types,
    template: (type, scope, request) => type === TYPE ? template(scope, request) : baseService.template(type, scope, request),
    save: (type, scope, body, request) => type === TYPE ? write('SAVE', scope, body, request) : baseService.save(type, scope, body, request),
    reset: (type, scope, body, request) => type === TYPE ? write('RESET', scope, body, request) : baseService.reset(type, scope, body, request),
    preview: (type, scope, body, request) => type === TYPE ? preview(scope, body, request) : baseService.preview(type, scope, body, request),
    test: async (type, scope, body, request) => {
      if (type !== TYPE) return baseService.test(type, scope, body, request);
      await authorized(request);
      globalOnly(scope);
      fail('EMAIL_DELIVERY_UNAVAILABLE');
    }
  });
}

module.exports = { createAuthenticationEmailService };
