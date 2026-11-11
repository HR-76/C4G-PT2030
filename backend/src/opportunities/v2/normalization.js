'use strict';
const { createHash } = require('node:crypto');
const { isIP } = require('node:net');
const { fail } = require('./errors');

const DECIMAL = /^(?:0|[1-9][0-9]{0,23})(?:\.[0-9]{0,7}[1-9])?$/;
const DAY_MS = 86400000;

function text(value, { maxLength = 4000, allowEmpty = false } = {}) {
  if (!Number.isSafeInteger(maxLength) || maxLength < 1 || typeof allowEmpty !== 'boolean') fail();
  if (typeof value !== 'string' || !value.isWellFormed() || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value)) fail();
  const result = value.normalize('NFC').trim();
  if ((!allowEmpty && !result) || [...result].length > maxLength) fail('OPPORTUNITY_V2_LIMIT_EXCEEDED');
  return result;
}

function decimal(value, { decimalSeparator = '.', groupSeparator = null, scale = 0 } = {}) {
  const invalid = () => fail('OPPORTUNITY_V2_INVALID_DECIMAL');
  if (typeof value !== 'string' || value.length > 256 || !['.', ','].includes(decimalSeparator) ||
      ![null, '.', ',', ' ', '\u00a0', '\u202f'].includes(groupSeparator) || decimalSeparator === groupSeparator ||
      !Number.isInteger(scale) || scale < -8 || scale > 8) invalid();
  const parts = value.trim().split(decimalSeparator);
  if (parts.length > 2 || !parts[0] || (parts.length === 2 && !/^\d+$/.test(parts[1]))) invalid();
  let whole = parts[0];
  if (groupSeparator && whole.includes(groupSeparator)) {
    const groups = whole.split(groupSeparator);
    if (!/^\d{1,3}$/.test(groups[0]) || groups.slice(1).some(group => !/^\d{3}$/.test(group))) invalid();
    whole = groups.join('');
  }
  if (!/^\d+$/.test(whole)) invalid();
  let fraction = parts[1] || '';
  // Decimal-point movement is textual. Never pass a monetary value through Number.
  if (scale > 0) {
    whole += fraction.padEnd(scale, '0').slice(0, scale);
    fraction = fraction.slice(scale);
  } else if (scale < 0) {
    whole = whole.padStart(-scale + 1, '0');
    fraction = whole.slice(scale) + fraction;
    whole = whole.slice(0, scale);
  }
  whole = whole.replace(/^0+(?=\d)/, '');
  fraction = fraction.replace(/0+$/, '');
  const result = whole + (fraction ? '.' + fraction : '');
  if (!DECIMAL.test(result)) invalid();
  return result;
}

function compareDecimal(left, right) {
  if (typeof left !== 'string' || typeof right !== 'string' || !DECIMAL.test(left) || !DECIMAL.test(right)) fail('OPPORTUNITY_V2_INVALID_DECIMAL');
  const [lw, lf = ''] = left.split('.'), [rw, rf = ''] = right.split('.');
  if (lw.length !== rw.length) return lw.length < rw.length ? -1 : 1;
  const a = lw + lf.padEnd(8, '0'), b = rw + rf.padEnd(8, '0');
  return a === b ? 0 : a < b ? -1 : 1;
}

function civilDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) fail('OPPORTUNITY_V2_INVALID_DATE');
  const [year, month, day] = value.split('-').map(Number);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const lengths = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (month < 1 || month > 12 || day < 1 || day > lengths[month - 1]) fail('OPPORTUNITY_V2_INVALID_DATE');
  return value;
}

function instant(value) {
  if (typeof value !== 'string') fail('OPPORTUNITY_V2_INVALID_DATE');
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?(Z|[+-]\d{2}:?\d{2})$/.exec(value);
  if (!m) fail('OPPORTUNITY_V2_INVALID_DATE');
  civilDate(m[1]);
  if (+m[2] > 23 || +m[3] > 59 || +m[4] > 59) fail('OPPORTUNITY_V2_INVALID_DATE');
  let offset = m[6];
  if (offset !== 'Z') {
    offset = offset.replace(':', '');
    if (+offset.slice(1, 3) > 23 || +offset.slice(3) > 59 || offset === '-0000') fail('OPPORTUNITY_V2_INVALID_DATE');
    offset = offset.slice(0, 3) + ':' + offset.slice(3);
  }
  const result = new Date(`${m[1]}T${m[2]}:${m[3]}:${m[4]}.${(m[5] || '').padEnd(3, '0')}${offset}`);
  if (!Number.isFinite(result.getTime())) fail('OPPORTUNITY_V2_INVALID_DATE');
  const normalized = result.toISOString();
  if (!/^\d{4}-/.test(normalized)) fail('OPPORTUNITY_V2_INVALID_DATE');
  return normalized;
}

function excelDate(value, system = '1900') {
  if (!['1900', '1904'].includes(system) || typeof value !== 'string' || !/^(?:0|[1-9]\d{0,6})$/.test(value)) fail('OPPORTUNITY_V2_INVALID_DATE');
  const serial = Number(value);
  if (system === '1900' && (serial < 1 || serial === 60)) fail('OPPORTUNITY_V2_INVALID_DATE');
  const epoch = system === '1904' ? Date.UTC(1904, 0, 1) : Date.UTC(1899, 11, 31);
  const days = serial - (system === '1900' && serial > 60 ? 1 : 0);
  const result = new Date(epoch + days * DAY_MS).toISOString().slice(0, 10);
  return civilDate(result);
}

function list(value, { separator = '|', maxItems = 64, maxLength = 300 } = {}) {
  if (!Number.isSafeInteger(maxItems) || maxItems < 1 || !Number.isSafeInteger(maxLength) || maxLength < 1) fail();
  if (typeof value !== 'string' || typeof separator !== 'string' || !separator) fail();
  if (value.length > 256 * 1024) fail('OPPORTUNITY_V2_LIMIT_EXCEEDED');
  const parts = value.split(separator).map(item => text(item, { maxLength }));
  const result = [...new Set(parts)].sort((left, right) => {
    const a = [...left], b = [...right];
    for (let index = 0; index < Math.min(a.length, b.length); index++) {
      const difference = a[index].codePointAt(0) - b[index].codePointAt(0);
      if (difference) return difference;
    }
    return a.length - b.length;
  });
  if (result.length > maxItems) fail('OPPORTUNITY_V2_LIMIT_EXCEEDED');
  return Object.freeze(result);
}

function conceptKey(scheme, label) {
  if (typeof scheme !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_.:-]*$/.test(scheme)) fail();
  const normalized = text(label, { maxLength: 300 });
  const key = scheme + ':' + createHash('sha256').update(normalized, 'utf8').digest('hex').slice(0, 16);
  if (key.length > 128) fail('OPPORTUNITY_V2_LIMIT_EXCEEDED');
  return key;
}

function safeUrl(value) {
  if (typeof value !== 'string' || value.length > 2048 || !value.isWellFormed() || /[\u0000-\u0020\\]/.test(value)) fail('OPPORTUNITY_V2_INVALID_URL');
  let parsed;
  try { parsed = new URL(value); } catch { fail('OPPORTUNITY_V2_INVALID_URL'); }
  const host = parsed.hostname.toLowerCase().replace(/\.+$/, '');
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || isIP(host) || host.includes(':') || !host.includes('.') ||
      /\.(?:local|localhost|internal|test|invalid)$/.test(host) || parsed.port && parsed.port !== '443' ||
      [...parsed.searchParams.keys()].some(key => /(?:token|secret|password|authorization|credential|signature|api.?key|^sig$)/i.test(key))) fail('OPPORTUNITY_V2_INVALID_URL');
  parsed.hostname = host;
  return parsed.href;
}

module.exports = { DECIMAL, text, decimal, compareDecimal, civilDate, instant, excelDate, list, conceptKey, safeUrl };
