'use strict';

const { spawnSync } = require('node:child_process');
const path = require('node:path');
const { compilePasswordReset } = require('../../../backend/src/emailTemplates/keycloakPasswordReset');
const link = 'https://example.invalid/reset?token=EXAMPLE&client=EXAMPLE';
const args = [link, '15', 'C4G', '15 minutos'];
const fixtures = [];
for (const literal of ["d'água", '{} {0} {1,choice,0#x}', "'{0}'", 'ação & informação']) {
  const result = compilePasswordReset({
    subject: literal,
    html: `<p>${literal}</p><p><a href="{LigacaoRecuperacao}">Recuperar</a></p><p>{Validade}</p>`
  }).messages;
  fixtures.push([result.passwordResetSubject, literal, ...args]);
  fixtures.push([result.passwordResetBody, `${literal}\n\nRecuperar: ${link}\n\n15 minutos`, ...args]);
}
const logo = compilePasswordReset({ subject: 'C4G', html: '<p>{Logotipo}{Logotipo}</p><p>{LigacaoRecuperacao} {Validade}</p>' }, {
  logoUrl: 'https://example.invalid/logo.png'
}).messages;
fixtures.push([logo.passwordResetBodyHtml,
  `<p><img src="https://example.invalid/logo.png" alt="C4G"><img src="https://example.invalid/logo.png" alt="C4G"></p><p>${link} 15 minutos</p>`, ...args]);
const input = fixtures.map(row => row.map(value => Buffer.from(value).toString('base64')).join('\t')).join('\n') + '\n';
const result = spawnSync(process.env.C4G_EMAIL_JAVA || 'java', [path.join(__dirname, 'MessageFormatProbe.java')], {
  input, encoding: 'utf8', timeout: 30000, windowsHide: true
});
if (result.status !== 0) {
  process.stderr.write('MessageFormat probe failed or Java JDK is unavailable.\n');
  process.exitCode = 1;
} else {
  process.stdout.write(result.stdout);
}
