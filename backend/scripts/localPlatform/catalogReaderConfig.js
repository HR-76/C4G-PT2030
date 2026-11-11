'use strict';
const fs = require('node:fs');

function catalogReaderEnvironment(config, state, readFile = fs.readFileSync) {
  const refused = () => { throw Error('LOCAL_CATALOG_CONFIGURATION_REQUIRED'); };
  if (typeof state.catalogReaderConfigPath !== 'string' || !state.catalogReaderConfigPath) refused();
  let value;
  try { value = JSON.parse(readFile(state.catalogReaderConfigPath, 'utf8')); } catch { refused(); }
  if (!value || value.installationId !== state.installationId
      || value.host !== config.host || value.port !== config.port
      || value.database !== config.centralDatabase
      || !/^c4g_catalog_[a-z0-9_]{1,40}$/.test(value.login || '')
      || value.login === 'c4g_catalog_reader'
      || typeof value.password !== 'string' || value.password.length < 32) refused();
  const url = new URL('postgresql://localhost');
  url.hostname = value.host; url.port = String(value.port); url.pathname = '/' + value.database;
  url.username = value.login; url.password = value.password;
  return { CATALOG_DATABASE_URL: url.toString() };
}
module.exports = { catalogReaderEnvironment };
