'use strict';
// Entity invitation email and C4G identity on the activation pages (context/features/entity-invitation-email-and-branding.md).
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const express = require('express');
const { createEntityInvitationEmail, TEMPLATE } = require('../src/entityAdmission/invitationEmail');
const { createActivationEmail } = require('../src/platformOnboarding/activationEmail');
const { insertActivationLink } = require('../src/emailTemplates/render');
const { createActivationHttp } = require('../src/platformOnboarding/activationHttp');

const ORIGIN = 'https://app.example.test';
const EXPIRES = new Date(Date.now() + 3600000).toISOString();
const INVITATION = '7c9e6679-7425-40de-944b-e07fc1f90ae7';
const SECRET = 'ef'.repeat(32);

test('the invitation message carries the logo, the validity and a place for the link, never the link itself', async () => {
  const released = [];
  const pool = { async connect() { return { release() { released.push(true); } }; } };
  const prepare = createEntityInvitationEmail({ centralPool: pool, publicBaseUrl: ORIGIN, repository: {}, logoFor: async () => ({ url: '/api/email-logo/global-7' }) });
  const { message, template } = await prepare({ expiresAt: EXPIRES });
  assert.deepEqual(template, { source: 'DEFAULT', version: TEMPLATE.version });
  assert.equal(message.subject, 'Convite para aderir à plataforma C4G');
  assert.match(message.html, /<img[^>]+src="https:\/\/app\.example\.test\/api\/email-logo\/global-7"[^>]+alt="C4G"/);
  assert.match(message.text, /Foi convidado a registar a sua entidade na plataforma C4G\./);
  assert.match(message.text, /expira em .*Lisboa|expira em \d/);
  assert.equal(released.length, 1);
  const linked = insertActivationLink(message, ORIGIN + '/api/admission-activation#' + SECRET);
  assert(linked.html.includes('href="' + ORIGIN + '/api/admission-activation#' + SECRET + '"'));
  assert(!message.html.includes(SECRET) && !message.text.includes(SECRET));
});

test('the bundled logo is used when none is set or the lookup fails, and no image without a public HTTPS address', async () => {
  const failing = { async connect() { throw Error('private'); } };
  for (const options of [{ centralPool: failing }, { centralPool: null }, { centralPool: { async connect() { return { release() {} }; } }, logoFor: async () => ({ url: null }) },
    { centralPool: { async connect() { return { release() {} }; } }, logoFor: async () => ({ url: 'https://other.example/logo.png' }) }]) {
    const { message } = await createEntityInvitationEmail({ publicBaseUrl: ORIGIN, repository: {}, ...options })({ expiresAt: EXPIRES });
    assert.match(message.html, /src="https:\/\/app\.example\.test\/logo-c4g\.png"/);
  }
  const local = await createEntityInvitationEmail({ centralPool: null, publicBaseUrl: 'http://localhost:3000' })({ expiresAt: EXPIRES });
  assert(!local.message.html.includes('<img'));
});

test('an admission email leads to the admission page under its own idempotency namespace, a member email is unchanged', async () => {
  const sent = [];
  const fetchImpl = async (url, options) => { sent.push([url, options.headers['Idempotency-Key'], JSON.parse(options.body)]); return { ok: true, async json() { return { id: 'provider-1' }; } }; };
  const settings = { key: 'k'.repeat(32), apiKey: 'synthetic', from: 'C4G <convites@example.test>', origin: ORIGIN, fetchImpl };
  const admission = createActivationEmail({ ...settings, purpose: 'ADMISSION' }), member = createActivationEmail(settings);
  const { message } = await createEntityInvitationEmail({ centralPool: null, publicBaseUrl: ORIGIN })({ expiresAt: EXPIRES });
  assert.deepEqual(await admission.send({ invitationId: INVITATION, to: 'ana@example.invalid', secret: SECRET, expiresAt: EXPIRES, message }), { status: 'ACCEPTED' });
  assert.deepEqual(await admission.send({ invitationId: INVITATION, to: 'ana@example.invalid', secret: SECRET, expiresAt: EXPIRES }), { status: 'ACCEPTED' });
  assert.deepEqual(await member.send({ invitationId: INVITATION, to: 'ana@example.invalid', secret: SECRET, expiresAt: EXPIRES }), { status: 'ACCEPTED' });
  const [withTemplate, plain, memberPlain] = sent;
  assert.deepEqual([withTemplate[0], withTemplate[1], withTemplate[2].to, withTemplate[2].subject], ['https://api.resend.com/emails', 'entity-admission/' + INVITATION, ['ana@example.invalid'], 'Convite para aderir à plataforma C4G']);
  assert(withTemplate[2].html.includes(ORIGIN + '/api/admission-activation#' + SECRET) && !withTemplate[2].html.includes('/api/activation#'));
  assert(plain[2].text.includes(ORIGIN + '/api/admission-activation#' + SECRET) && plain[2].text.startsWith('Foi convidado a registar a sua entidade'));
  assert.deepEqual([memberPlain[1], memberPlain[2].subject], ['member-activation/' + INVITATION, 'Ative o seu acesso à C4G']);
  assert(memberPlain[2].text.includes(ORIGIN + '/api/activation#' + SECRET));
  assert.notEqual(await admission.secret({ invitationId: INVITATION }), await member.secret({ invitationId: INVITATION }), 'the two purposes never derive the same secret');
  assert.throws(() => createActivationEmail({ ...settings, purpose: 'OTHER' }), /ACTIVATION_EMAIL_PURPOSE_INVALID/);
  assert.deepEqual(await createActivationEmail({ ...settings, apiKey: '', purpose: 'ADMISSION' }).send({ invitationId: INVITATION, to: 'ana@example.invalid', secret: SECRET, expiresAt: EXPIRES }), { status: 'NOT_CONFIGURED' });
});

test('the activation pages show the C4G logo and the application title under the same security policy', async () => {
  for (const [purpose, base] of [['MEMBERSHIP', '/api/activation'], ['ADMISSION', '/api/admission-activation']]) {
    const app = express();
    app.use(base, createActivationHttp({ express, service: {}, oidc: {}, origin: ORIGIN, identityOrigin: 'https://login.example.test', bridgeSecret: 'ab'.repeat(32), purpose }).router);
    const server = http.createServer(app);
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    try {
      const page = await new Promise((resolve, reject) => http.get({ host: '127.0.0.1', port: server.address().port, path: base }, res => {
        let text = ''; res.setEncoding('utf8'); res.on('data', chunk => { text += chunk; }); res.on('end', () => resolve({ headers: res.headers, text })); }).once('error', reject));
      assert.match(page.text, /<header><img src="\/logo-c4g\.png" alt="C4G"/);
      assert.match(page.text, /<title>Oportunidades 2030<\/title>/);
      assert(!page.text.includes('Funding Platform'));
      assert.match(page.headers['content-security-policy'], /default-src 'none'; img-src 'self'; style-src 'nonce-/);
    } finally { await new Promise(resolve => server.close(resolve)); }
  }
});
