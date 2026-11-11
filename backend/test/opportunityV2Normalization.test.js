'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { text, decimal, compareDecimal, civilDate, instant, excelDate, list, conceptKey, safeUrl } = require('../src/opportunities/v2/normalization');

test('v2 decimal normalizes explicit source formats without floating point', () => {
  assert.equal(decimal('120 000,00', { decimalSeparator: ',', groupSeparator: ' ' }), '120000');
  assert.equal(decimal('18.181.527,09', { decimalSeparator: ',', groupSeparator: '.' }), '18181527.09');
  assert.equal(decimal('1\u00a0500,00', { decimalSeparator: ',', groupSeparator: '\u00a0' }), '1500');
  assert.equal(decimal('000.000'), '0');
  assert.equal(decimal('1.25', { scale: 6 }), '1250000');
  assert.equal(decimal('1', { scale: -8 }), '0.00000001');
  assert.equal(decimal('999999999999999999999999.12345678'), '999999999999999999999999.12345678');
  assert.equal(compareDecimal('99999999999999999999999.9', '100000000000000000000000'), -1);
  assert.equal(compareDecimal('0.12345678', '0.12345677'), 1);
});

test('v2 decimal rejects guessing, lossy representations and overflow', () => {
  for (const value of [120000, NaN, Infinity, '-1', '+1', '1e6', '1,25', '1.000000001', '1000000000000000000000000', '1 EUR', '1.2.3']) {
    assert.throws(() => decimal(value), { code: 'OPPORTUNITY_V2_INVALID_DECIMAL' });
  }
  assert.throws(() => decimal('12 34,56', { decimalSeparator: ',', groupSeparator: ' ' }));
  assert.throws(() => decimal('1.2', { decimalSeparator: '.', groupSeparator: '.' }));
  assert.throws(() => decimal('0.1', { scale: -8 }));
});

test('v2 dates preserve civil precision, offsets and leap dates', () => {
  assert.equal(civilDate('2024-02-29'), '2024-02-29');
  assert.equal(instant('2026-03-29T01:30:00+0100'), '2026-03-29T00:30:00.000Z');
  assert.equal(instant('2026-10-25T01:30:00.25+01:00'), '2026-10-25T00:30:00.250Z');
  assert.equal(instant('2026-10-25T01:30:00Z'), '2026-10-25T01:30:00.000Z');
  for (const value of ['2026-02-29', '2026-13-01', '2026-01-00', '2026-01-01T00:00:00Z']) assert.throws(() => civilDate(value));
  for (const value of ['2026-02-30T00:00:00Z', '2026-10-25T01:30:00', '2026-01-01T24:00:00Z', '2026-01-01T01:00:60Z', '2026-01-01T01:00:00.1234Z']) assert.throws(() => instant(value));
});

test('v2 Excel dates respect both epochs and reject phantom/fractional days', () => {
  assert.equal(excelDate('46266', '1900'), '2026-09-01');
  assert.equal(excelDate('1', '1900'), '1900-01-01');
  assert.equal(excelDate('59', '1900'), '1900-02-28');
  assert.equal(excelDate('61', '1900'), '1900-03-01');
  assert.equal(excelDate('0', '1904'), '1904-01-01');
  assert.equal(excelDate('1', '1904'), '1904-01-02');
  for (const value of ['60', '-1', '46266.5', '999999999', '1e3']) assert.throws(() => excelDate(value, '1900'));
  assert.throws(() => excelDate('1', 'UNKNOWN'));
});

test('v2 labels normalize NFC and preserve native label punctuation', () => {
  assert.equal(text('  Ac\u0327a\u0303o  '), 'Ação');
  assert.deepEqual(list(' FSE+ | Extra-Regio NUTS II | FSE+ ', { separator: '|' }), ['Extra-Regio NUTS II', 'FSE+']);
  assert.deepEqual(list('\ud83d\ude00|\ue000'), ['\ue000', '\ud83d\ude00']);
  assert.throws(() => list('A||B', { separator: '|' }));
  assert.throws(() => text('\ud800'));
  assert.throws(() => text('bad\u0000text'));
  assert.equal(conceptKey('PT2030_SPECIFIC_OBJECTIVE', 'Eficiência energética'), 'PT2030_SPECIFIC_OBJECTIVE:a862324a24720b40');
});

test('v2 public URL normalization rejects credentials, executable schemes and secret parameters', () => {
  assert.equal(safeUrl('https://example.org/calls/1'), 'https://example.org/calls/1');
  for (const value of ['javascript:alert(1)', 'http://example.org', 'https://user:password@example.org/', 'https://example.org/?token=secret', 'https://example.org/\ncall', 'https://localhost/call', 'https://127.0.0.1/call']) assert.throws(() => safeUrl(value));
});

test('v2 URL checks classify fully qualified local hosts before accepting them', () => {
  for (const value of ['https://localhost./call', 'https://service.internal./call', 'https://service.local./call']) assert.throws(() => safeUrl(value));
  assert.equal(safeUrl('https://example.org./call'), 'https://example.org/call');
});

test('v2 normalizer options cannot disable finite limits', () => {
  for (const value of [NaN, Infinity, -1, 0, 1.5, '300']) {
    assert.throws(() => text('test', { maxLength: value }));
    assert.throws(() => list('test', { maxItems: value }));
    assert.throws(() => list('test', { maxLength: value }));
  }
  assert.throws(() => text('test', { allowEmpty: 'yes' }));
});
