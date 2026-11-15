'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createAuthenticationEmailService } = require('../src/emailTemplates/authenticationService');
const { compilePasswordReset, DEFAULT_PASSWORD_RESET } = require('../src/emailTemplates/keycloakPasswordReset');
const { publicError } = require('../src/emailTemplates/http');

const ADMIN = '11111111-1111-4111-8111-111111111111';
const KEY = '22222222-2222-4222-8222-222222222222';
const request = () => ({ user: { id: ADMIN, email: 'forged@example.invalid' }, sessionID: 'session', authContext: { sessionId: 'session' } });
const input = () => ({ ...DEFAULT_PASSWORD_RESET, expectedRevision: 0, idempotencyKey: KEY });

function fixture({ disabled = false } = {}) {
  let allowed = true, state = { revision: 0, configured: false }, reads = 0, released = 0;
  const sent = [], delegated = [], sql = [], contexts = [];
  const repository = {
    isPlatformAdmin: async (_, session, actor) => allowed && session === 'session' && actor === ADMIN,
    latestLogo: async (_, organizationId) => { contexts.push(organizationId); return { action: 'SET', public_id: 'a'.repeat(32) }; },
    recipient: async () => 'admin@example.invalid'
  };
  const baseService = Object.fromEntries(['types', 'template', 'save', 'reset', 'preview', 'test'].map(method => [method, async (...args) => {
    delegated.push({ method, args });
    return method === 'types' ? { items: [{ type: 'member-invitation', globalCustomized: true, organizations: 2 }] } : { delegated: method };
  }]));
  const publisher = {
    read: async () => { reads += 1; return structuredClone(state); },
    publish: async payload => {
      sent.push(structuredClone(payload));
      state = { revision: payload.expectedRevision + 1, configured: true, action: payload.action, actorId: payload.actorId,
        updatedAt: '2026-11-15T12:00:00Z', template: payload.template, messages: payload.messages, logoUrl: payload.logoUrl };
      return structuredClone(state);
    }
  };
  const service = createAuthenticationEmailService({ baseService, publisher: disabled ? null : publisher, repository,
    publicBaseUrl: 'https://app.example.invalid/path', centralPool: { connect: async () => ({
      query: async value => { sql.push(value); }, release() { released += 1; }
    }) } });
  return { service, publisher, sent, sql, delegated, contexts, reads: () => reads, released: () => released,
    revoke: () => { allowed = false; }, state: () => state, setState: value => { state = value; } };
}

test('native type is capability gated and invitation operations remain delegated unchanged', async () => {
  const f = fixture();
  const types = await f.service.types(request());
  assert.deepEqual(types.items, [{ type: 'member-invitation', globalCustomized: true, organizations: 2 },
    { type: 'password-reset', configurable: true, globalCustomized: false, organizations: 0 }]);
  for (const method of ['template', 'save', 'reset', 'preview', 'test']) {
    const args = method === 'template' ? ['member-invitation', 'org', request()] : ['member-invitation', 'org', {}, request()];
    assert.deepEqual(await f.service[method](...args), { delegated: method });
    assert.deepEqual(f.delegated.at(-1).args, args);
  }
  const disabled = fixture({ disabled: true });
  assert.equal((await disabled.service.types(request())).items.at(-1).configurable, false);
  await assert.rejects(disabled.service.template('password-reset', null, request()), { code: 'EMAIL_PUBLISH_UNAVAILABLE' });
});

test('draft before first publication is explicit and has no organization or send capability', async () => {
  const f = fixture();
  const dto = await f.service.template('password-reset', null, request());
  assert.equal(dto.publication, 'UNPUBLISHED');
  assert.equal(dto.source, 'DEFAULT');
  assert.equal(dto.revision, 0);
  assert.deepEqual(dto.capabilities, { test: false });
  assert.deepEqual(dto.variables, { body: ['LigacaoRecuperacao', 'Validade', 'Logotipo'], subject: [], required: ['LigacaoRecuperacao', 'Validade'] });
  assert.equal(dto.updatedBy, null);
  assert.ok(f.contexts.every(value => value === null));
  assert.ok(f.sql.every(value => ['BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY', 'COMMIT'].includes(value)));
});

test('authorization precedes validation, provider access and scope rejection', async () => {
  const f = fixture();
  for (const who of [{}, { ...request(), sessionID: 'forged' }, { ...request(), user: { id: KEY } }]) {
    for (const method of ['template', 'save', 'reset', 'preview', 'test']) {
      const args = method === 'template' ? ['password-reset', KEY, who] : ['password-reset', KEY, {}, who];
      await assert.rejects(f.service[method](...args), { code: 'C4G_ADMIN_REQUIRED' });
    }
  }
  assert.equal(f.reads(), 0);
  assert.equal(f.sent.length, 0);
  for (const method of ['template', 'save', 'reset', 'preview', 'test']) {
    const args = method === 'template' ? ['password-reset', KEY, request()] : ['password-reset', KEY, {}, request()];
    await assert.rejects(f.service[method](...args), { code: 'RESOURCE_NOT_AVAILABLE' });
  }
});

test('revocation during upstream read denies the resulting template', async () => {
  const f = fixture();
  f.publisher.read = async () => { f.revoke(); return f.state(); };
  await assert.rejects(f.service.template('password-reset', null, request()), { code: 'C4G_ADMIN_REQUIRED' });
  assert.ok(f.sql.includes('ROLLBACK'));
});

test('save fixes sanitized source, compiled messages, logo and trusted actor in one command', async () => {
  const f = fixture();
  const dto = await f.service.save('password-reset', null, { ...input(), html: input().html + '<script>unsafe()</script>' }, request());
  const sent = f.sent[0];
  assert.deepEqual(Object.keys(sent).sort(), ['action', 'actorId', 'expectedRevision', 'idempotencyKey', 'logoUrl', 'messages', 'template']);
  assert.equal(sent.actorId, ADMIN);
  assert.equal(sent.logoUrl, 'https://app.example.invalid/api/public/email-logos/' + 'a'.repeat(32));
  assert.deepEqual(sent.messages, compilePasswordReset(sent.template, { logoUrl: sent.logoUrl }).messages);
  assert.ok(!sent.template.html.includes('script'));
  assert.deepEqual(dto.removed, ['script']);
  assert.equal(dto.publication, 'PUBLISHED');
  assert.equal(dto.revision, 1);
  assert.equal(dto.updatedBy, 'admin@example.invalid');
  assert.ok(!Object.hasOwn(dto, 'messages'));
  assert.ok(!Object.hasOwn(dto, 'actorId'));
  assert.equal((await f.service.types(request())).items.at(-1).globalCustomized, true);
});

test('reset publishes the C4G default as a fresh version rather than deleting history', async () => {
  const f = fixture();
  await f.service.save('password-reset', null, { ...input(), subject: 'Personalizado' }, request());
  const result = await f.service.reset('password-reset', null, { expectedRevision: 1, idempotencyKey: KEY }, request());
  assert.equal(f.sent[1].action, 'RESET');
  assert.deepEqual(f.sent[1].template, DEFAULT_PASSWORD_RESET);
  assert.equal(result.revision, 2);
  assert.equal(result.source, 'DEFAULT');
  assert.equal(result.publication, 'PUBLISHED');
});

test('invalid variables, extra authority fields and malformed concurrency inputs never publish', async () => {
  const f = fixture();
  for (const patch of [{ actorId: KEY }, { smtpServer: {} }, { expectedRevision: -1 }, { idempotencyKey: 'bad' }]) {
    await assert.rejects(f.service.save('password-reset', null, { ...input(), ...patch }, request()), { code: 'INVALID_INPUT' });
  }
  for (const patch of [{ html: '<p>{Validade}</p>' }, { subject: '{LigacaoRecuperacao}' }, { html: input().html + '{Organizacao}' }]) {
    await assert.rejects(f.service.save('password-reset', null, { ...input(), ...patch }, request()), { code: 'EMAIL_TEMPLATE_INVALID' });
  }
  assert.equal(f.sent.length, 0);
});

test('preview uses only example link/duration, sanitized markup and platform logo without publication', async () => {
  const f = fixture();
  const result = await f.service.preview('password-reset', null, { ...DEFAULT_PASSWORD_RESET, html: DEFAULT_PASSWORD_RESET.html + '<img src="https://foreign.invalid/">' }, request());
  for (const part of [result.html, result.text]) {
    assert.ok(part.includes('https://exemplo.invalid/recuperacao-de-exemplo'));
    assert.ok(part.includes('15 minutos (exemplo)'));
    assert.ok(!part.includes('foreign.invalid'));
  }
  assert.ok(result.html.includes('alt="C4G"'));
  assert.deepEqual(result.removed, ['img']);
  assert.equal(f.reads(), 0);
  assert.equal(f.sent.length, 0);
});

test('native test sending is explicitly unavailable and invokes no provider', async () => {
  const f = fixture();
  await assert.rejects(f.service.test('password-reset', null, {}, request()), { code: 'EMAIL_DELIVERY_UNAVAILABLE' });
  assert.equal(f.reads(), 0);
  assert.equal(f.sent.length, 0);
});

test('provider failure is bounded and never reports a saved template or retries mutation', async () => {
  const f = fixture();
  let calls = 0;
  f.publisher.publish = async () => { calls += 1; throw new Error('secret SMTP token reset-link'); };
  await assert.rejects(f.service.save('password-reset', null, input(), request()), error => {
    assert.deepEqual(publicError(error), { status: 503, body: { code: 'EMAIL_PUBLISH_UNAVAILABLE' } });
    assert.equal(error.message, 'EMAIL_PUBLISH_UNAVAILABLE');
    return true;
  });
  assert.equal(calls, 1);
  for (const code of ['STALE_REVISION', 'IDEMPOTENCY_CONFLICT', 'EMAIL_PUBLICATION_DRIFT']) {
    f.publisher.publish = async () => { throw Object.assign(new Error('raw private detail'), { code }); };
    await assert.rejects(f.service.save('password-reset', null, input(), request()), { code });
  }
});

test('mismatched upstream state and source/message drift fail closed', async () => {
  const f = fixture();
  await f.service.save('password-reset', null, input(), request());
  f.state().messages.passwordResetBody = 'tampered';
  await assert.rejects(f.service.template('password-reset', null, request()), { code: 'EMAIL_PUBLICATION_DRIFT' });
  assert.equal((await f.service.types(request())).items.at(-1).configurable, false);
  const other = fixture();
  const publish = other.publisher.publish;
  other.publisher.publish = async payload => ({ ...await publish(payload), revision: 55 });
  await assert.rejects(other.service.save('password-reset', null, input(), request()), { code: 'EMAIL_PUBLISH_UNAVAILABLE' });
});

test('incomplete composition and unsafe public origins are refused', () => {
  assert.throws(() => createAuthenticationEmailService({}), TypeError);
});
