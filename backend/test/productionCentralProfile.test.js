'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

test('production binds six distinct credentials to one database and preserves the closed authority login',()=>{
  const {configuration,VARIABLES}=require('../src/security/productionCentralProfile');
  const env={CENTRAL_RUNTIME_PROFILE:'production-v1',AUTHORITY_DATABASE_URL:'postgresql://c4g_authority_runtime:synthetic@localhost/central',CATALOG_DATABASE_URL:'postgresql://catalog:synthetic@localhost/central'};
  for(const [key,name] of Object.entries(VARIABLES))env[name]=`postgresql://${key}:synthetic@localhost/central`;
  assert.equal(Object.keys(configuration(env)).length,4);
  assert.throws(()=>configuration({...env,CATALOG_DATABASE_URL:env.CENTRAL_DATABASE_URL}),/BINDING/);
  assert.throws(()=>configuration({...env,AUTHORITY_DATABASE_URL:'postgresql://postgres:synthetic@localhost/central'}),/AUTHORITY_LOGIN/);
  assert.throws(()=>configuration({...env,CATALOG_DATABASE_URL:'postgresql://catalog:synthetic@localhost/foreign'}),/BINDING/);
  for(const flags of [{DOCUMENTS_RUNTIME:'f11-r2'},{OPPORTUNITY_IMPORTS_RUNTIME:'f12-xlsx'},{OPPORTUNITY_ACTIVATION_RUNTIME:'authenticated-v2'},{C4G_STAGING_CENTRAL_RUNTIME_LOGINS:'enabled'}])assert.throws(()=>configuration({...env,...flags}),/CAPABILITY/);
});

test('production directory selection requires explicit scope even with documents disabled',()=>{
  const create=require('../src/config/opportunityRuntime').createConfiguredOpportunityRuntime;
  for(const value of [undefined,'invalid','[]'])assert.throws(()=>create({env:{CENTRAL_RUNTIME_PROFILE:'production-v1',CENTRAL_API_ORGANIZATIONS_JSON:value},documentsEnabled:false}),/DIRECTORY_CONFIGURATION/);
});

test('production selection refuses collection and incomplete capability credentials without a fallback', () => {
  const { configuration } = require('../src/security/productionCentralProfile');
  assert.equal(configuration({}), null);
  assert.throws(() => configuration({ CENTRAL_RUNTIME_PROFILE: 'unknown' }), /PROFILE/);
  assert.throws(() => configuration({ CENTRAL_RUNTIME_PROFILE: 'production-v1', FUNDING_TENDERS_SOURCE: 'live-staging' }), /CAPABILITY/);
  assert.throws(() => configuration({ CENTRAL_RUNTIME_PROFILE: 'production-v1' }), /DATABASE_REQUIRED/);
});

test('role pool selects only its fixed capability, resets on commit and rolls back leaked transactions', async () => {
  const { createRolePool } = require('../src/security/productionCentralProfile');
  const calls = [];
  const client = { query: async sql => { calls.push(typeof sql === 'string' ? sql : sql.text); return { rows: [] }; }, release() { calls.push('release'); } };
  const pool = createRolePool({ connect: async () => client }, 'read', { validate: async () => {} });
  await pool.query('SELECT 1');
  assert.deepEqual(calls, ['BEGIN', 'SET LOCAL ROLE c4g_prod_read_role', 'SELECT 1', 'COMMIT', 'release']);
  calls.length = 0;
  const c = await pool.connect();
  await c.query('BEGIN READ ONLY');
  await assert.rejects(c.query('SET ROLE postgres'), /ROLE_CHANGE/);
  await c.release();
  assert.deepEqual(calls, ['BEGIN READ ONLY', 'SET LOCAL ROLE c4g_prod_read_role', 'ROLLBACK', 'release']);
});

test('role pool rolls back a failed implicit query and does not expose admin pool', async () => {
  const { createRolePool } = require('../src/security/productionCentralProfile');
  const calls = [];
  const pool = createRolePool({ connect: async () => ({ query: async sql => { calls.push(sql); if (sql === 'bad') throw Error('failure'); return { rows: [] }; }, release() { calls.push('release'); } }) }, 'commands', { validate: async () => {} });
  await assert.rejects(pool.query('bad'), /failure/);
  assert.deepEqual(calls, ['BEGIN', 'SET LOCAL ROLE c4g_prod_commands_role', 'bad', 'ROLLBACK', 'release']);
  assert.equal(pool.rawPool, undefined);
});
