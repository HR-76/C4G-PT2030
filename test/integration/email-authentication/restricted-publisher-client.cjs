'use strict';

// Integration driver only. Secrets arrive on stdin and never in argv, files or
// errors. Python captures stdout in memory; the driver never sends an email.
const { configuredKeycloakPublisher } = require('../../../backend/src/emailTemplates/keycloakPublisher');
const { createAuthenticationEmailService } = require('../../../backend/src/emailTemplates/authenticationService');
const { compilePasswordReset, DEFAULT_PASSWORD_RESET } = require('../../../backend/src/emailTemplates/keycloakPasswordReset');
const { validateTemplate } = require('../../../backend/src/emailTemplates/render');

const ACTOR = 'b846ff11-9542-489e-b2bb-55da6f413c5c';
const SESSION = 'restricted-email-probe-session';
const CODES = new Set(['INVALID_INPUT', 'C4G_ADMIN_REQUIRED', 'RESOURCE_NOT_AVAILABLE', 'STALE_REVISION',
  'IDEMPOTENCY_CONFLICT', 'EMAIL_PUBLICATION_DRIFT', 'EMAIL_PUBLISH_UNAVAILABLE', 'EMAIL_TEMPLATE_INVALID', 'EMAIL_DELIVERY_UNAVAILABLE']);

async function run(input) {
  if (input.operation === 'prepare') {
    const checked = validateTemplate(input.template || DEFAULT_PASSWORD_RESET, 'password-reset');
    const template = { subject: checked.subject, html: checked.html };
    return { template, messages: compilePasswordReset(template, { logoUrl: input.logoUrl ?? null }).messages, removed: checked.removed };
  }
  const publisher = configuredKeycloakPublisher({ env: {
    NODE_ENV: 'test', EMAIL_AUTHENTICATION_RUNTIME: 'keycloak-restricted-v1',
    EMAIL_AUTHENTICATION_CLIENT_SECRET: input.clientSecret
  }, issuer: new URL(input.issuer) });
  if (input.operation === 'read') return publisher.read();
  if (input.operation === 'publish') return publisher.publish(input.payload);

  const baseService = Object.fromEntries(['types', 'template', 'save', 'reset', 'preview', 'test'].map(name => [name,
    async () => name === 'types' ? { items: [{ type: 'member-invitation', globalCustomized: false, organizations: 0 }] }
      : Promise.reject(Object.assign(new Error('INVALID_INPUT'), { code: 'INVALID_INPUT' }))]));
  const client = {
    async query(sql) {
      if (!['BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY', 'COMMIT', 'ROLLBACK'].includes(sql)) throw new Error('UNEXPECTED_QUERY');
      return { rows: [] };
    },
    release() {}
  };
  const repository = {
    async isPlatformAdmin(_client, sessionId, actorId) {
      return input.authorized !== false && sessionId === SESSION && actorId === ACTOR;
    },
    async latestLogo() { return null; },
    async recipient(_client, actorId) { return actorId === ACTOR ? 'admin@capture.invalid' : null; }
  };
  const service = createAuthenticationEmailService({ baseService, centralPool: { async connect() { return client; } },
    publisher, repository, publicBaseUrl: 'https://platform.invalid' });
  const request = { user: { id: ACTOR }, authContext: { sessionId: SESSION }, sessionID: SESSION };
  if (input.operation === 'types') return service.types(request);
  if (input.operation === 'service-template') return service.template('password-reset', null, request);
  if (input.operation === 'save') return service.save('password-reset', null, input.body, request);
  if (input.operation === 'reset') return service.reset('password-reset', null, input.body, request);
  throw Object.assign(new Error('INVALID_INPUT'), { code: 'INVALID_INPUT' });
}

(async () => {
  try {
    const chunks = [];
    let length = 0;
    for await (const chunk of process.stdin) {
      length += chunk.length;
      if (length > 512 * 1024) throw new Error('INPUT_LIMIT');
      chunks.push(chunk);
    }
    const input = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    const value = await run(input);
    process.stdout.write(JSON.stringify({ ok: true, value }));
  } catch (error) {
    process.stdout.write(JSON.stringify({ ok: false, code: CODES.has(error?.code) ? error.code : 'EMAIL_PUBLISH_UNAVAILABLE' }));
  }
})();
