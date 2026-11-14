'use strict';

const sanitizeHtml = require('sanitize-html');

const ALLOWED_TAGS = Object.freeze([
  'p', 'br', 'h1', 'h2', 'h3', 'strong', 'b', 'em', 'i', 'u', 'ul', 'ol', 'li', 'a'
]);
const ALLOWED_ATTRIBUTES = Object.freeze({ a: Object.freeze(['href']) });
const ACTIVATION_LINK_VARIABLE = '{LigacaoAtivacao}';

function allowedHref(value) {
  if (value === ACTIVATION_LINK_VARIABLE) return true;
  let url;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  return url.protocol === 'https:' && !url.username && !url.password;
}

// Server-side boundary: the browser editor is never trusted to have cleaned
// the markup. Returns the cleaned markup and what was taken out, so the
// administrator sees the difference before saving.
function sanitizeBody(input) {
  const removed = new Set();

  const html = sanitizeHtml(String(input), {
    allowedTags: [...ALLOWED_TAGS],
    allowedAttributes: { a: [...ALLOWED_ATTRIBUTES.a] },
    allowedSchemes: ['https'],
    allowProtocolRelative: false,
    disallowedTagsMode: 'discard',
    transformTags: {
      '*': (tagName, attribs) => {
        if (!ALLOWED_TAGS.includes(tagName)) {
          removed.add(tagName);
          return { tagName, attribs };
        }
        const allowed = ALLOWED_ATTRIBUTES[tagName] || [];
        const kept = {};
        for (const [name, value] of Object.entries(attribs)) {
          if (!allowed.includes(name)) {
            removed.add(`${tagName}[${name}]`);
            continue;
          }
          if (name === 'href' && !allowedHref(value)) {
            removed.add('a[href]');
            continue;
          }
          kept[name] = value;
        }
        return { tagName, attribs: kept };
      }
    }
  }).trim();

  return Object.freeze({ html, removed: Object.freeze([...removed].sort()) });
}

module.exports = { sanitizeBody, ALLOWED_TAGS };
