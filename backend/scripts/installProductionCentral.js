'use strict';
const fs = require('node:fs');
const ROLES = Object.freeze({...require('../src/security/productionCentralProfile').ROLES, catalog:'c4g_catalog_reader'});
const LOGINS = Object.freeze({ read: 'c4g_prod_api_read', commands: 'c4g_prod_api_commands', authoring: 'c4g_prod_catalog_authoring', logs: 'c4g_prod_logs', retention: 'c4g_prod_email_retention', catalog:'c4g_prod_catalog_read' });
async function install(pool, { expectedDatabase, apply = false, passwords = null } = {}) {
  if (typeof expectedDatabase !== 'string' || !/^[a-z][a-z0-9_]{2,62}$/.test(expectedDatabase) || /staging/i.test(expectedDatabase)) throw Error('PRODUCTION_TARGET_REQUIRED');
  const current = (await pool.query('SELECT current_database() AS name')).rows[0]?.name;
  if (current !== expectedDatabase) throw Error('PRODUCTION_TARGET_MISMATCH');
  if (!apply) return { apply: false, package: 'production-central-permissions-v1', logins: LOGINS };
  if (!passwords || Object.keys(passwords).length !== Object.keys(LOGINS).length || Object.keys(LOGINS).some(key => typeof passwords[key] !== 'string' || passwords[key].length < 32)) throw Error('PRODUCTION_PRIVATE_CREDENTIALS_REQUIRED');
  await require('./runCentralMigrations').applyRegisteredProductionCentralPackage(pool, 'production-central-permissions-v1');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const [key, login] of Object.entries(LOGINS)) {
      const existing = (await client.query('SELECT 1 FROM pg_roles WHERE rolname=$1', [login])).rowCount;
      if (existing) throw Error('PRODUCTION_LOGIN_ALREADY_EXISTS');
      // Identifiers are constants. PostgreSQL quotes the secret; never log the statement or return it.
      const statement = (await client.query("SELECT format('CREATE ROLE %I LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD %L',$1::text,$2::text) AS sql", [login, passwords[key]])).rows[0].sql;
      await client.query(statement);
      await client.query(`GRANT ${ROLES[key]} TO ${login} WITH INHERIT FALSE, SET TRUE, ADMIN FALSE`);
      await client.query((await client.query("SELECT format('GRANT CONNECT ON DATABASE %I TO %I',$1::text,$2::text) AS sql", [expectedDatabase, login])).rows[0].sql);
    }
    await client.query('COMMIT');
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
  return { installed: true, version: '057_production_central_permissions', logins: LOGINS };
}
async function main() {
  const args = process.argv.slice(2);
  const options={};
  for(let i=0;i<args.length;i++) {
    const key=args[i];
    if(!['--apply','--expected-database','--credentials'].includes(key)||Object.hasOwn(options,key))throw Error('PRODUCTION_ARGUMENT_INVALID');
    if(key==='--apply')options[key]=true;
    else {if(!args[i+1]||args[i+1].startsWith('--'))throw Error('PRODUCTION_ARGUMENT_INVALID');options[key]=args[++i];}
  }
  const expectedDatabase=options['--expected-database'];
  const apply=options['--apply']===true;
  const file=options['--credentials'];
  const passwords = file ? JSON.parse(fs.readFileSync(file, 'utf8')) : null;
  if (!process.env.PRODUCTION_INSTALL_DATABASE_URL) throw Error('PRODUCTION_INSTALL_DATABASE_REQUIRED');
  const pool = new (require('pg').Pool)({ ...require('../src/config/databaseConfig').databasePoolOptions(process.env,'PRODUCTION_INSTALL_DATABASE_URL','CENTRAL_DB'), max: 1 });
  try { process.stdout.write(JSON.stringify(await install(pool, { expectedDatabase, apply, passwords })) + '\n'); }
  finally { await pool.end(); }
}
if (require.main === module) main().catch(() => { process.stderr.write('PRODUCTION_INSTALL_FAILED\n'); process.exitCode = 1; });
module.exports = { install, LOGINS };
