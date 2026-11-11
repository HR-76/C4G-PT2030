'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { normaliseProgramme } = require('../src/utils/programmeMapping');

test('official CEF and DIGITAL facet IDs do not exchange programmes', () => {
  assert.equal(normaliseProgramme('43251567'), 'CEF');
  assert.equal(normaliseProgramme('43152860'), 'DIGITAL');
  assert.equal(normaliseProgramme('43252405'), 'LIFE');
  assert.equal(normaliseProgramme('45532249'), 'EUBA');
});
