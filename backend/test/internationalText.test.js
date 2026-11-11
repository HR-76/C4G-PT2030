'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { parse } = require('../src/organizationDirectory/contracts');
const { createDirectoryRepository } = require('../src/organizationDirectory/repository');

test('description contract and repository retain long NFC Unicode and RTL text with a simulated database', async () => {
 const description = ('Á العربية 👩‍💻 ').repeat(200).trim();
 const input = parse('descriptionEdit', { description, expectedRevision: 0, idempotencyKey: randomUUID() });
 let stored;
 const client = { async query(sql, args) {
  if (sql.includes('directory_receipt WHERE')) return { rows: [] };
  if (sql.includes('SELECT revision,email,website')) return { rows: [] };
  if (sql.includes('INSERT INTO organizational_scope.organization_card')) { stored = { description: args[1], email: args[2], website: args[3], revision: 1 }; return { rows: [stored] }; }
  if (sql.includes('INSERT INTO organizational_scope.directory_receipt')) return { rows: [] };
  if (sql.includes('SELECT * FROM organizational_scope.organization_card')) return { rows: [stored] };
  throw Error('Unexpected query');
 } };
 const repo = createDirectoryRepository({ organizationId: randomUUID(), actor: { id: randomUUID() }, protect: async () => {}, authorize: async () => true, audit: async () => {}, organization: async () => ({}) });
 assert.equal((await repo.descriptionEdit(client, input)).description, description);
 assert.equal((await repo.context(client)).profile.description, description);
 assert.throws(() => parse('descriptionEdit', { ...input, description: 'Cafe\u0301' }), { code: 'INVALID_INPUT' });
 assert.throws(() => parse('descriptionEdit', { ...input, description: '😀'.repeat(2001) }), { code: 'INVALID_INPUT' });
});
