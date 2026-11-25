'use strict';

const { TEMPLATE_TYPES } = require('./contracts');

// Built-in templates, used while no GLOBAL template has been saved. They live
// in code, not in the database, and carry their own version so a send can
// record exactly which wording went out.
const DEFAULTS = Object.freeze({
  [TEMPLATE_TYPES.MEMBER_INVITATION]: Object.freeze({
    version: 'default-1',
    subject: 'Ative o seu acesso à C4G',
    html: [
      '<p>{Logotipo}</p>',
      '<p>Foi-lhe atribuído acesso à plataforma C4G.</p>',
      '<p>Abra a ligação para ativar o acesso e definir a sua palavra-passe. Se já tem conta, entre com a sua palavra-passe atual.</p>',
      '<p><a href="{LigacaoAtivacao}">Ativar acesso</a></p>',
      '<p>Esta ligação é de uso único e expira em {Validade}.</p>'
    ].join('')
  })
});

function defaultTemplate(type) {
  if (!Object.hasOwn(DEFAULTS, type)) {
    throw Object.assign(new Error('EMAIL_TEMPLATE_TYPE_UNKNOWN'), { code: 'EMAIL_TEMPLATE_TYPE_UNKNOWN' });
  }
  return DEFAULTS[type];
}

module.exports = { defaultTemplate };
