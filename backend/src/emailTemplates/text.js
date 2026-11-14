'use strict';

// Plain-text rendering of markup that has already been through sanitizeBody.
// It relies on that output being well formed, limited to the allowed tags,
// and with `<`, `>` and `"` escaped everywhere outside tags. It is not a
// general HTML parser and must not be given unsanitized input.

const TAG = /<(\/?)([a-z0-9]+)((?:\s[^>]*)?)>/g;
const BLOCKS = new Set(['p', 'h1', 'h2', 'h3', 'ul', 'ol']);

function decode(value) {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');
}

function hrefOf(attributes) {
  const match = /\shref="([^"]*)"/.exec(attributes);
  return match ? decode(match[1]) : null;
}

function htmlToText(sanitizedHtml) {
  let out = '';
  const lists = [];
  const links = [];

  const block = () => {
    out = out.replace(/[ \t]+$/, '');
    if (out && !out.endsWith('\n\n')) out += out.endsWith('\n') ? '\n' : '\n\n';
  };
  const line = () => {
    out = out.replace(/[ \t]+$/, '');
    if (out && !out.endsWith('\n')) out += '\n';
  };
  const text = chunk => {
    // \s already covers the non-breaking space the sanitizer decodes &nbsp; to.
    let value = decode(chunk).replace(/\s+/g, ' ');
    if (!out || out.endsWith('\n') || out.endsWith(' ')) value = value.replace(/^ /, '');
    out += value;
  };

  let position = 0;
  for (const match of String(sanitizedHtml).matchAll(TAG)) {
    text(sanitizedHtml.slice(position, match.index));
    position = match.index + match[0].length;
    const closing = match[1] === '/';
    const tag = match[2];

    if (tag === 'br') {
      out = out.replace(/[ \t]+$/, '') + '\n';
    } else if (tag === 'li') {
      if (!closing) {
        line();
        const list = lists[lists.length - 1];
        out += list && list.ordered ? `${++list.count}. ` : '- ';
      }
    } else if (tag === 'a') {
      if (!closing) {
        links.push({ href: hrefOf(match[3]), start: out.length });
      } else {
        const link = links.pop();
        if (link && link.href) {
          const label = out.slice(link.start).trim();
          if (!label) out += link.href;
          else if (label !== link.href) out += `: ${link.href}`;
        }
      }
    } else if (BLOCKS.has(tag)) {
      if (tag === 'ul' || tag === 'ol') {
        if (closing) lists.pop();
        else lists.push({ ordered: tag === 'ol', count: 0 });
      }
      block();
    }
  }
  text(sanitizedHtml.slice(position));

  return out
    .split('\n')
    .map(row => row.trimEnd())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

module.exports = { htmlToText };
