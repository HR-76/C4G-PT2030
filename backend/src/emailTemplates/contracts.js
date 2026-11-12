'use strict';

const TEMPLATE_TYPES = Object.freeze({ MEMBER_INVITATION: 'MEMBER_INVITATION' });

const LIMITS = Object.freeze({ subject: 200, html: 20000 });

// Closed variable lists. A template naming anything else is refused on save.
const BODY_VARIABLES = Object.freeze(['Organizacao', 'LigacaoAtivacao', 'Validade', 'Logotipo']);
const SUBJECT_VARIABLES = Object.freeze(['Organizacao', 'Validade']);
const REQUIRED_BODY_VARIABLES = Object.freeze(['LigacaoAtivacao', 'Validade']);

// Stands in for the activation link until the identity worker, the only
// process that knows the secret, puts the real link in its place.
const ACTIVATION_LINK_MARKER = '[[C4G_ACTIVATION_LINK]]';

const VARIABLE_PATTERN = /\{([A-Za-z][A-Za-z0-9]*)\}/g;

function fail(code, details) {
  const error = new Error(code);
  error.code = code;
  if (details) Object.assign(error, details);
  throw error;
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

module.exports = {
  TEMPLATE_TYPES,
  LIMITS,
  BODY_VARIABLES,
  SUBJECT_VARIABLES,
  REQUIRED_BODY_VARIABLES,
  ACTIVATION_LINK_MARKER,
  VARIABLE_PATTERN,
  fail,
  escapeHtml
};
