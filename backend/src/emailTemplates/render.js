'use strict';

const {
  LIMITS, BODY_VARIABLES, SUBJECT_VARIABLES, REQUIRED_BODY_VARIABLES,
  ACTIVATION_LINK_MARKER, VARIABLE_PATTERN, fail, escapeHtml
} = require('./contracts');
const { sanitizeBody } = require('./sanitizer');
const { htmlToText } = require('./text');

const CONTROL = /[\u0000-\u001f\u007f]/;

function variablesIn(value) {
  return new Set([...String(value).matchAll(VARIABLE_PATTERN)].map(match => match[1]));
}

function substitute(value, replacements) {
  return String(value).replace(VARIABLE_PATTERN, (token, name) =>
    Object.hasOwn(replacements, name) ? replacements[name] : token);
}

// Validates what an administrator wants to save. Returns the subject and the
// sanitized body that would be stored, plus what sanitization removed.
function validateTemplate(input) {
  const reasons = [];
  const subject = typeof input?.subject === 'string' ? input.subject.trim() : '';
  const rawHtml = typeof input?.html === 'string' ? input.html : '';

  if (!subject) reasons.push({ code: 'SUBJECT_REQUIRED' });
  if (subject.length > LIMITS.subject) reasons.push({ code: 'SUBJECT_TOO_LONG' });
  if (CONTROL.test(subject)) reasons.push({ code: 'SUBJECT_LINE_BREAK' });
  if (rawHtml.length > LIMITS.html) {
    reasons.push({ code: 'BODY_TOO_LONG' });
    fail('EMAIL_TEMPLATE_INVALID', { reasons });
  }

  const { html, removed } = sanitizeBody(rawHtml);
  const text = htmlToText(html);
  if (!text) reasons.push({ code: 'BODY_REQUIRED' });

  if ([subject, html].some(value => value.includes(ACTIVATION_LINK_MARKER))) {
    reasons.push({ code: 'RESERVED_TEXT' });
  }
  for (const name of variablesIn(subject)) {
    if (!BODY_VARIABLES.includes(name)) reasons.push({ code: 'UNKNOWN_VARIABLE', variable: name });
    else if (!SUBJECT_VARIABLES.includes(name)) reasons.push({ code: 'VARIABLE_NOT_ALLOWED_IN_SUBJECT', variable: name });
  }
  for (const name of variablesIn(html)) {
    if (!BODY_VARIABLES.includes(name)) reasons.push({ code: 'UNKNOWN_VARIABLE', variable: name });
  }
  // The text part is derived from the markup, so checking it covers both.
  const present = variablesIn(text);
  for (const name of REQUIRED_BODY_VARIABLES) {
    if (!present.has(name)) reasons.push({ code: 'REQUIRED_VARIABLE_MISSING', variable: name });
  }

  if (reasons.length) fail('EMAIL_TEMPLATE_INVALID', { reasons });
  return Object.freeze({ subject, html, removed });
}

function formatExpiry(expiresAt) {
  const date = new Date(expiresAt);
  if (Number.isNaN(date.getTime())) fail('EMAIL_TEMPLATE_RENDER_INVALID');
  const formatted = new Intl.DateTimeFormat('pt-PT', {
    timeZone: 'Europe/Lisbon', dateStyle: 'long', timeStyle: 'short'
  }).format(date);
  return `${formatted} (hora de Lisboa)`;
}

function plainValue(value) {
  return String(value).replace(/[\u0000-\u001f\u007f]+/g, ' ').split(ACTIVATION_LINK_MARKER).join('').trim();
}

function httpsUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password ? url.href : null;
  } catch {
    return null;
  }
}

// Renders a stored template for one invitation. The activation link is left
// as ACTIVATION_LINK_MARKER; see insertActivationLink.
function renderTemplate(template, { organizationName, expiresAt, logoUrl = null, logoAlt = null }) {
  const stored = validateTemplate(template);
  const organization = plainValue(organizationName ?? '');
  if (!organization) fail('EMAIL_TEMPLATE_RENDER_INVALID');
  const expiry = formatExpiry(expiresAt);
  const logo = logoUrl ? httpsUrl(logoUrl) : null;
  if (logoUrl && !logo) fail('EMAIL_TEMPLATE_RENDER_INVALID');

  const subject = substitute(stored.subject, { Organizacao: organization, Validade: expiry });
  const text = substitute(htmlToText(stored.html), {
    Organizacao: organization,
    Validade: expiry,
    LigacaoAtivacao: ACTIVATION_LINK_MARKER,
    Logotipo: ''
  }).replace(/\n{3,}/g, '\n\n').trim();
  const body = substitute(stored.html, {
    Organizacao: escapeHtml(organization),
    Validade: escapeHtml(expiry),
    LigacaoAtivacao: ACTIVATION_LINK_MARKER,
    Logotipo: logo
      ? `<img src="${escapeHtml(logo)}" alt="${escapeHtml(plainValue(logoAlt ?? organization))}" style="max-width:240px;height:auto;border:0">`
      : ''
  });
  const html = `<!doctype html><html lang="pt"><body style="font-family:Arial,sans-serif;color:#10251c">${body}</body></html>`;

  return Object.freeze({ subject, html, text });
}

// Final step, run where the activation secret lives. Refuses to produce a
// message in which either part would reach the recipient without the link.
function insertActivationLink(rendered, activationUrl) {
  const url = httpsUrl(activationUrl);
  if (!url || url !== activationUrl) fail('EMAIL_TEMPLATE_LINK_INVALID');
  const { subject, html, text } = rendered || {};
  if (![subject, html, text].every(value => typeof value === 'string')) fail('EMAIL_TEMPLATE_LINK_MISSING');
  if (!html.includes(ACTIVATION_LINK_MARKER) || !text.includes(ACTIVATION_LINK_MARKER)) fail('EMAIL_TEMPLATE_LINK_MISSING');
  if (subject.includes(ACTIVATION_LINK_MARKER)) fail('EMAIL_TEMPLATE_LINK_INVALID');
  return Object.freeze({
    subject,
    html: html.split(ACTIVATION_LINK_MARKER).join(escapeHtml(url)),
    text: text.split(ACTIVATION_LINK_MARKER).join(url)
  });
}

module.exports = { validateTemplate, renderTemplate, insertActivationLink };
