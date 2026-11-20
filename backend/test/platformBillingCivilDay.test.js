'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { civilDay } = require('../src/platformBilling/repository');

test('civilDay returns the civil day node-postgres parsed from a DATE column', () => {
  // node-postgres builds DATE values as local midnight; the day must not shift with the server time zone.
  assert.equal(civilDay(new Date(2026, 10, 1)), '2026-11-01');
  assert.equal(civilDay(new Date(2027, 9, 31)), '2027-10-31');
  assert.equal(civilDay(new Date(2026, 0, 5)), '2026-01-05');
});

test('civilDay keeps civil-day strings and empty values', () => {
  assert.equal(civilDay('2026-12-16'), '2026-12-16');
  assert.equal(civilDay(null), null);
  assert.equal(civilDay(undefined), null);
});

test('civilDay refuses an invalid date', () => {
  assert.throws(() => civilDay(new Date(NaN)), error => error.code === 'BILLING_DATA_INVALID');
});
