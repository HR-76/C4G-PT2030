'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const { compilePasswordReset, DEFAULT_PASSWORD_RESET } = require('../src/emailTemplates/keycloakPasswordReset');
const { validateTemplate } = require('../src/emailTemplates/render');

const body = '<p><a href="{LigacaoRecuperacao}">Recuperar</a></p><p>{Validade}</p>';
const input = html => ({ subject: 'Recuperar acesso', html });
const invalid = fn => assert.throws(fn, error => error.code === 'EMAIL_TEMPLATE_INVALID');

test('compiles only the native password reset keys and uses Keycloak formatted duration', () => {
  const { messages, removed } = compilePasswordReset(input(body));
  assert.deepEqual(Object.keys(messages), ['passwordResetSubject', 'passwordResetBody', 'passwordResetBodyHtml']);
  assert.equal(messages.passwordResetSubject, "'Recuperar acesso'");
  assert.equal(messages.passwordResetBody, "'Recuperar: '{0}'\n\n'{3}");
  assert.equal(messages.passwordResetBodyHtml, "'<p><a href=\"'{0}'\">Recuperar</a></p><p>'{3}'</p>'");
  assert.deepEqual(removed, []);
});

test('built-in wording contains link and validity in both parts, with no real secret', () => {
  const { messages } = compilePasswordReset();
  for (const part of [messages.passwordResetBody, messages.passwordResetBodyHtml]) {
    assert.ok(part.includes('{0}'));
    assert.ok(part.includes('{3}'));
    assert.ok(!part.includes('https://'));
    assert.ok(!part.includes('{Logotipo}'));
  }
  assert.equal(DEFAULT_PASSWORD_RESET.subject, 'Recupere o acesso à C4G');
});

test('requires link and duration even if a script or attribute contained them', () => {
  for (const html of ['<p>{Validade}</p>', '<p>{LigacaoRecuperacao}</p>',
    '<script>{LigacaoRecuperacao}</script><p>{Validade}</p>',
    '<p title="{LigacaoRecuperacao}">{Validade}</p>']) {
    invalid(() => compilePasswordReset(input(html)));
  }
});

test('reset variables cannot leak into invitations, or vice versa', () => {
  invalid(() => validateTemplate(input(body)));
  for (const variable of ['Organizacao', 'LigacaoAtivacao', 'Codigo', 'unknown']) {
    invalid(() => compilePasswordReset(input(body + `<p>{${variable}}</p>`)));
  }
  invalid(() => compilePasswordReset({ subject: '{Validade}', html: body }));
  assert.throws(() => validateTemplate(input(body), 'email-code'), { code: 'EMAIL_TEMPLATE_TYPE_UNKNOWN' });
});

test('sanitizes active content, foreign images and URL credentials before compilation', () => {
  const { messages, removed } = compilePasswordReset(input(body
    + '<script>alert(1)</script><img src="https://foreign.invalid/tracker">'
    + '<a href="https://user:secret@example.invalid" onclick="alert(1)">Unsafe</a>'));
  assert.ok(removed.includes('script'));
  assert.ok(removed.includes('img'));
  assert.ok(removed.includes('a[href]'));
  assert.ok(!/script|alert|secret|foreign/.test(messages.passwordResetBodyHtml));
});

test('quotes positional arguments, braces and apostrophes as literal MessageFormat text', () => {
  const { messages } = compilePasswordReset({ subject: "C4G d'água {0} {}", html: body + "<p>d'água {0,choice,0#x} {}</p>" });
  assert.equal(messages.passwordResetSubject, "'C4G d''água {0} {}'");
  assert.ok(messages.passwordResetBody.endsWith("'\n\nd''água {0,choice,0#x} {}'"));
});

test('logo is only composed from HTTPS input, escaped, with no image in text', () => {
  const { messages } = compilePasswordReset(input('<p>{Logotipo}{Logotipo}</p>' + body), {
    logoUrl: 'https://c4g.example/logo.png?a=1&b=2'
  });
  assert.ok(messages.passwordResetBodyHtml.includes('src="https://c4g.example/logo.png?a=1&amp;b=2" alt="C4G"'));
  assert.ok(!messages.passwordResetBody.includes('logo.png'));
  for (const logoUrl of ['http://c4g.example/logo.png', 'https://user:password@c4g.example/logo.png', 'javascript:alert(1)', 'https://c4g.example/logo.png#x']) {
    assert.throws(() => compilePasswordReset(undefined, { logoUrl }), { code: 'EMAIL_TEMPLATE_RENDER_INVALID' });
  }
});

test('refuses multiline subject, excessive bodies and empty input', () => {
  invalid(() => compilePasswordReset({ subject: 'Reset\r\nBcc: x', html: body }));
  invalid(() => compilePasswordReset(input(body + 'x'.repeat(20001))));
  invalid(() => compilePasswordReset({}));
});

test('local preparation exports native JSON without remote access', () => {
  const result = spawnSync(process.execPath, [path.join(__dirname, '../scripts/staging/preparePasswordResetEmail.js')], { encoding: 'utf8', timeout: 10000 });
  assert.equal(result.status, 0);
  assert.equal(result.stderr, '');
  assert.deepEqual(JSON.parse(result.stdout), compilePasswordReset().messages);
});

test('local preparation reports a fixed error instead of file paths or input content', () => {
  const result = spawnSync(process.execPath, [path.join(__dirname, '../scripts/staging/preparePasswordResetEmail.js'), 'missing-secret-file.json'], { encoding: 'utf8', timeout: 10000 });
  assert.equal(result.status, 1);
  assert.equal(result.stdout, '');
  assert.ok(!result.stderr.includes('missing-secret-file'));
});
