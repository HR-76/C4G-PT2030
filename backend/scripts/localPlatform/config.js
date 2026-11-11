'use strict';
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../../..');
const folder = path.join(root, '.tmp/local-platform');
const identifier = value => {
  if (!/^[a-z][a-z0-9_]{0,62}$/.test(value || '')) throw Error('LOCAL_DATABASE_IDENTIFIER_INVALID');
  return `"${value}"`;
};
function assertTarget(config) {
  if (!['localhost', '127.0.0.1', '::1'].includes(config.host)
      || !Number.isInteger(config.port) || config.port < 1 || config.port > 65535
      || config.centralDatabase === config.tenantDatabase) throw Error('LOCAL_DATABASE_TARGET_INVALID');
  identifier(config.centralDatabase); identifier(config.tenantDatabase);
  if (!config.user || !config.password) throw Error('LOCAL_DATABASE_CREDENTIAL_REQUIRED');
  return config;
}
function readConfig() {
  const env = require('dotenv').parse(fs.readFileSync(path.join(root, 'backend/.env')));
  return assertTarget({ host: 'localhost', port: 5432, user: 'postgres', password: env.PGPASSWORD,
    centralDatabase: 'c4g_central_dev', tenantDatabase: 'c4g_tenant_dev' });
}
function connection(config, database) {
  return { host: config.host, port: config.port, user: config.user, password: config.password,
    database, max: 4, connectionTimeoutMillis: 5000, options: '-c timezone=UTC' };
}
function connectionUrl(config, database) {
  const url = new URL('postgresql://localhost');
  url.hostname = config.host; url.port = String(config.port); url.username = config.user;
  url.password = config.password; url.pathname = '/' + database;
  return url.toString();
}
function saveState(state, destination = path.join(folder, 'runtime.json')) {
  const temporary = destination + '.writing';
  fs.writeFileSync(temporary, JSON.stringify(state, null, 2), { mode: 0o600 });
  fs.renameSync(temporary, destination);
}
module.exports = { root, folder, identifier, assertTarget, readConfig, connection, connectionUrl, saveState };
