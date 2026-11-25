'use strict';
// The email that carries an entity invitation to its first administrator.
// Contract: context/features/entity-invitation-email-and-branding.md. The wording lives in code: editable templates are
// limited by a Central constraint to the member invitation, and no entity exists yet to own a template.
const { renderTemplate } = require('../emailTemplates/render');

const TEMPLATE = Object.freeze({
  version: 'entity-invitation-1',
  subject: 'Convite para aderir à plataforma C4G',
  html: [
    '<p>{Logotipo}</p>',
    '<p>Foi convidado a registar a sua entidade na plataforma C4G.</p>',
    '<p>Abra a ligação para aceitar o convite, definir a sua palavra-passe e preencher a ficha da entidade. Se já tem conta, entre com a sua palavra-passe atual.</p>',
    '<p><a href="{LigacaoAtivacao}">Aceitar convite</a></p>',
    '<p>Esta ligação é de uso único e expira em {Validade}.</p>'
  ].join('')
});

// Returns prepare({ expiresAt }) -> { message, template }. The message still holds a marker instead of the link: only the
// worker that sends it ever sees the link. The logo is the one set in Administração, or the bundled file.
function createEntityInvitationEmail({ centralPool, publicBaseUrl, repository = null,
  logoFor = (repo, client) => require('../emailTemplates/logoService').logoForScope(repo, client, null) }) {
  let origin = null;
  try {
    const url = new URL(publicBaseUrl);
    if (url.protocol === 'https:' && !url.username && !url.password) origin = url.origin;
  } catch { /* Without a public HTTPS address the email carries no image. */ }
  async function logoPath() {
    if (!centralPool) return '/logo-c4g.png';
    let client;
    try {
      client = await centralPool.connect();
      const logo = await logoFor(repository || require('../emailTemplates/repository').createEmailTemplateRepository(), client);
      return typeof logo?.url === 'string' && logo.url.startsWith('/') ? logo.url : '/logo-c4g.png';
    } catch { return '/logo-c4g.png'; } finally { client?.release(); }
  }
  return async function prepare({ expiresAt }) {
    const message = renderTemplate(TEMPLATE, { organizationName: 'C4G', expiresAt,
      logoUrl: origin ? origin + await logoPath() : null, logoAlt: 'C4G' });
    return { message, template: { source: 'DEFAULT', version: TEMPLATE.version } };
  };
}

module.exports = { createEntityInvitationEmail, TEMPLATE };
