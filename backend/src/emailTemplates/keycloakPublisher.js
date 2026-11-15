'use strict';

// Narrow transport to the C4G Keycloak extension. It never calls /admin or
// accepts a caller-selected endpoint, client, realm, locale or SMTP setting.
const CLIENT_ID = 'c4g-email-templates';
const MAX_BYTES = 256 * 1024;
const TOKEN_MAX_BYTES = 64 * 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MESSAGE_KEYS = Object.freeze(['passwordResetSubject', 'passwordResetBody', 'passwordResetBodyHtml']);
const STATE_KEYS = Object.freeze(['revision', 'configured', 'action', 'actorId', 'updatedAt', 'template', 'messages', 'logoUrl']);
const INPUT_KEYS = Object.freeze(['action', 'expectedRevision', 'idempotencyKey', 'actorId', 'template', 'messages', 'logoUrl']);
const ERROR_STATUS = Object.freeze({ STALE_REVISION: 409, IDEMPOTENCY_CONFLICT: 409, EMAIL_PUBLICATION_DRIFT: 409, INVALID_INPUT: 400 });
const PUBLIC_FAILURE = Symbol('emailPublisherFailure');

function fail(code = 'EMAIL_PUBLISH_UNAVAILABLE') {
  throw Object.assign(new Error(code), { code, [PUBLIC_FAILURE]: true });
}

function objectWithKeys(value, keys) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype
    && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
}

function validLogo(value) {
  if (value === null) return true;
  if (typeof value !== 'string' || value.length > 2048) return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password && !url.hash && url.href === value;
  } catch { return false; }
}

function validContent(value) {
  return objectWithKeys(value.template, ['subject', 'html'])
    && typeof value.template.subject === 'string' && value.template.subject.length > 0 && value.template.subject.length <= 200
    && !/[\u0000-\u001f\u007f]/.test(value.template.subject)
    && typeof value.template.html === 'string' && value.template.html.length > 0 && value.template.html.length <= 20000
    && objectWithKeys(value.messages, MESSAGE_KEYS)
    && MESSAGE_KEYS.every(key => typeof value.messages[key] === 'string' && value.messages[key].length > 0 && value.messages[key].length <= 100000)
    && value.messages.passwordResetSubject.length <= 402
    && !/[\u0000-\u001f\u007f]/.test(value.messages.passwordResetSubject)
    && validLogo(value.logoUrl);
}

function validateState(value) {
  if (objectWithKeys(value, ['revision', 'configured']) && value.revision === 0 && value.configured === false) {
    return Object.freeze({ revision: 0, configured: false });
  }
  if (!objectWithKeys(value, STATE_KEYS) || value.configured !== true
      || !Number.isInteger(value.revision) || value.revision < 1 || value.revision > 2147483646
      || !['SAVE', 'RESET'].includes(value.action) || typeof value.actorId !== 'string' || !UUID.test(value.actorId)
      || typeof value.updatedAt !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,9})?Z$/.test(value.updatedAt)
      || !Number.isFinite(Date.parse(value.updatedAt)) || !validContent(value)) fail();
  return Object.freeze({
    revision: value.revision, configured: true, action: value.action, actorId: value.actorId, updatedAt: value.updatedAt,
    template: Object.freeze({ subject: value.template.subject, html: value.template.html }),
    messages: Object.freeze(Object.fromEntries(MESSAGE_KEYS.map(key => [key, value.messages[key]]))),
    logoUrl: value.logoUrl
  });
}

function validateInput(value) {
  if (!objectWithKeys(value, INPUT_KEYS) || !['SAVE', 'RESET'].includes(value.action)
      || !Number.isInteger(value.expectedRevision) || value.expectedRevision < 0 || value.expectedRevision > 2147483645
      || typeof value.idempotencyKey !== 'string' || !UUID.test(value.idempotencyKey)
      || typeof value.actorId !== 'string' || !UUID.test(value.actorId) || !validContent(value)) fail('INVALID_INPUT');
  const body = JSON.stringify(value);
  if (Buffer.byteLength(body, 'utf8') > MAX_BYTES) fail('INVALID_INPUT');
  return body;
}

function issuerUrl(issuer, allowLoopbackHttp) {
  let url;
  try { url = new URL(issuer); } catch { throw new TypeError('Email publisher issuer is invalid.'); }
  const local = ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname);
  if (typeof issuer !== 'string' || url.href !== issuer || url.username || url.password || url.search || url.hash
      || !/^\/(?:[A-Za-z0-9_-]+\/)*realms\/[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(url.pathname)
      || url.pathname.split('/').includes('admin')
      || !(url.protocol === 'https:' || (allowLoopbackHttp === true && local && url.protocol === 'http:'))) {
    throw new TypeError('Email publisher issuer is invalid.');
  }
  return url.href;
}

async function jsonBody(response, limit) {
  const type = response.headers.get('content-type') || '';
  const length = response.headers.get('content-length');
  if (!/^application\/json(?:\s*;|$)/i.test(type) || (length !== null && (!/^\d+$/.test(length) || Number(length) > limit))) {
    try { await response.body?.cancel(); } catch { /* do not expose transport details */ }
    fail();
  }
  if (!response.body || typeof response.body.getReader !== 'function') fail();
  const reader = response.body.getReader(), chunks = [];
  let bytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > limit) {
        try { await reader.cancel(); } catch { /* the fixed failure below wins */ }
        fail();
      }
      chunks.push(Buffer.from(value));
    }
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks, bytes)));
  } finally {
    reader.releaseLock();
  }
}

function createKeycloakPublisher({ issuer, clientSecret, allowLoopbackHttp = false, fetchImpl = globalThis.fetch, timeoutMs = 10000 }) {
  const base = issuerUrl(issuer, allowLoopbackHttp);
  if (typeof clientSecret !== 'string' || !clientSecret.trim() || clientSecret.length > 4096 || /[\u0000-\u001f\u007f]/.test(clientSecret)
      || typeof fetchImpl !== 'function' || !Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30000) {
    throw new TypeError('Email publisher configuration is invalid.');
  }
  const endpoint = base + '/c4g-email-templates/password-reset';

  async function request(method, body) {
    try {
      // One deadline covers authentication, publication and all response bytes.
      const signal = AbortSignal.timeout(timeoutMs);
      const tokenResponse = await fetchImpl(base + '/protocol/openid-connect/token', {
        method: 'POST', redirect: 'error', signal,
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
        body: new URLSearchParams({ grant_type: 'client_credentials', client_id: CLIENT_ID, client_secret: clientSecret }).toString()
      });
      if (tokenResponse.status !== 200) {
        try { await tokenResponse.body?.cancel(); } catch { /* credentials and provider errors stay private */ }
        fail();
      }
      const token = await jsonBody(tokenResponse, TOKEN_MAX_BYTES);
      if (!token || typeof token.access_token !== 'string' || !token.access_token || token.access_token.length > 32000
          || /\s/.test(token.access_token) || typeof token.token_type !== 'string' || token.token_type.toLowerCase() !== 'bearer') fail();
      const response = await fetchImpl(endpoint, {
        method, redirect: 'error', signal,
        headers: { Authorization: 'Bearer ' + token.access_token, Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}) },
        ...(body ? { body } : {})
      });
      const result = await jsonBody(response, MAX_BYTES);
      if (response.status !== 200) {
        if (objectWithKeys(result, ['code']) && Object.hasOwn(ERROR_STATUS, result.code) && response.status === ERROR_STATUS[result.code]) fail(result.code);
        fail();
      }
      return validateState(result);
    } catch (error) {
      if (error?.[PUBLIC_FAILURE] && Object.hasOwn(ERROR_STATUS, error.code)) fail(error.code);
      fail();
    }
  }

  return Object.freeze({
    read: () => request('GET'),
    async publish(payload) {
      const body = validateInput(payload);
      const intention = JSON.parse(body);
      // A lost PUT response is ambiguous. Never retry it automatically or
      // announce success; the same persisted intention can be retried by caller.
      const state = await request('PUT', body);
      if (!state.configured || state.revision !== intention.expectedRevision + 1 || state.action !== intention.action
          || state.actorId.toLowerCase() !== intention.actorId.toLowerCase() || state.logoUrl !== intention.logoUrl
          || state.template.subject !== intention.template.subject || state.template.html !== intention.template.html
          || MESSAGE_KEYS.some(key => state.messages[key] !== intention.messages[key])) fail();
      return state;
    }
  });
}

function configuredKeycloakPublisher({ env, issuer }) {
  const mode = env.EMAIL_AUTHENTICATION_RUNTIME || 'disabled';
  if (mode === 'disabled') return null;
  if (mode !== 'keycloak-restricted-v1') throw new TypeError('Email authentication runtime is invalid.');
  return createKeycloakPublisher({
    // loadAuthConfig supplies a URL; the transport still validates its exact href.
    issuer: issuer instanceof URL ? issuer.href : issuer, clientSecret: env.EMAIL_AUTHENTICATION_CLIENT_SECRET,
    allowLoopbackHttp: env.NODE_ENV !== 'production'
  });
}

module.exports = { createKeycloakPublisher, configuredKeycloakPublisher, CLIENT_ID, MAX_BYTES };
