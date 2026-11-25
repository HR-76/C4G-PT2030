'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { parseArguments } = require('../scripts/productionBootstrap/config');
test('bootstrap CLI supports reviewed runtime inputs without making plan apply', () => {
  const result = parseArguments(['--config','base.json','--output-dir','private','--runtime-config','runtime.json','--runtime-credentials','secrets.json']);
  assert.equal(result.apply, false);
  assert.equal(result.runtimeConfig, 'runtime.json');
  assert.equal(result.runtimeCredentials, 'secrets.json');
});
test('applying a runtime bundle requires both private inputs; a public-only plan remains possible', () => {
  const base = ['--config','base.json','--output-dir','private','--credentials','base-private.json'];
  assert.throws(() => parseArguments([...base,'--apply','--runtime-config','runtime.json']), /ARGUMENTS_INVALID/);
  assert.throws(() => parseArguments([...base,'--runtime-credentials','secrets.json']), /ARGUMENTS_INVALID/);
  assert.equal(parseArguments([...base,'--runtime-config','runtime.json']).apply, false);
});
