'use strict';

// Increment 5 of context/features/email-templates-and-configuration-plan.md: the C4G logo, each entity's own logo and
// the public read. The database boundary (Central 051, email_logo_write) has its gate in test/integration/email-templates.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const { createEmailLogoService, logoForScope } = require('../src/emailTemplates/logoService');
const { createEmailTemplateService } = require('../src/emailTemplates/service');
const { createPlatformEmailRouter } = require('../src/emailTemplates/http');
const { createPublicEmailLogoRouter, mountLogoRoutes, LOGO_STATUS } = require('../src/emailTemplates/logoHttp');
const { createDirectoryRouter } = require('../src/routes/organizationDirectoryRoutes');
const sql = require('../src/emailTemplates/sql');

const ADMIN = '11111111-1111-4111-8111-111111111111';
const ORG_ADMIN_A = '22222222-2222-4222-8222-222222222222';
const MANAGER_A = '33333333-3333-4333-8333-333333333333';
const ORG_ADMIN_B = '44444444-4444-4444-8444-444444444444';
const ORG_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ORG_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const KEY = n => `0000000${n}-0000-4000-8000-000000000000`;
const VALID = '<p>{Logotipo}</p><p>Olá {Organizacao}</p><p><a href="{LigacaoAtivacao}">Ativar</a></p><p>Expira em {Validade}.</p>';
const ORG_ADMINS = { [ORG_ADMIN_A]: ORG_A, [ORG_ADMIN_B]: ORG_B };

function png(width = 200, height = 80, padding = 0) {
  const header = Buffer.alloc(8 + 25);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(header);
  header.writeUInt32BE(13, 8); header.write('IHDR', 12, 'latin1'); header.writeUInt32BE(width, 16); header.writeUInt32BE(height, 20);
  return Buffer.concat([header, Buffer.alloc(padding, 1), Buffer.from([0, 0, 0, 0, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82])]);
}
const request = (actorId, organizationId = null) => ({
  sessionID: 'session-' + actorId, authContext: { sessionId: 'session-' + actorId }, user: { id: actorId },
  ...(organizationId ? { organizationContext: { organizationId } } : {})
});

// An in-memory stand-in for email_logo_version and email_logo_write, with the rules the gate proves in PostgreSQL.
function fixture() {
  const versions = [], writes = [], statements = [];
  let released = 0, failNext = null, names = 0;
  const rows = org => versions.filter(row => row.organizationId === org);
  const repository = {
    async isPlatformAdmin(client, sessionId, actorId) { return actorId === ADMIN && sessionId === 'session-' + ADMIN; },
    async isOrganizationAdmin(client, sessionId, actorId, org) { return ORG_ADMINS[actorId] === org && sessionId === 'session-' + actorId; },
    async latestLogo(client, org) {
      const row = rows(org).at(-1);
      return row ? { version: row.version, action: row.action, public_id: row.publicId, created_at: row.createdAt } : null;
    },
    async writeLogo(client, input) {
      writes.push(input);
      if (failNext) { const error = failNext; failNext = null; throw error; }
      const raise = message => { throw Object.assign(new Error(message), { code: 'P0001' }); };
      if (input.organizationId === null ? input.actorId !== ADMIN : ORG_ADMINS[input.actorId] !== input.organizationId) raise(input.organizationId === null ? 'C4G_ADMIN_REQUIRED' : 'NOT_AUTHORIZED');
      const current = rows(input.organizationId).at(-1), action = input.content === null ? 'REMOVE' : 'SET';
      const prior = versions.find(row => row.requestId === input.requestId && row.actorId === input.actorId);
      if (prior) { if (prior.action !== action || prior.version !== input.expectedRevision + 1 || (prior.content && !prior.content.equals(input.content))) raise('IDEMPOTENCY_CONFLICT'); return prior; }
      if (input.expectedRevision !== (current?.version || 0)) raise('STALE_REVISION');
      if (action === 'REMOVE' && (!current || current.action === 'REMOVE')) raise('EMAIL_LOGO_NOT_SET');
      const row = { ...input, action, version: (current?.version || 0) + 1, createdAt: new Date('2026-11-14T10:00:00Z') };
      versions.push(row);
      return row;
    },
    async publicLogo(client, publicId) {
      const row = versions.find(item => item.publicId === publicId);
      return row ? { mime_type: row.mime, content: row.content } : null;
    },
    // Template side, for the views that name the logo.
    async organization(client, id) { return [ORG_A, ORG_B].includes(id) ? { id, display_name: id === ORG_A ? 'Entidade A' : 'Entidade B' } : null; },
    async latest() { return null; },
    async summary() { return { global_customized: false, organizations: 0 }; },
    async write() { throw new Error('not used'); }
  };
  const centralPool = { async connect() { return { query: async text => { statements.push(text); return { rows: [] }; }, release() { released += 1; } }; } };
  const logos = createEmailLogoService({ centralPool, repository, uuid: () => KEY(9), publicId: () => (++names).toString(16).padStart(32, '0') });
  return { logos, repository, centralPool, versions, writes, statements, released: () => released, failNextWrite(error) { failNext = error; } };
}
const name = n => n.toString(16).padStart(32, '0');
const command = (revision, n) => ({ expectedRevision: revision, idempotencyKey: KEY(n) });

test('the closed SQL of the logos only reads the version table and calls the write function', () => {
  assert.match(sql.logoWrite, /public\.email_logo_write\(\$1,\$2,\$3,\$4,\$5,\$6,\$7,\$8,\$9,\$10,\$11\)/);
  assert.match(sql.organizationAdmin, /public\.email_organization_admin\(\$1,\$2,\$3\)/);
  assert.match(sql.publicLogo, /WHERE public_id=\$1$/);
  // The current logo of a scope never carries the image bytes; only the public read selects them.
  assert.doesNotMatch(sql.latestLogo, /content/);
  for (const text of [sql.logoWrite, sql.organizationAdmin, sql.publicLogo, sql.latestLogo]) assert.doesNotMatch(text, /\b(INSERT|UPDATE|DELETE|TRUNCATE|ALTER|DROP|GRANT)\b/i);
});

test('the C4G logo starts as the built-in image and is set and removed by a C4G administrator', async () => {
  const f = fixture(), admin = request(ADMIN), image = png();
  assert.deepEqual(await f.logos.platformLogo(admin), { url: null, revision: 0, updatedAt: null });
  const set = await f.logos.platformLogoSet(image, command(0, 1), admin);
  assert.deepEqual(set, { url: '/api/public/email-logos/' + name(1), revision: 1, updatedAt: '2026-11-14T10:00:00.000Z' });
  const written = f.writes[0];
  assert.deepEqual([written.sessionId, written.actorId, written.organizationId, written.id, written.publicId, written.mime, written.width, written.height, written.requestId, written.expectedRevision],
    ['session-' + ADMIN, ADMIN, null, KEY(9), name(1), 'image/png', 200, 80, KEY(1), 0]);
  assert.ok(written.content.equals(image));
  assert.deepEqual(f.statements.slice(-2), ['BEGIN', 'COMMIT']);
  // Replacing gives the new version a new public name; the earlier one keeps answering.
  const replaced = await f.logos.platformLogoSet(png(100, 50), command(1, 2), admin);
  assert.equal(replaced.url, '/api/public/email-logos/' + name(2)); assert.equal(replaced.revision, 2);
  const removed = await f.logos.platformLogoRemove(command(2, 3), admin);
  assert.deepEqual(removed, { url: null, revision: 3, updatedAt: null });
  assert.equal(f.writes[2].content, null); assert.equal(f.writes[2].publicId, null); assert.equal(f.writes[2].mime, null);
  await assert.rejects(() => f.logos.platformLogoRemove(command(3, 4), admin), { code: 'EMAIL_LOGO_NOT_SET' });
  assert.ok((await f.logos.publicImage(name(1))).content.equals(image));
  assert.equal(f.released(), f.statements.filter(text => text.startsWith('BEGIN')).length + 1);
});

test('only a C4G administrator touches the C4G logo, and authorization comes before validation', async () => {
  const f = fixture();
  for (const who of [request(ORG_ADMIN_A, ORG_A), request(MANAGER_A, ORG_A), {}, { sessionID: 'other', authContext: { sessionId: 'session-' + ADMIN }, user: { id: ADMIN } }]) {
    await assert.rejects(() => f.logos.platformLogo(who), { code: 'C4G_ADMIN_REQUIRED' });
    await assert.rejects(() => f.logos.platformLogoSet(Buffer.from('not an image'), { expectedRevision: -1 }, who), { code: 'C4G_ADMIN_REQUIRED' });
    await assert.rejects(() => f.logos.platformLogoRemove(command(0, 1), who), { code: 'C4G_ADMIN_REQUIRED' });
  }
  assert.equal(f.writes.length, 0);
});

test('an entity logo belongs to the entity of the session: its administrator only, never another entity', async () => {
  const f = fixture(), adminA = request(ORG_ADMIN_A, ORG_A), adminB = request(ORG_ADMIN_B, ORG_B);
  const set = await f.logos.organizationLogoSet(png(), command(0, 1), adminA);
  assert.equal(set.url, '/api/public/email-logos/' + name(1)); assert.equal(f.writes[0].organizationId, ORG_A);
  // B neither sees nor changes A's logo: its own scope is still empty.
  assert.deepEqual(await f.logos.organizationLogo(adminB), { url: null, revision: 0, updatedAt: null });
  await assert.rejects(() => f.logos.organizationLogoRemove(command(0, 2), adminB), { code: 'EMAIL_LOGO_NOT_SET' });
  assert.equal((await f.logos.organizationLogo(adminA)).revision, 1);
  for (const who of [
    request(MANAGER_A, ORG_A),            // another profile of A
    request(ADMIN, ORG_A),                // a C4G administrator is deliberately not enough
    request(ORG_ADMIN_A, ORG_B),          // A's administrator with B as the claimed entity
    request(ORG_ADMIN_A),                 // no entity selected
    request(ORG_ADMIN_A, "x' OR 1=1"), {}
  ]) {
    await assert.rejects(() => f.logos.organizationLogo(who), { code: 'NOT_AUTHORIZED' });
    await assert.rejects(() => f.logos.organizationLogoSet(png(), command(1, 3), who), { code: 'NOT_AUTHORIZED' });
    await assert.rejects(() => f.logos.organizationLogoRemove(command(1, 3), who), { code: 'NOT_AUTHORIZED' });
  }
  assert.equal(f.versions.length, 1);
  assert.equal((await f.logos.organizationLogoRemove(command(1, 4), adminA)).url, null);
});

test('an upload is judged by its bytes and a refused one never reaches the write function', async () => {
  const f = fixture(), admin = request(ADMIN);
  const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
  await assert.rejects(() => f.logos.platformLogoSet(svg, command(0, 1), admin), { code: 'EMAIL_LOGO_INVALID' });
  await assert.rejects(() => f.logos.platformLogoSet(Buffer.alloc(0), command(0, 1), admin), { code: 'EMAIL_LOGO_INVALID' });
  await assert.rejects(() => f.logos.platformLogoSet('text', command(0, 1), admin), { code: 'EMAIL_LOGO_INVALID' });
  await assert.rejects(() => f.logos.platformLogoSet(png(1201, 80), command(0, 1), admin), { code: 'EMAIL_LOGO_DIMENSIONS' });
  await assert.rejects(() => f.logos.platformLogoSet(png(200, 80, 512 * 1024), command(0, 1), admin), { code: 'EMAIL_LOGO_TOO_LARGE' });
  for (const bad of [null, {}, { expectedRevision: 0 }, { expectedRevision: '0', idempotencyKey: KEY(1) }, { expectedRevision: 1.5, idempotencyKey: KEY(1) },
    { expectedRevision: -1, idempotencyKey: KEY(1) }, { expectedRevision: 0, idempotencyKey: 'not-a-uuid' }]) {
    await assert.rejects(() => f.logos.platformLogoSet(png(), bad, admin), { code: 'INVALID_INPUT' });
  }
  assert.equal(f.writes.length, 0);
  assert.equal(f.statements.filter(text => text === 'ROLLBACK').length, 12);
});

test('what the database refuses is reported by name; anything else stays internal', async () => {
  const f = fixture(), admin = request(ADMIN), image = png();
  await f.logos.platformLogoSet(image, command(0, 1), admin);
  await assert.rejects(() => f.logos.platformLogoSet(png(10, 10), command(0, 2), admin), { code: 'STALE_REVISION' });
  // The same key with the same image is a replay, not a second version.
  assert.equal((await f.logos.platformLogoSet(image, command(0, 1), admin)).revision, 1); assert.equal(f.versions.length, 1);
  await assert.rejects(() => f.logos.platformLogoSet(png(10, 10), command(0, 1), admin), { code: 'IDEMPOTENCY_CONFLICT' });
  f.failNextWrite(Object.assign(new Error('duplicate key'), { code: '23505' }));
  await assert.rejects(() => f.logos.platformLogoSet(image, command(1, 3), admin), { code: 'STATE_CONFLICT' });
  f.failNextWrite(Object.assign(new Error('relation "public.email_logo_version" does not exist'), { code: '42P01' }));
  await assert.rejects(() => f.logos.platformLogoSet(image, command(1, 4), admin), { code: '42P01' });
});

test('the public read knows only well-formed names of stored images', async () => {
  const f = fixture();
  await f.logos.platformLogoSet(png(), command(0, 1), request(ADMIN));
  assert.equal((await f.logos.publicImage(name(1))).mime, 'image/png');
  for (const bad of [name(2), 'A'.repeat(32), 'g'.repeat(32), name(1) + '0', ' ' + name(1), '../' + name(1), '', null, undefined, 1, {}]) assert.equal(await f.logos.publicImage(bad), null);
  // A row that is not a validated image type is not served, whatever it holds.
  f.versions[0].mime = 'image/svg+xml';
  assert.equal(await f.logos.publicImage(name(1)), null);
});

test('a template view and its preview carry the logo of their scope', async () => {
  const f = fixture();
  const templates = createEmailTemplateService({ centralPool: f.centralPool, repository: f.repository, clock: () => new Date('2026-11-14T12:00:00Z'), publicBaseUrl: 'https://app.example.test/caminho' });
  const admin = request(ADMIN), body = { subject: 'S', html: VALID };
  const preview = scope => templates.preview('member-invitation', scope, body, admin);
  assert.deepEqual((await templates.template('member-invitation', ORG_A, admin)).logo, { source: 'C4G', url: null });
  assert.match((await preview(null)).html, /<img src="https:\/\/app\.example\.test\/logo-c4g\.png" alt="C4G"/);
  await f.logos.platformLogoSet(png(), command(0, 1), admin);
  await f.logos.organizationLogoSet(png(), command(0, 2), request(ORG_ADMIN_A, ORG_A));
  assert.deepEqual((await templates.template('member-invitation', null, admin)).logo, { source: 'C4G', url: '/api/public/email-logos/' + name(1) });
  assert.deepEqual((await templates.template('member-invitation', ORG_A, admin)).logo, { source: 'ORGANIZATION', url: '/api/public/email-logos/' + name(2) });
  // B has no logo of its own: it carries the C4G one, never A's.
  assert.deepEqual((await templates.template('member-invitation', ORG_B, admin)).logo, { source: 'C4G', url: '/api/public/email-logos/' + name(1) });
  assert.match((await preview(ORG_A)).html, new RegExp(`<img src="https://app\\.example\\.test/api/public/email-logos/${name(2)}" alt="Entidade A"`));
  assert.match((await preview(ORG_B)).html, new RegExp(`<img src="https://app\\.example\\.test/api/public/email-logos/${name(1)}" alt="C4G"`));
  assert.doesNotMatch((await preview(ORG_A)).text, /email-logos|logo-c4g/);
  await f.logos.organizationLogoRemove(command(1, 3), request(ORG_ADMIN_A, ORG_A));
  assert.equal((await logoForScope(f.repository, null, ORG_A)).source, 'C4G');
  // Without an HTTPS origin (local development) the preview has no image, as an email client would refuse it.
  const local = createEmailTemplateService({ centralPool: f.centralPool, repository: f.repository, publicBaseUrl: 'http://localhost:5173' });
  assert.doesNotMatch((await local.preview('member-invitation', null, body, admin)).html, /<img/);
  assert.throws(() => createEmailTemplateService({ centralPool: f.centralPool, repository: f.repository, publicBaseUrl: 'javascript:alert(1)' }), TypeError);
  assert.throws(() => createEmailTemplateService({ centralPool: f.centralPool, repository: f.repository, publicBaseUrl: 'https://user:secret@app.example.test' }), TypeError);
});

test('the service refuses an incomplete composition', () => {
  assert.throws(() => createEmailLogoService({}), TypeError);
  assert.throws(() => createEmailLogoService({ centralPool: { connect() {} }, repository: {} }), TypeError);
});

// ---- HTTP

function logoDouble(overrides = {}) {
  const calls = [], logos = {};
  for (const method of ['platformLogo', 'platformLogoSet', 'platformLogoRemove', 'organizationLogo', 'organizationLogoSet', 'organizationLogoRemove']) {
    logos[method] = overrides[method] || (async (...args) => { calls.push({ method, args: args.slice(0, -1) }); return { url: null, revision: 7, updatedAt: null }; });
  }
  logos.publicImage = overrides.publicImage || (async id => (id === name(1) ? { mime: 'image/png', content: png() } : null));
  return { logos, calls };
}

async function listen(mount) {
  const app = express();
  app.use(express.json({ limit: '100kb' }));
  mount(app);
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const root = `http://127.0.0.1:${server.address().port}`;
  const call = async (method, url, { headers = {}, body } = {}) => {
    const response = await fetch(root + url, { method, headers, body });
    const type = response.headers.get('content-type') || '';
    return { status: response.status, headers: response.headers, body: method === 'HEAD' ? null : type.includes('json') ? await response.json() : Buffer.from(await response.arrayBuffer()) };
  };
  return { call, close: () => new Promise(resolve => server.close(resolve)) };
}
const templateDouble = () => Object.fromEntries(['types', 'template', 'save', 'reset', 'preview', 'test'].map(method => [method, async () => ({ method })]));
const platform = logos => app => app.use('/api/admin/email', createPlatformEmailRouter({ express, service: templateDouble(), authenticate: (req, res, next) => next(), logos }));
const upload = (revision, key, type = 'image/png') => ({ 'Content-Type': type, 'X-Logo-Revision': String(revision), 'Idempotency-Key': key });

test('the C4G logo routes pass the image bytes, the revision and the key to the service', async () => {
  const { logos, calls } = logoDouble(), http = await listen(platform(logos)), image = png();
  try {
    const read = await http.call('GET', '/api/admin/email/logo');
    assert.equal(read.status, 200); assert.deepEqual(read.body, { url: null, revision: 7, updatedAt: null });
    assert.equal(read.headers.get('cache-control'), 'no-store');
    assert.equal((await http.call('PUT', '/api/admin/email/logo', { headers: upload(3, KEY(1)), body: image })).status, 200);
    assert.equal((await http.call('PUT', '/api/admin/email/logo', { headers: upload(4, KEY(2), 'image/jpeg'), body: image })).status, 200);
    assert.equal((await http.call('DELETE', '/api/admin/email/logo', { headers: { 'X-Logo-Revision': '5', 'Idempotency-Key': KEY(3) } })).status, 200);
    assert.deepEqual(calls.map(call => call.method), ['platformLogo', 'platformLogoSet', 'platformLogoSet', 'platformLogoRemove']);
    assert.ok(calls[1].args[0].equals(image)); assert.deepEqual(calls[1].args[1], { expectedRevision: 3, idempotencyKey: KEY(1) });
    assert.deepEqual(calls[3].args, [{ expectedRevision: 5, idempotencyKey: KEY(3) }]);
  } finally { await http.close(); }
});

test('malformed logo requests are refused before the service and oversized bodies while they are read', async () => {
  const { logos, calls } = logoDouble(), http = await listen(platform(logos)), image = png();
  try {
    const refused = async (expected, code, method, options) => {
      const response = await http.call(method, '/api/admin/email/logo' + (options.query || ''), options);
      assert.equal(response.status, expected); assert.equal(response.body.error.code, code); assert.match(response.body.correlationId, /^[0-9a-f-]{36}$/);
    };
    await refused(400, 'INVALID_INPUT', 'GET', { query: '?scope=all' });
    await refused(400, 'INVALID_INPUT', 'PUT', { headers: { 'Content-Type': 'image/png', 'Idempotency-Key': KEY(1) }, body: image });
    await refused(400, 'INVALID_INPUT', 'PUT', { headers: { 'Content-Type': 'image/png', 'X-Logo-Revision': '1' }, body: image });
    for (const revision of ['-1', '1.5', '01', 'x', '12345678901']) await refused(400, 'INVALID_INPUT', 'PUT', { headers: upload(revision, KEY(1)), body: image });
    await refused(400, 'INVALID_INPUT', 'DELETE', { headers: { 'Idempotency-Key': KEY(1) } });
    // Only the two image types are read as bytes; anything else arrives with no image at all.
    await refused(400, 'EMAIL_LOGO_INVALID', 'PUT', { headers: upload(0, KEY(1), 'image/svg+xml'), body: image });
    await refused(400, 'EMAIL_LOGO_INVALID', 'PUT', { headers: upload(0, KEY(1), 'application/json'), body: '{"a":1}' });
    await refused(400, 'EMAIL_LOGO_INVALID', 'PUT', { headers: upload(0, KEY(1)) });
    await refused(413, 'EMAIL_LOGO_TOO_LARGE', 'PUT', { headers: upload(0, KEY(1)), body: png(200, 80, 512 * 1024) });
    assert.equal((await http.call('POST', '/api/admin/email/logo')).status, 405);
    assert.equal(calls.length, 0);
  } finally { await http.close(); }
});

test('logo errors leave the server as a closed code with no internal detail', async () => {
  const fail = (code, message = code) => async () => { throw Object.assign(new Error(message), { code }); };
  const { logos } = logoDouble({ platformLogo: fail('C4G_ADMIN_REQUIRED'), platformLogoSet: fail('EMAIL_LOGO_DIMENSIONS'), platformLogoRemove: fail('28P01', 'password authentication failed for user "postgres"') });
  const http = await listen(platform(logos));
  try {
    assert.equal((await http.call('GET', '/api/admin/email/logo')).status, 403);
    const dimensions = await http.call('PUT', '/api/admin/email/logo', { headers: upload(0, KEY(1)), body: png() });
    assert.equal(dimensions.status, 400); assert.deepEqual(dimensions.body.error, { code: 'EMAIL_LOGO_DIMENSIONS' });
    const hidden = await http.call('DELETE', '/api/admin/email/logo', { headers: { 'X-Logo-Revision': '1', 'Idempotency-Key': KEY(1) } });
    assert.equal(hidden.status, 503); assert.deepEqual(hidden.body.error, { code: 'SERVICE_UNAVAILABLE' }); assert.doesNotMatch(JSON.stringify(hidden.body), /postgres|password/);
  } finally { await http.close(); }
  assert.deepEqual(Object.keys(LOGO_STATUS).sort(), ['C4G_ADMIN_REQUIRED', 'EMAIL_LOGO_DIMENSIONS', 'EMAIL_LOGO_INVALID', 'EMAIL_LOGO_NOT_SET', 'EMAIL_LOGO_TOO_LARGE',
    'IDEMPOTENCY_CONFLICT', 'INVALID_INPUT', 'NOT_AUTHORIZED', 'STALE_REVISION', 'STATE_CONFLICT']);
  assert.throws(() => createPlatformEmailRouter({ express, service: templateDouble(), authenticate() {}, logos: {} }), TypeError);
  assert.throws(() => mountLogoRoutes(express.Router(), '/logo', { express, read() {} }), TypeError);
});

test('the entity routes sit behind the organization context and use the entity methods', async () => {
  const { logos, calls } = logoDouble(), order = [];
  const step = label => (req, res, next) => { order.push(label); next(); };
  const organizationMiddleware = { requireServerSession: step('session'), resolveOrganizationContext: step('resolve'), requireOrganizationContext: step('context') };
  const directory = emailLogos => app => app.use('/api/organization-directory', createDirectoryRouter({ express, service: { execute: async () => ({}) }, members: {
    list: async () => ({}), create: async () => ({}) }, emailLogos, authenticate: step('authenticate'), organizationMiddleware }));
  let http;
  try { http = await listen(directory(logos)); } catch (error) { assert.fail('directory router composition failed: ' + error.message); }
  try {
    assert.equal((await http.call('GET', '/api/organization-directory/email-logo')).status, 200);
    assert.deepEqual(order, ['authenticate', 'session', 'resolve', 'context']);
    assert.equal((await http.call('PUT', '/api/organization-directory/email-logo', { headers: upload(0, KEY(1)), body: png() })).status, 200);
    assert.equal((await http.call('DELETE', '/api/organization-directory/email-logo', { headers: { 'X-Logo-Revision': '1', 'Idempotency-Key': KEY(2) } })).status, 200);
    assert.deepEqual(calls.map(call => call.method), ['organizationLogo', 'organizationLogoSet', 'organizationLogoRemove']);
  } finally { await http.close(); }
  // Without the logo service the path does not exist.
  const without = await listen(directory(null));
  try { assert.equal((await without.call('DELETE', '/api/organization-directory/email-logo')).status, 405); } finally { await without.close(); }
});

test('the public route serves the image with fixed headers and nothing else', async () => {
  const { logos } = logoDouble();
  const http = await listen(app => app.use('/api/public/email-logos', createPublicEmailLogoRouter({ express, logos })));
  try {
    const image = await http.call('GET', '/api/public/email-logos/' + name(1));
    assert.equal(image.status, 200); assert.ok(image.body.equals(png()));
    assert.equal(image.headers.get('content-type'), 'image/png'); assert.equal(image.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(image.headers.get('cache-control'), 'public, max-age=31536000, immutable');
    assert.equal(image.headers.get('content-length'), String(png().length)); assert.equal(image.headers.get('set-cookie'), null);
    const missing = await http.call('GET', '/api/public/email-logos/' + name(2));
    assert.equal(missing.status, 404); assert.deepEqual(missing.body, { error: { code: 'RESOURCE_NOT_AVAILABLE' } }); assert.equal(missing.headers.get('cache-control'), 'no-store');
    for (const [method, url] of [['POST', '/' + name(1)], ['PUT', '/' + name(1)], ['DELETE', '/' + name(1)], ['GET', '/'], ['GET', `/${name(1)}/extra`]]) {
      assert.equal((await http.call(method, '/api/public/email-logos' + url)).status, 405);
    }
  } finally { await http.close(); }
  const broken = await listen(app => app.use('/api/public/email-logos', createPublicEmailLogoRouter({ express, logos: logoDouble({ publicImage: async () => { throw new Error('connection refused to 10.0.0.5'); } }).logos })));
  try {
    const failed = await broken.call('GET', '/api/public/email-logos/' + name(1));
    assert.equal(failed.status, 503); assert.deepEqual(failed.body, { error: { code: 'SERVICE_UNAVAILABLE' } });
  } finally { await broken.close(); }
  assert.throws(() => createPublicEmailLogoRouter({ express, logos: {} }), TypeError);
});

test('the application mounts the public route before the body parsers and the session', () => {
  const app = fs.readFileSync(path.resolve(__dirname, '../src/app.js'), 'utf8');
  const at = text => { const index = app.indexOf(text); assert.notEqual(index, -1, text); return index; };
  const mounted = at("app.use('/api/public/email-logos', routes.publicEmailLogos)");
  assert.ok(mounted > at("app.use('/api', createRateLimiter({ limit: limits.apiPerMinute }))"));
  assert.ok(mounted < at("app.use(express.json({ limit: '100kb' }))"));
  assert.ok(mounted < at('app.use(security.sessionMiddleware)'));
  const composition = fs.readFileSync(path.resolve(__dirname, '../src/productionComposition.js'), 'utf8');
  assert.match(composition, /createPublicEmailLogoRouter\(\{express,logos:emailLogos\}\)/);
  assert.match(composition, /createPlatformEmailRouter\(\{\s*express,authenticate,logos:emailLogos,/);
  assert.match(composition, /members:memberOnboarding,emailLogos,/);
});
