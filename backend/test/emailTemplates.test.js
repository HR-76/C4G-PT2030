'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  sanitizeBody, htmlToText, validateTemplate, renderTemplate, insertActivationLink,
  defaultTemplate, inspectLogo, ACTIVATION_LINK_MARKER, TEMPLATE_TYPES, LIMITS, LOGO_LIMITS
} = require('../src/emailTemplates');

const VALID_BODY = '<p>Olá, {Organizacao}.</p><p><a href="{LigacaoAtivacao}">Ativar</a></p><p>Expira em {Validade}.</p>';
const CONTEXT = { organizationName: 'Entidade A', expiresAt: '2026-11-13T14:30:00.000Z' };

function reasons(input) {
  try {
    validateTemplate(input);
  } catch (error) {
    assert.equal(error.code, 'EMAIL_TEMPLATE_INVALID');
    return error.reasons;
  }
  return assert.fail('template was accepted');
}

function png(width, height) {
  const header = Buffer.alloc(25);
  header.writeUInt32BE(13, 0);
  header.write('IHDR', 4, 'latin1');
  header.writeUInt32BE(width, 8);
  header.writeUInt32BE(height, 12);
  header.set([8, 6, 0, 0, 0], 16);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    header,
    Buffer.from([0, 0, 0, 0, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82])
  ]);
}

function jpeg(width, height) {
  const app0 = Buffer.concat([Buffer.from([0xff, 0xe0, 0x00, 0x10]), Buffer.alloc(14)]);
  const frame = Buffer.alloc(19);
  frame.set([0xff, 0xc0, 0x00, 0x11, 8], 0);
  frame.writeUInt16BE(height, 5);
  frame.writeUInt16BE(width, 7);
  return Buffer.concat([Buffer.from([0xff, 0xd8]), app0, frame, Buffer.from([0xff, 0xda, 0x00, 0x02, 0xff, 0xd9])]);
}

test('sanitization removes active content and reports what it removed', () => {
  const result = sanitizeBody([
    '<p onclick="steal()" style="color:red">Texto<script>alert(1)</script></p>',
    '<iframe src="https://example.test"></iframe>',
    '<img src="https://example.test/pixel.png">',
    '<form action="https://example.test"><input name="p"></form>',
    '<a href="javascript:alert(1)">um</a>',
    '<a href="http://example.test">dois</a>',
    '<a href="/relativo">três</a>',
    '<a href="https://user:pw@example.test">quatro</a>',
    '<a href="https://example.test/ok" target="_blank">cinco</a>'
  ].join(''));

  assert.equal(result.html,
    '<p>Texto</p><a>um</a><a>dois</a><a>três</a><a>quatro</a><a href="https://example.test/ok">cinco</a>');
  assert.deepEqual(result.removed,
    ['a[href]', 'a[target]', 'form', 'iframe', 'img', 'input', 'p[onclick]', 'p[style]', 'script']);
});

test('sanitization keeps the allowed formatting and the activation link variable', () => {
  const body = '<h1>Título</h1><p><strong>a</strong> <em>b</em> <u>c</u><br />d</p><ul><li>x</li></ul><ol><li>y</li></ol><p><a href="{LigacaoAtivacao}">Ativar</a></p>';
  const result = sanitizeBody(body);
  assert.equal(result.html, body);
  assert.deepEqual(result.removed, []);
});

test('text version keeps structure, links and escaped characters', () => {
  const { html } = sanitizeBody(
    '<h1>Bem-vindo</h1><p>Linha&nbsp;um<br>linha dois &lt;b&gt; &amp; fim</p>'
    + '<ul><li>A</li><li>B</li></ul><ol><li>C</li><li>D</li></ol>'
    + '<p><a href="https://example.test/a?x=1&amp;y=2">Site</a> e <a href="https://example.test/b">https://example.test/b</a></p>'
  );
  assert.equal(htmlToText(html), [
    'Bem-vindo', '', 'Linha um', 'linha dois <b> & fim', '',
    '- A', '- B', '', '1. C', '2. D', '',
    'Site: https://example.test/a?x=1&y=2 e https://example.test/b'
  ].join('\n'));
});

test('a valid template is accepted and returned sanitized', () => {
  const result = validateTemplate({ subject: '  Convite de {Organizacao}  ', html: VALID_BODY + '<script>x</script>' });
  assert.equal(result.subject, 'Convite de {Organizacao}');
  assert.equal(result.html, VALID_BODY);
  assert.deepEqual(result.removed, ['script']);
});

test('a template without the activation link or the expiry is refused', () => {
  assert.deepEqual(reasons({ subject: 'Convite', html: '<p>Olá</p>' }), [
    { code: 'REQUIRED_VARIABLE_MISSING', variable: 'LigacaoAtivacao' },
    { code: 'REQUIRED_VARIABLE_MISSING', variable: 'Validade' }
  ]);
  // The link only inside removed content does not count.
  assert.deepEqual(reasons({ subject: 'Convite', html: '<p>{Validade}</p><script>{LigacaoAtivacao}</script>' }), [
    { code: 'REQUIRED_VARIABLE_MISSING', variable: 'LigacaoAtivacao' }
  ]);
});

test('unknown variables, subject rules and limits are enforced', () => {
  assert.deepEqual(reasons({ subject: 'Olá {Nome}', html: VALID_BODY + '<p>{Email}</p>' }), [
    { code: 'UNKNOWN_VARIABLE', variable: 'Nome' },
    { code: 'UNKNOWN_VARIABLE', variable: 'Email' }
  ]);
  assert.deepEqual(reasons({ subject: 'Abra {LigacaoAtivacao}', html: VALID_BODY }), [
    { code: 'VARIABLE_NOT_ALLOWED_IN_SUBJECT', variable: 'LigacaoAtivacao' }
  ]);
  assert.deepEqual(reasons({ subject: 'Linha um\nBcc: x@example.test', html: VALID_BODY }), [{ code: 'SUBJECT_LINE_BREAK' }]);
  assert.deepEqual(reasons({ subject: '', html: VALID_BODY }), [{ code: 'SUBJECT_REQUIRED' }]);
  assert.deepEqual(reasons({ subject: 'x'.repeat(LIMITS.subject + 1), html: VALID_BODY }), [{ code: 'SUBJECT_TOO_LONG' }]);
  assert.deepEqual(reasons({ subject: 'Convite', html: 'x'.repeat(LIMITS.html + 1) }), [{ code: 'BODY_TOO_LONG' }]);
  assert.deepEqual(reasons({ subject: 'Convite', html: VALID_BODY + ACTIVATION_LINK_MARKER }), [{ code: 'RESERVED_TEXT' }]);
  assert.deepEqual(reasons({ subject: 'Convite', html: '<p> </p>' }).map(reason => reason.code),
    ['BODY_REQUIRED', 'REQUIRED_VARIABLE_MISSING', 'REQUIRED_VARIABLE_MISSING']);
  assert.deepEqual(reasons(null).map(reason => reason.code),
    ['SUBJECT_REQUIRED', 'BODY_REQUIRED', 'REQUIRED_VARIABLE_MISSING', 'REQUIRED_VARIABLE_MISSING']);
});

test('rendering escapes organization data and never treats it as markup or variables', () => {
  const rendered = renderTemplate(
    { subject: 'Convite de {Organizacao}', html: VALID_BODY },
    { ...CONTEXT, organizationName: '<b>A&B</b> "x" {LigacaoAtivacao}\r\nBcc: y' }
  );
  assert.equal(rendered.subject, 'Convite de <b>A&B</b> "x" {LigacaoAtivacao} Bcc: y');
  assert.match(rendered.html, /Olá, &lt;b&gt;A&amp;B&lt;\/b&gt; &quot;x&quot; \{LigacaoAtivacao\} Bcc: y\./);
  assert.match(rendered.text, /^Olá, <b>A&B<\/b> "x" \{LigacaoAtivacao\} Bcc: y\.$/m);
  assert.equal(rendered.html.split(ACTIVATION_LINK_MARKER).length, 2);
  assert.equal(rendered.text.split(ACTIVATION_LINK_MARKER).length, 2);
});

test('rendering formats the expiry in Lisbon time and adds the logo only when given', () => {
  const template = { subject: 'Convite', html: '{Logotipo}' + VALID_BODY };
  const without = renderTemplate(template, CONTEXT);
  assert.match(without.text, /Expira em 13 de novembro de 2026 às 14:30 \(hora de Lisboa\)\./);
  assert.doesNotMatch(without.html, /<img/);
  assert.doesNotMatch(without.text, /Logotipo/);

  const withLogo = renderTemplate(template, { ...CONTEXT, logoUrl: 'https://app.example.test/api/public/email-logos/abc' });
  assert.match(withLogo.html, /<img src="https:\/\/app\.example\.test\/api\/public\/email-logos\/abc" alt="Entidade A" /);
  assert.equal(withLogo.text, without.text);

  assert.throws(() => renderTemplate(template, { ...CONTEXT, logoUrl: 'http://app.example.test/logo' }), { code: 'EMAIL_TEMPLATE_RENDER_INVALID' });
  assert.throws(() => renderTemplate(template, { ...CONTEXT, expiresAt: 'nunca' }), { code: 'EMAIL_TEMPLATE_RENDER_INVALID' });
  assert.throws(() => renderTemplate(template, { ...CONTEXT, organizationName: ' ' }), { code: 'EMAIL_TEMPLATE_RENDER_INVALID' });
});

test('rendering re-validates the stored template', () => {
  assert.throws(() => renderTemplate({ subject: 'Convite', html: '<p>sem ligação {Validade}</p>' }, CONTEXT),
    { code: 'EMAIL_TEMPLATE_INVALID' });
});

test('the organization name cannot smuggle the link marker', () => {
  const rendered = renderTemplate({ subject: 'Convite', html: VALID_BODY },
    { ...CONTEXT, organizationName: `A ${ACTIVATION_LINK_MARKER} B` });
  assert.equal(rendered.html.split(ACTIVATION_LINK_MARKER).length, 2);
  assert.equal(rendered.text.split(ACTIVATION_LINK_MARKER).length, 2);
});

test('the activation link is inserted in both parts and required in both', () => {
  const url = 'https://app.example.test/api/activation#' + 'a'.repeat(64);
  const rendered = renderTemplate({ subject: 'Convite', html: VALID_BODY }, CONTEXT);
  const message = insertActivationLink(rendered, url);
  assert.ok(message.html.includes(`<a href="${url}">Ativar</a>`));
  assert.ok(message.text.includes(`Ativar: ${url}`));
  assert.ok(!message.html.includes(ACTIVATION_LINK_MARKER) && !message.text.includes(ACTIVATION_LINK_MARKER));

  assert.throws(() => insertActivationLink({ ...rendered, text: 'sem ligação' }, url), { code: 'EMAIL_TEMPLATE_LINK_MISSING' });
  assert.throws(() => insertActivationLink({ ...rendered, html: '<p>sem ligação</p>' }, url), { code: 'EMAIL_TEMPLATE_LINK_MISSING' });
  assert.throws(() => insertActivationLink({ ...rendered, subject: ACTIVATION_LINK_MARKER }, url), { code: 'EMAIL_TEMPLATE_LINK_INVALID' });
  assert.throws(() => insertActivationLink(rendered, 'http://app.example.test/x'), { code: 'EMAIL_TEMPLATE_LINK_INVALID' });
  assert.throws(() => insertActivationLink(null, url), { code: 'EMAIL_TEMPLATE_LINK_MISSING' });
});

test('the default invitation template is valid and says what the current email says', () => {
  const template = defaultTemplate(TEMPLATE_TYPES.MEMBER_INVITATION);
  assert.equal(template.version, 'default-1');
  assert.deepEqual(validateTemplate(template).removed, []);
  const url = 'https://app.example.test/api/activation#' + 'b'.repeat(64);
  const message = insertActivationLink(renderTemplate(template, CONTEXT), url);
  assert.equal(message.subject, 'Ative o seu acesso à C4G');
  assert.equal(message.text, [
    'Foi-lhe atribuído acesso à plataforma C4G.', '',
    'Abra a ligação para ativar o acesso e definir a sua palavra-passe. Se já tem conta, entre com a sua palavra-passe atual.', '',
    `Ativar acesso: ${url}`, '',
    'Esta ligação é de uso único e expira em 13 de novembro de 2026 às 14:30 (hora de Lisboa).'
  ].join('\n'));
  assert.throws(() => defaultTemplate('OUTRO'), { code: 'EMAIL_TEMPLATE_TYPE_UNKNOWN' });
});

test('logo inspection accepts PNG and JPEG by content and reads their size', () => {
  const pngInfo = inspectLogo(png(600, 200));
  assert.deepEqual({ mime: pngInfo.mime, width: pngInfo.width, height: pngInfo.height }, { mime: 'image/png', width: 600, height: 200 });
  assert.match(pngInfo.sha256, /^[a-f0-9]{64}$/);
  assert.equal(pngInfo.size, png(600, 200).length);

  const jpegInfo = inspectLogo(jpeg(1200, 600));
  assert.deepEqual({ mime: jpegInfo.mime, width: jpegInfo.width, height: jpegInfo.height }, { mime: 'image/jpeg', width: 1200, height: 600 });
});

test('logo inspection refuses other content, truncated files and oversized images', () => {
  const invalid = { code: 'EMAIL_LOGO_INVALID' };
  assert.throws(() => inspectLogo(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>1</script></svg>')), invalid);
  assert.throws(() => inspectLogo(Buffer.from('GIF89a')), invalid);
  assert.throws(() => inspectLogo(Buffer.alloc(0)), invalid);
  assert.throws(() => inspectLogo('not a buffer'), invalid);
  assert.throws(() => inspectLogo(png(600, 200).subarray(0, 30)), invalid);
  assert.throws(() => inspectLogo(jpeg(600, 200).subarray(0, 30)), invalid);
  assert.throws(() => inspectLogo(png(0, 200)), invalid);
  assert.throws(() => inspectLogo(png(LOGO_LIMITS.width + 1, 200)), { code: 'EMAIL_LOGO_DIMENSIONS' });
  assert.throws(() => inspectLogo(jpeg(600, LOGO_LIMITS.height + 1)), { code: 'EMAIL_LOGO_DIMENSIONS' });
  assert.throws(() => inspectLogo(Buffer.concat([png(600, 200), Buffer.alloc(LOGO_LIMITS.bytes)])), { code: 'EMAIL_LOGO_TOO_LARGE' });
});
