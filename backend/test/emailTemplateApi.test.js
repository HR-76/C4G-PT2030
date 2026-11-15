'use strict';

// Increment 3 of context/features/email-templates-and-configuration-plan.md: the Admin C4G service and routes of the
// invitation template. The database boundary (Central 051) has its own gate in test/integration/email-templates.
const test = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const express = require('express');
const { createEmailTemplateService } = require('../src/emailTemplates/service');
const { createPlatformEmailRouter, publicError, STATUS } = require('../src/emailTemplates/http');
const sql = require('../src/emailTemplates/sql');

const ADMIN = '11111111-1111-4111-8111-111111111111';
const MEMBER = '22222222-2222-4222-8222-222222222222';
const ORG_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ORG_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const KEY = n => `0000000${n}-0000-4000-8000-000000000000`;
const VALID = '<p>{Logotipo}</p><p>Olá {Organizacao}</p><p><a href="{LigacaoAtivacao}">Ativar</a></p><p>Expira em {Validade}.</p>';
const sha = value => createHash('sha256').update(value).digest('hex');
const request = (actorId = ADMIN, sessionId = 'session-' + actorId) => ({ sessionID: sessionId, authContext: { sessionId }, user: { id: actorId } });

// An in-memory stand-in for the 051 tables and write function, with the same rules the gate proves in PostgreSQL.
function fixture({ organizations = { [ORG_A]: 'Entidade <A>', [ORG_B]: 'Entidade B' } } = {}) {
  const versions = [], statements = [], writes = [];
  let released = 0, failNext = null;
  const scopeRows = (type, org) => versions.filter(row => row.type === type && row.organizationId === org);
  const repository = {
    async isPlatformAdmin(client, sessionId, actorId) { return actorId === ADMIN && sessionId === 'session-' + ADMIN; },
    async organization(client, id) { return Object.hasOwn(organizations, id) ? { id, display_name: organizations[id] } : null; },
    async latest(client, type, org) {
      const row = scopeRows(type, org).at(-1);
      return row ? { version: row.version, action: row.action, subject: row.subject, html: row.html, created_at: row.createdAt, author: 'admin@example.invalid' } : null;
    },
    async summary(client, type) {
      const orgs = new Set(versions.filter(row => row.type === type && row.organizationId).map(row => row.organizationId));
      return { global_customized: scopeRows(type, null).at(-1)?.action === 'SAVE', organizations: [...orgs].filter(org => scopeRows(type, org).at(-1).action === 'SAVE').length };
    },
    // No logo has been uploaded in these tests; the logos have their own in emailLogoApi.test.js.
    async latestLogo() { return null; },
    async write(client, input) {
      writes.push(input);
      if (failNext) { const error = failNext; failNext = null; throw error; }
      const raise = message => { throw Object.assign(new Error(message), { code: 'P0001' }); };
      if (input.actorId !== ADMIN) raise('C4G_ADMIN_REQUIRED');
      if (input.organizationId && !Object.hasOwn(organizations, input.organizationId)) raise('RESOURCE_NOT_AVAILABLE');
      const rows = scopeRows(input.type, input.organizationId), current = rows.at(-1);
      const prior = versions.find(row => row.requestId === input.requestId);
      if (prior) { if (prior.contentSha256 !== input.contentSha256 || prior.version !== input.expectedRevision + 1) raise('IDEMPOTENCY_CONFLICT'); return prior; }
      if (input.expectedRevision !== (current?.version || 0)) raise('STALE_REVISION');
      if (input.action === 'RESET' && (!current || current.action === 'RESET')) raise('EMAIL_TEMPLATE_NOT_CUSTOMIZED');
      const row = { ...input, version: (current?.version || 0) + 1, createdAt: new Date('2026-11-14T10:00:00Z') };
      versions.push(row);
      return row;
    }
  };
  const centralPool = { async connect() { return { query: async text => { statements.push(text); return { rows: [] }; }, release() { released += 1; } }; } };
  const service = createEmailTemplateService({ centralPool, repository, clock: () => new Date('2026-11-14T12:00:00Z'), uuid: () => KEY(9) });
  return { service, versions, statements, writes, released: () => released, failNextWrite(error) { failNext = error; } };
}
const save = (f, scope, body, who) => f.service.save('member-invitation', scope, body, who || request());

test('the closed SQL only reads the version tables and calls the write function', () => {
  assert.match(sql.write, /^SELECT \* FROM public\.email_template_write\(/);
  assert.match(sql.admin, /public\.email_platform_admin\(\$1,\$2\)/);
  for (const text of Object.values(sql)) assert.doesNotMatch(text, /\b(INSERT|UPDATE|DELETE|TRUNCATE|ALTER|DROP|GRANT)\b/i);
});

test('without a saved template the view is the built-in text, at revision 0', async () => {
  const f = fixture();
  const view = await f.service.template('member-invitation', null, request());
  assert.equal(view.source, 'DEFAULT'); assert.equal(view.revision, 0);
  assert.equal(view.subject, 'Ative o seu acesso à C4G'); assert.match(view.html, /\{LigacaoAtivacao\}/);
  assert.equal(view.updatedAt, null); assert.equal(view.updatedBy, null);
  assert.deepEqual(view.variables, { body: ['Organizacao', 'LigacaoAtivacao', 'Validade', 'Logotipo'], subject: ['Organizacao', 'Validade'], required: ['LigacaoAtivacao', 'Validade'] });
  assert.deepEqual(view.logo, { source: 'C4G', url: null });
  assert.deepEqual(f.statements, ['BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY', 'COMMIT']);
  assert.equal(f.released(), 1);
  assert.deepEqual(await f.service.types(request()), { items: [{ type: 'member-invitation', globalCustomized: false, organizations: 0 }] });
});

test('only a C4G administrator reads, previews or writes; authorization comes before validation', async () => {
  const f = fixture(), member = request(MEMBER);
  for (const call of [
    () => f.service.types(member), () => f.service.template('member-invitation', null, member),
    () => f.service.preview('member-invitation', null, { subject: '', html: '' }, member),
    () => save(f, null, { subject: '', html: '<script>x</script>', expectedRevision: 0, idempotencyKey: KEY(1) }, member),
    () => f.service.reset('member-invitation', ORG_A, { expectedRevision: 0, idempotencyKey: KEY(1) }, member),
    () => f.service.test('member-invitation', null, {}, member),
    // A session id that is not the authenticated one is not an administrator either.
    () => f.service.template('member-invitation', null, { sessionID: 'other', authContext: { sessionId: 'session-' + ADMIN }, user: { id: ADMIN } }),
    () => f.service.template('member-invitation', null, {})
  ]) await assert.rejects(call, { code: 'C4G_ADMIN_REQUIRED' });
  assert.equal(f.writes.length, 0); assert.equal(f.versions.length, 0);
});

test('saving stores the sanitized template, reports what was removed and fixes its digest', async () => {
  const f = fixture();
  const view = await save(f, null, { subject: '  Convite {Organizacao}  ', html: VALID + '<script>alert(1)</script><p onclick="x()">fim</p>', expectedRevision: 0, idempotencyKey: KEY(1) });
  assert.equal(view.source, 'GLOBAL'); assert.equal(view.revision, 1); assert.equal(view.subject, 'Convite {Organizacao}');
  assert.doesNotMatch(view.html, /script|onclick/); assert.deepEqual(view.removed, ['p[onclick]', 'script']);
  assert.equal(view.updatedBy, 'admin@example.invalid'); assert.equal(view.updatedAt, '2026-11-14T10:00:00.000Z');
  const written = f.writes[0];
  assert.deepEqual([written.sessionId, written.actorId, written.type, written.organizationId, written.action, written.requestId, written.expectedRevision, written.id],
    ['session-' + ADMIN, ADMIN, 'MEMBER_INVITATION', null, 'SAVE', KEY(1), 0, KEY(9)]);
  assert.equal(written.contentSha256, sha(`${written.subject}\n${written.html}`));
  assert.deepEqual(f.statements, ['BEGIN', 'COMMIT']);
  assert.deepEqual((await f.service.types(request())).items, [{ type: 'member-invitation', globalCustomized: true, organizations: 0 }]);
});

test('an organization own template replaces the global one only for that organization', async () => {
  const f = fixture();
  await save(f, null, { subject: 'Global', html: VALID, expectedRevision: 0, idempotencyKey: KEY(1) });
  const own = await save(f, ORG_A, { subject: 'Da A', html: VALID, expectedRevision: 0, idempotencyKey: KEY(2) });
  assert.equal(own.source, 'ORGANIZATION'); assert.equal(own.subject, 'Da A'); assert.equal(own.revision, 1);
  const other = await f.service.template('member-invitation', ORG_B, request());
  assert.equal(other.source, 'GLOBAL'); assert.equal(other.subject, 'Global'); assert.equal(other.revision, 0);
  assert.equal((await f.service.types(request())).items[0].organizations, 1);
  // Reset returns A to the global template and keeps counting revisions; a second reset is refused.
  const reset = await f.service.reset('member-invitation', ORG_A, { expectedRevision: 1, idempotencyKey: KEY(3) }, request());
  assert.equal(reset.source, 'GLOBAL'); assert.equal(reset.subject, 'Global'); assert.equal(reset.revision, 2); assert.equal(reset.removed, undefined);
  await assert.rejects(() => f.service.reset('member-invitation', ORG_A, { expectedRevision: 2, idempotencyKey: KEY(4) }, request()), { code: 'EMAIL_TEMPLATE_NOT_CUSTOMIZED' });
  assert.equal(f.versions.filter(row => row.organizationId === ORG_A).length, 2);
});

test('an invalid template is refused with its reasons and never reaches the write function', async () => {
  const f = fixture();
  await assert.rejects(() => save(f, null, { subject: 'Convite {Logotipo}', html: '<p>Olá {Desconhecida}</p>', expectedRevision: 0, idempotencyKey: KEY(1) }), error => {
    assert.equal(error.code, 'EMAIL_TEMPLATE_INVALID');
    assert.deepEqual(error.reasons.map(reason => reason.code).sort(), ['REQUIRED_VARIABLE_MISSING', 'REQUIRED_VARIABLE_MISSING', 'UNKNOWN_VARIABLE', 'VARIABLE_NOT_ALLOWED_IN_SUBJECT']);
    return true;
  });
  assert.equal(f.writes.length, 0); assert.deepEqual(f.statements, ['BEGIN', 'ROLLBACK']); assert.equal(f.released(), 1);
});

test('unknown types, unknown organizations and malformed requests are refused without detail', async () => {
  const f = fixture(), body = { subject: 'S', html: VALID, expectedRevision: 0, idempotencyKey: KEY(1) };
  await assert.rejects(() => f.service.template('password-reset', null, request()), { code: 'RESOURCE_NOT_AVAILABLE' });
  await assert.rejects(() => f.service.template('member-invitation', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', request()), { code: 'RESOURCE_NOT_AVAILABLE' });
  await assert.rejects(() => f.service.template('member-invitation', "x' OR 1=1", request()), { code: 'RESOURCE_NOT_AVAILABLE' });
  await assert.rejects(() => save(f, 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', body), { code: 'RESOURCE_NOT_AVAILABLE' });
  for (const bad of [null, [], 'text', { ...body, extra: 1 }, { subject: 'S', html: VALID, idempotencyKey: KEY(1) }, { ...body, expectedRevision: -1 },
    { ...body, expectedRevision: '0' }, { ...body, expectedRevision: 1.5 }, { ...body, idempotencyKey: 'not-a-uuid' }]) {
    await assert.rejects(() => save(f, null, bad), { code: 'INVALID_INPUT' });
  }
  await assert.rejects(() => f.service.preview('member-invitation', null, { subject: 'S', html: VALID, extra: 1 }, request()), { code: 'INVALID_INPUT' });
  assert.equal(f.versions.length, 0);
});

test('what the database refuses is reported by name; anything else stays internal', async () => {
  const f = fixture(), body = n => ({ subject: 'S', html: VALID, expectedRevision: 0, idempotencyKey: KEY(n) });
  await save(f, null, body(1));
  await assert.rejects(() => save(f, null, body(2)), { code: 'STALE_REVISION' });
  // The same key with the same content is a replay, not a second version.
  assert.equal((await save(f, null, body(1))).revision, 1); assert.equal(f.versions.length, 1);
  await assert.rejects(() => save(f, null, { ...body(1), subject: 'Outro' }), { code: 'IDEMPOTENCY_CONFLICT' });
  f.failNextWrite(Object.assign(new Error('duplicate key'), { code: '23505' }));
  await assert.rejects(() => save(f, null, { ...body(3), expectedRevision: 1 }), { code: 'STATE_CONFLICT' });
  f.failNextWrite(Object.assign(new Error('relation "public.email_template_version" does not exist'), { code: '42P01' }));
  await assert.rejects(() => save(f, null, { ...body(4), expectedRevision: 1 }), error => {
    assert.equal(error.code, '42P01'); assert.deepEqual(publicError(error), { status: 503, body: { code: 'SERVICE_UNAVAILABLE' } });
    return true;
  });
  assert.equal(f.statements.filter(text => text === 'ROLLBACK').length, 4);
});

test('the preview escapes the organization name, uses an example link and writes nothing', async () => {
  const f = fixture();
  const preview = await f.service.preview('member-invitation', ORG_A, { subject: 'Convite {Organizacao}', html: VALID + '<img src=x onerror=alert(1)>' }, request());
  assert.equal(preview.subject, 'Convite Entidade <A>');
  assert.match(preview.html, /Olá Entidade &lt;A&gt;/); assert.doesNotMatch(preview.html, /<img|onerror|Entidade <A>/);
  assert.match(preview.html, /href="https:\/\/exemplo\.invalid\/ativacao-de-exemplo"/);
  assert.match(preview.text, /https:\/\/exemplo\.invalid\/ativacao-de-exemplo/); assert.match(preview.text, /15 de novembro de 2026/);
  assert.deepEqual(preview.removed, ['img']);
  assert.match((await f.service.preview('member-invitation', null, { subject: 'S', html: VALID }, request())).html, /Olá Entidade de exemplo/);
  await assert.rejects(() => f.service.preview('member-invitation', null, { subject: 'S', html: '<p>sem variáveis</p>' }, request()), { code: 'EMAIL_TEMPLATE_INVALID' });
  assert.equal(f.writes.length, 0);
});

test('the test message is refused as unavailable until sending exists, after the authorization', async () => {
  const f = fixture();
  await assert.rejects(() => f.service.test('member-invitation', null, {}, request()), { code: 'EMAIL_DELIVERY_UNAVAILABLE' });
  await assert.rejects(() => f.service.test('member-invitation', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', {}, request()), { code: 'RESOURCE_NOT_AVAILABLE' });
});

test('the service refuses an incomplete composition', () => {
  assert.throws(() => createEmailTemplateService({}), TypeError);
  assert.throws(() => createEmailTemplateService({ centralPool: { connect() {} }, repository: {} }), TypeError);
});

// ---- HTTP

function serviceDouble(overrides = {}) {
  const calls = [];
  const service = {};
  for (const method of ['types', 'template', 'save', 'reset', 'preview', 'test']) {
    service[method] = overrides[method] || (async (...args) => { calls.push({ method, args: args.slice(0, -1) }); return { method }; });
  }
  return { service, calls };
}

async function listen(service, authenticate = (req, res, next) => next()) {
  const app = express();
  app.use('/api/admin/email', express.json({ limit: '64kb' }), createPlatformEmailRouter({ express, service, authenticate }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const root = `http://127.0.0.1:${server.address().port}/api/admin/email`;
  const call = async (method, path, body) => {
    const response = await fetch(root + path, { method, headers: body === undefined ? {} : { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: response.status, headers: response.headers, body: method === 'HEAD' ? null : await response.json() };
  };
  return { call, close: () => new Promise(resolve => server.close(resolve)) };
}

test('each route reaches its service method, for the global template and for an organization', async () => {
  const { service, calls } = serviceDouble(), http = await listen(service);
  try {
    const body = { subject: 'S', html: 'H', expectedRevision: 0, idempotencyKey: KEY(1) };
    assert.deepEqual((await http.call('GET', '/templates')).body, { method: 'types' });
    await http.call('GET', '/templates/member-invitation');
    await http.call('PUT', '/templates/member-invitation', body);
    await http.call('POST', '/templates/member-invitation/reset', { expectedRevision: 1, idempotencyKey: KEY(2) });
    await http.call('POST', '/templates/member-invitation/preview', { subject: 'S', html: 'H' });
    await http.call('POST', '/templates/member-invitation/test', {});
    await http.call('GET', `/organizations/${ORG_A}/templates/member-invitation`);
    const scoped = await http.call('PUT', `/organizations/${ORG_A}/templates/member-invitation`, body);
    assert.equal(scoped.status, 200); assert.equal(scoped.headers.get('cache-control'), 'no-store'); assert.equal(scoped.headers.get('referrer-policy'), 'no-referrer');
    assert.deepEqual(calls, [
      { method: 'types', args: [] },
      { method: 'template', args: ['member-invitation', null] },
      { method: 'save', args: ['member-invitation', null, body] },
      { method: 'reset', args: ['member-invitation', null, { expectedRevision: 1, idempotencyKey: KEY(2) }] },
      { method: 'preview', args: ['member-invitation', null, { subject: 'S', html: 'H' }] },
      { method: 'test', args: ['member-invitation', null, {}] },
      { method: 'template', args: ['member-invitation', ORG_A] },
      { method: 'save', args: ['member-invitation', ORG_A, body] }
    ]);
  } finally { await http.close(); }
});

test('errors leave the server as a closed code, with sanitized reasons and no internal detail', async () => {
  const fail = error => async () => { throw error; };
  const { service } = serviceDouble({
    template: fail(Object.assign(new Error('C4G_ADMIN_REQUIRED'), { code: 'C4G_ADMIN_REQUIRED' })),
    save: fail(Object.assign(new Error('EMAIL_TEMPLATE_INVALID'), { code: 'EMAIL_TEMPLATE_INVALID', reasons: [
      { code: 'UNKNOWN_VARIABLE', variable: 'Desconhecida' }, { code: 'UNKNOWN_VARIABLE', variable: '<script>' },
      { code: 'INTERNAL_DETAIL', variable: 'x' }, { code: 'SUBJECT_REQUIRED', stack: 'secret' }, null] })),
    reset: fail(Object.assign(new Error('STALE_REVISION'), { code: 'STALE_REVISION' })),
    preview: fail(Object.assign(new Error('password authentication failed for user "postgres"'), { code: '28P01' })),
    test: fail(Object.assign(new Error('EMAIL_DELIVERY_UNAVAILABLE'), { code: 'EMAIL_DELIVERY_UNAVAILABLE' }))
  });
  const http = await listen(service);
  try {
    const denied = await http.call('GET', '/templates/member-invitation');
    assert.equal(denied.status, 403); assert.deepEqual(denied.body.error, { code: 'C4G_ADMIN_REQUIRED' }); assert.match(denied.body.correlationId, /^[0-9a-f-]{36}$/);
    const invalid = await http.call('PUT', '/templates/member-invitation', {});
    assert.equal(invalid.status, 400);
    assert.deepEqual(invalid.body.error, { code: 'EMAIL_TEMPLATE_INVALID', reasons: [{ code: 'UNKNOWN_VARIABLE', variable: 'Desconhecida' }, { code: 'UNKNOWN_VARIABLE' }, { code: 'SUBJECT_REQUIRED' }] });
    assert.equal((await http.call('POST', '/templates/member-invitation/reset', {})).status, 409);
    const hidden = await http.call('POST', '/templates/member-invitation/preview', {});
    assert.equal(hidden.status, 503); assert.deepEqual(hidden.body.error, { code: 'SERVICE_UNAVAILABLE' }); assert.doesNotMatch(JSON.stringify(hidden.body), /postgres|password/);
    const unavailable = await http.call('POST', '/templates/member-invitation/test', {});
    assert.equal(unavailable.status, 503); assert.deepEqual(unavailable.body.error, { code: 'EMAIL_DELIVERY_UNAVAILABLE' });
  } finally { await http.close(); }
  assert.deepEqual(Object.keys(STATUS).sort(), ['C4G_ADMIN_REQUIRED', 'EMAIL_DELIVERY_UNAVAILABLE', 'EMAIL_PUBLICATION_DRIFT', 'EMAIL_PUBLISH_UNAVAILABLE', 'EMAIL_TEMPLATE_INVALID', 'EMAIL_TEMPLATE_NOT_CUSTOMIZED',
    'IDEMPOTENCY_CONFLICT', 'INVALID_INPUT', 'RESOURCE_NOT_AVAILABLE', 'STALE_REVISION', 'STATE_CONFLICT']);
});

test('query strings, unknown paths, HEAD and unauthenticated requests never reach the service', async () => {
  const { service, calls } = serviceDouble(), http = await listen(service);
  try {
    const query = await http.call('GET', '/templates/member-invitation?scope=all');
    assert.equal(query.status, 400); assert.deepEqual(query.body.error, { code: 'INVALID_INPUT' });
    assert.equal((await http.call('DELETE', '/templates/member-invitation')).status, 405);
    assert.equal((await http.call('GET', '/logo')).status, 405);
    assert.equal((await http.call('POST', '/templates')).status, 405);
    assert.equal((await http.call('HEAD', '/templates')).status, 405);
    assert.equal(calls.length, 0);
  } finally { await http.close(); }
  const blocked = await listen(service, (req, res) => res.status(401).json({ error: { code: 'AUTHENTICATION_REQUIRED' } }));
  try {
    assert.equal((await blocked.call('GET', '/templates')).status, 401); assert.equal(calls.length, 0);
  } finally { await blocked.close(); }
  assert.throws(() => createPlatformEmailRouter({ express, service: {}, authenticate() {} }), TypeError);
  assert.throws(() => createPlatformEmailRouter({ express, service }), TypeError);
});
