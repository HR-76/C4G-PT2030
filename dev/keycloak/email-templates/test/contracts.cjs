'use strict';

// Pure compiler parity against production Node compilation; no SMTP/database.
const { spawnSync } = require('node:child_process');
const { mkdirSync } = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../../../..');
const { validateTemplate } = require(path.join(root, 'backend/src/emailTemplates/render'));
const { compilePasswordReset, DEFAULT_PASSWORD_RESET } = require(path.join(root, 'backend/src/emailTemplates/keycloakPasswordReset'));
const jdk = 'C:/Program Files/Java/jdk-23/bin';
const build = path.join(root, '.tmp/email-templates-build');
const testClasses = path.join(build, 'test-classes');
mkdirSync(testClasses, { recursive: true });
const classpath = [path.join(build, 'libraries/*'), path.join(build, 'classes'), testClasses].join(path.delimiter);
const compile = spawnSync(path.join(jdk, 'javac.exe'), ['--release', '21', '-encoding', 'UTF-8', '-classpath', classpath,
  '-d', testClasses, path.join(__dirname, '../src/test/java/pt/c4g/email/ContractProbe.java')], { encoding: 'utf8' });
if (compile.status !== 0) throw new Error(compile.stderr || 'javac unavailable');
function envelope(template = DEFAULT_PASSWORD_RESET, logoUrl = null) {
  const checked = validateTemplate(template, 'password-reset');
  return { action: 'SAVE', expectedRevision: 0, idempotencyKey: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    actorId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', template: { subject: checked.subject, html: checked.html },
    messages: compilePasswordReset(checked, { logoUrl }).messages, logoUrl };
}
const base = envelope();
const fixtures = [];
const valid = (name, input, flags = {}) => fixtures.push({ name, input, accepted: true, ...flags });
const invalid = (name, alter) => { const input = structuredClone(base); alter(input); fixtures.push({ name, input, accepted: false }); };
valid('default source and three native messages', base, { canonicalDigest: true });
valid('uppercase UUID has same digest', { ...base, idempotencyKey: base.idempotencyKey.toUpperCase(), actorId: base.actorId.toUpperCase() }, { sameDigest: true });
valid('reset canonical source', { ...base, action: 'RESET' });
valid('logo escaped HTTPS path and query', envelope(DEFAULT_PASSWORD_RESET, 'https://assets.example.test/brand/logo.png?x=1&y=2'));
valid('quotes braces and Unicode', envelope({ subject: "C4G d'Água {0,choice,evil}", html: "<p>Olá d'Água &amp; &lt;texto&gt; {0} {0,choice,evil} 😀</p><p>{LigacaoRecuperacao} {Validade}</p>" }));
valid('nested lists links br marks', envelope({ subject: 'Lista', html: '<h2>Olá</h2><ol><li><strong>Um</strong></li><li>Dois<ul><li><em>Dentro</em></li></ul></li></ol><p><a href="{LigacaoRecuperacao}">Entrar</a><br><u>{Validade}</u><br /></p><p><a href="https://example.test/path?x=1&amp;y=2">Ajuda</a></p>' }));
valid('same label and empty link', envelope({ subject: 'Links', html: '<p><a href="{LigacaoRecuperacao}">{LigacaoRecuperacao}</a> <a href="https://example.test"></a> {Validade}</p>' }));
valid('HTML already sanitized by Node', envelope({ subject: 'Sanitizado', html: '<p style="color:red">Texto<script>bad()</script><img src=x>{LigacaoRecuperacao} {Validade}</p>' }));
valid('NBSP BOM and Unicode whitespace parity', envelope({ subject: '\ufeff Olá \u00a0', html: '<p> \ufeffOlá&nbsp;\u0085\u202f mundo\u2007 </p><p>{LigacaoRecuperacao}\ufeff{Validade}</p>' }));
invalid('altered subject cannot diverge from source', i => { i.messages.passwordResetSubject = "'Outra mensagem'"; });
invalid('altered body cannot lose link', i => { i.messages.passwordResetBody = 'no-link'; });
invalid('altered HTML cannot diverge from source', i => { i.messages.passwordResetBodyHtml += "' extra'"; });
invalid('unclosed MessageFormat rejected', i => { i.messages.passwordResetBody = '{0'; });
invalid('generic SMTP field rejected', i => { i.smtpServer = { host: 'invalid.test' }; });
invalid('unknown locale rejected', i => { i.locale = 'pt'; });
invalid('unknown nested field rejected', i => { i.template.extra = 'value'; });
invalid('noncanonical reset source rejected', i => { Object.assign(i, envelope({ subject: 'Custom', html: '<p>{LigacaoRecuperacao} {Validade}</p>' })); i.action = 'RESET'; });
invalid('unsafe HTML rejected', i => { i.template.html = '<script>bad()</script>' + i.template.html; });
invalid('negative revision rejected', i => { i.expectedRevision = -1; });
invalid('fractional revision rejected', i => { i.expectedRevision = 0.5; });
invalid('exhausted revision rejected', i => { i.expectedRevision = 2147483646; });
invalid('null actor rejected', i => { i.actorId = null; });
invalid('plaintext logo rejected', i => { i.logoUrl = 'http://example.test/logo.png'; });
invalid('oversized source rejected', i => { i.template.html = 'x'.repeat(20001); });
fixtures.push({ name: 'duplicate JSON keys rejected', raw: JSON.stringify(base).replace('"action":"SAVE"', '"action":"SAVE","action":"RESET"'), accepted: false });
fixtures.push({ name: 'trailing JSON rejected', raw: JSON.stringify(base) + '{}', accepted: false });
fixtures.push({ name: 'input byte ceiling', raw: ' '.repeat(262145), accepted: false });
const result = spawnSync(path.join(jdk, 'java.exe'), ['-Dfile.encoding=UTF-8', '-classpath', classpath, 'pt.c4g.email.ContractProbe'],
  { input: JSON.stringify(fixtures), encoding: 'utf8', maxBuffer: 1024 * 1024 });
process.stdout.write(result.stdout || '');
if (result.status !== 0) { process.stderr.write(result.stderr || 'Java probe failed'); process.exitCode = 1; }
