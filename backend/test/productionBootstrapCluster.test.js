'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { randomBytes, pbkdf2Sync, createHmac, createHash } = require('node:crypto');
const { verifyScramPassword, inspectTarget } = require('../scripts/productionBootstrap/cluster');
test('private credentials match SCRAM without changing the server password', () => {
  const password = 'synthetic-private-secret-'.repeat(2), salt = randomBytes(16);
  const salted = pbkdf2Sync(password, salt, 4096, 32, 'sha256');
  const stored = createHash('sha256').update(createHmac('sha256', salted).update('Client Key').digest()).digest('base64');
  const server = createHmac('sha256', salted).update('Server Key').digest('base64');
  const verifier = `SCRAM-SHA-256$4096:${salt.toString('base64')}$${stored}:${server}`;
  assert.equal(verifyScramPassword(password, verifier), true);
  assert.equal(verifyScramPassword('other', verifier), false);
  for (const value of [null, 'md5abc', 'SCRAM-SHA-256$999999999:x$y:z']) assert.equal(verifyScramPassword(password, value), false);
});
test('physical identity mismatch is refused before any mutation', async () => {
  const statements = [], pool = { options: { host: '127.0.0.1', port: 5432, database: 'postgres' },
    async query(sql) { statements.push(sql); return { rows: [{ system_identifier: '123', database: 'postgres', admin: true, version: '180006' }] }; } };
  await assert.rejects(inspectTarget(pool, { installationId: 'a', target: { host: '127.0.0.1', port: 5432, expectedSystemIdentifier: '999' } }), /PRODUCTION_SYSTEM_IDENTIFIER_MISMATCH/);
  assert.equal(statements.length, 1);
  assert.match(statements[0], /^SELECT/);
});
test('connection target mismatch is refused without querying', async () => {
  const pool = { options: { host: 'staging', port: 5432, database: 'postgres' }, query() { assert.fail('unexpected query'); } };
  await assert.rejects(inspectTarget(pool, { target: { host: 'production', port: 5432 } }), /PRODUCTION_CONNECTION_TARGET_MISMATCH/);
});
