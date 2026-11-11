'use strict';
// Administrative provisioning only. Never called by the API or from HTTP input.
const {escapeIdentifier,escapeLiteral}=require('pg');
async function provisionCatalogReader(client,{login,password}) {
  if(!/^c4g_catalog_[a-z0-9_]{1,40}$/.test(login)||login==='c4g_catalog_reader'||typeof password!=='string'||password.length<32)
    throw new Error('CATALOG_LOGIN_CONFIGURATION_INVALID');
  await client.query('BEGIN');
  try {
    await client.query('SELECT pg_advisory_xact_lock(42420002)');
    await require('./runCentralMigrations').assertCentralMarker(client);
    await require('../src/security/catalogReaderSchema').assertCatalogReaderSchema(client);
    if((await client.query('SELECT 1 FROM pg_roles WHERE rolname=$1',[login])).rows.length)throw new Error('CATALOG_LOGIN_ALREADY_EXISTS');
    await client.query(`CREATE ROLE ${escapeIdentifier(login)} LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD ${escapeLiteral(password)}`);
    await client.query(`GRANT c4g_catalog_reader TO ${escapeIdentifier(login)} WITH ADMIN FALSE, INHERIT FALSE, SET TRUE`);
    await client.query('COMMIT');
  } catch(error) {await client.query('ROLLBACK');throw error;}
}
module.exports={provisionCatalogReader};
