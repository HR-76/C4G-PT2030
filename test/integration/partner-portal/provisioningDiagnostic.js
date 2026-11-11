'use strict';
// Observe the exact provisioner in a private module. No source rewriting,
// global require hooks, extra SQL or changes to production dependencies.
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const { classifySetupError } = require('./setupErrorDiagnostic');

function load(replacements) {
  const filename = path.resolve(__dirname, '../../../backend/src/platformOnboarding/postgresProvisioner.js');
  const local = Module.createRequire(filename), instance = new Module(filename, module);
  instance.filename = filename; instance.paths = Module._nodeModulePaths(path.dirname(filename));
  instance.require = name => Object.hasOwn(replacements, name) ? replacements[name] : local(name);
  instance._compile(fs.readFileSync(filename, 'utf8'), filename);
  return instance.exports;
}

// Optional dependencies are for offline protocol tests only. The environment
// supplies no overrides; it uses the real driver and unchanged source modules.
function createObservedProvisioner(options, onSubstep, dependencies = {}) {
  const Pool = dependencies.Pool || require('../../../backend/node_modules/pg').Pool;
  const migration = dependencies.migration || require('../../../backend/src/security/tenantMigrationRunner');
  const identity = dependencies.identity || require('../../../backend/src/security/localTenantIdentityProvisioner');
  const preflight = dependencies.preflight || require('../../../backend/src/security/tenantMigrationPreflight');
  const contracts = require('../../../backend/src/platformOnboarding/contracts');
  let active = false, failed = false, depth = 0, identityCompleted = false, current;
  function emit(status, error = null) {
    const value = Object.freeze({ substep: current, substepStatus: status,
      substepFailure: error === null ? null : classifySetupError(error) });
    try { onSubstep?.(value); } catch { /* Diagnostics never alter the original operation. */ }
  }
  function begin(step) {
    if (active && !failed && depth === 0) { current = step; emit('RUNNING'); }
  }
  function failure(error) {
    if (active && !failed) { failed = true; emit('FAILED', error); }
  }
  async function run(step, work) {
    if (!active) return work();
    begin(step); depth++;
    try { return await work(); }
    catch (error) { failure(error); throw error; }
    finally { depth--; if (!failed && depth === 0) emit('COMPLETED'); }
  }
  function construct(step, work) {
    begin(step);
    try { return work(); } catch (error) { failure(error); throw error; }
  }
  // Keep the receiver for every untouched method; wrap only promise-based
  // calls used by this exact provisioner. Parameter values never reach emit().
  function decorate(target, replacements) {
    // A separate facade is necessary: real factories return frozen objects,
    // whose non-configurable methods cannot be replaced by a Proxy get trap.
    return new Proxy({}, { get(_facade, name) {
      if (Object.hasOwn(replacements, name)) return replacements[name];
      const value = Reflect.get(target, name, target);
      return typeof value === 'function' ? value.bind(target) : value;
    } });
  }
  function adminStep(sql) {
    if (typeof sql !== 'string') return 'ADMIN_OPERATION';
    if (sql.includes('pg_advisory_unlock_all')) return 'ADMIN_UNLOCK';
    if (sql.includes('pg_advisory_lock(') || sql.startsWith('SET statement_timeout')) return 'ADMIN_LOCK';
    if (sql.includes('pg_database') || sql.startsWith('CREATE DATABASE ')) return 'DATABASE_SETUP';
    if (sql === 'ROLLBACK') return current || 'ROLE_SETUP';
    return 'ROLE_SETUP';
  }
  const adminPool = decorate(options.adminPool, {
    connect: () => run('ADMIN_ACQUIRE', async () => {
      const client = await options.adminPool.connect();
      return decorate(client, {
        query: (...args) => run(adminStep(args[0]), () => client.query(...args)),
        release: (...args) => {
          const result = construct('ADMIN_RELEASE', () => client.release(...args));
          if (active && !failed && depth === 0) emit('COMPLETED');
          return result;
        }
      });
    })
  });
  const centralPool = decorate(options.centralPool, {
    query: (...args) => run('DIRECTORY_PUBLICATION', () => options.centralPool.query(...args)),
    connect: () => run('DIRECTORY_PUBLICATION', () => options.centralPool.connect())
  });
  const journal = decorate(options.journal, { reserve: (...args) => run('RESERVATION', () => options.journal.reserve(...args)) });
  class ObservedPool extends Pool {
    constructor(config) {
      const limited = config.user !== options.connection.user;
      begin(limited ? 'LOGIN_VERIFICATION' : 'TENANT_CONFIGURATION');
      try { super(config); } catch (error) { failure(error); throw error; }
      this.gateLimitedLogin = limited;
    }
    query(...args) {
      const step = this.gateLimitedLogin ? 'LOGIN_VERIFICATION' : identityCompleted ? 'TENANT_CONNECT_GRANTS' : 'TENANT_CONFIGURATION';
      return run(step, () => super.query(...args));
    }
    end(...args) { return run('TENANT_POOL_CLOSE', () => super.end(...args)); }
  }
  const replacements = {
    './contracts': { ...contracts, fail(...args) {
      try { return contracts.fail(...args); } catch (error) { failure(error); throw error; }
    } },
    pg: { Pool: ObservedPool },
    '../security/tenantMigrationRunner': { ...migration, createTenantMigrationRunner(...args) {
      const runner = construct('MIGRATION', () => migration.createTenantMigrationRunner(...args));
      return decorate(runner, { migrate: (...values) => run('MIGRATION', () => runner.migrate(...values)) });
    } },
    '../security/localTenantIdentityProvisioner': { ...identity, createLocalTenantIdentityProvisioner: (...args) => run('IDENTITY_CREATE', async () => {
      const provisioner = await identity.createLocalTenantIdentityProvisioner(...args);
      return decorate(provisioner, { reconcile: (...values) => run('IDENTITY_RECONCILE', async () => {
        const result = await provisioner.reconcile(...values); identityCompleted = true; return result;
      }) });
    }) },
    '../security/tenantMigrationPreflight': { ...preflight, preflightTenant: (...args) => run('PREFLIGHT', () => preflight.preflightTenant(...args)) }
  };
  for (const [name, factory] of [
    ['tenantDirectoryRepository', 'createTenantDirectoryRepository'],
    ['tenantProvisioningRepository', 'createTenantProvisioningRepository'],
    ['tenantConnectionRepository', 'createTenantConnectionRepository'],
    ['tenantSchemaRepository', 'createTenantSchemaRepository'],
    ['tenantWorkloadDirectoryRepository', 'createTenantWorkloadDirectoryRepository']
  ]) {
    const specifier = `../security/${name}`;
    const original = dependencies.publication?.[specifier] || require(`../../../backend/src/security/${name}`);
    replacements[specifier] = { ...original, [factory](...args) {
      const repository = original[factory](...args), methods = {};
      for (const key of Object.keys(repository)) if (typeof repository[key] === 'function') {
        methods[key] = (...values) => run('DIRECTORY_PUBLICATION', () => repository[key](...values));
      }
      return decorate(repository, methods);
    } };
  }
  const provisioner = (dependencies.load || load)(replacements).createPostgresProvisioner({ ...options, adminPool, centralPool, journal });
  return { ...provisioner, async ensure(...args) {
    active = true; failed = false; depth = 0; identityCompleted = false;
    begin('INPUT_BINDING');
    try { return await provisioner.ensure(...args); }
    catch (error) { failure(error); throw error; }
    finally { active = false; }
  } };
}

module.exports = { createObservedProvisioner };
