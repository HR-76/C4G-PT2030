'use strict';

const { validateTemplate } = require('./render');
const { htmlToText } = require('./text');
const { escapeHtml, fail } = require('./contracts');

const DEFAULT_PASSWORD_RESET = Object.freeze({
  subject: 'Recupere o acesso à C4G',
  html: '<p>{Logotipo}</p><p>Recebemos um pedido para alterar a palavra-passe da sua conta C4G.</p>'
    + '<p><a href="{LigacaoRecuperacao}">Definir uma nova palavra-passe</a></p>'
    + '<p>Esta ligação é de uso único e é válida durante {Validade}.</p>'
    + '<p>Se não fez este pedido, ignore este email. A sua palavra-passe mantém-se.</p>'
});

// Quote literal segments for java.text.MessageFormat. Administrators cannot
// introduce positional arguments, choice formats or unmatched apostrophes.
function literal(value) {
  return value ? `'${value.replace(/'/g, "''")}'` : '';
}

function messageFormat(value, logo = '') {
  const variable = /\{(LigacaoRecuperacao|Validade|Logotipo)\}/g;
  let result = '', pending = '', position = 0;
  for (const match of value.matchAll(variable)) {
    pending += value.slice(position, match.index);
    if (match[1] === 'Logotipo') {
      pending += logo;
    } else {
      result += literal(pending) + (match[1] === 'LigacaoRecuperacao' ? '{0}' : '{3}');
      pending = '';
    }
    position = match.index + match[0].length;
  }
  return result + literal(pending + value.slice(position));
}

// Pure preparation only: no realm credentials, persistence or provider calls.
// Matches the native Keycloak 26.8.0 password-reset.ftl parameter order:
// 0 link, 1 minutes, 2 realmName, 3 linkExpirationFormatter(minutes).
function compilePasswordReset(template = DEFAULT_PASSWORD_RESET, { logoUrl = null } = {}) {
  const checked = validateTemplate(template, 'password-reset');
  let logo = '';
  if (logoUrl !== null) {
    let url;
    try { url = new URL(logoUrl); } catch { fail('EMAIL_TEMPLATE_RENDER_INVALID'); }
    if (url.protocol !== 'https:' || url.username || url.password || url.hash) fail('EMAIL_TEMPLATE_RENDER_INVALID');
    // Composition supplies the platform logo URL. It is not an editor variable value.
    logo = `<img src="${escapeHtml(url.href)}" alt="C4G">`;
  }
  return Object.freeze({
    messages: Object.freeze({
      passwordResetSubject: literal(checked.subject),
      passwordResetBody: messageFormat(htmlToText(checked.html).replace(/\{Logotipo\}/g, '').trim()),
      passwordResetBodyHtml: messageFormat(checked.html, logo)
    }),
    removed: checked.removed
  });
}

module.exports = { compilePasswordReset, DEFAULT_PASSWORD_RESET };
