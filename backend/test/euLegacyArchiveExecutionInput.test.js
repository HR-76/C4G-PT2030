'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { input } = require('../../scripts/eu-legacy-archive-execute.cjs');

test('habitual archive entrypoint is pinned to the complete reviewed receipt export', () => {
  const file = path.resolve(__filename);
  assert.throws(() => input(['--execute', file]));
  assert.throws(() => input(['--prepare-window', file]));
});
