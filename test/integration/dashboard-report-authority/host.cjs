'use strict';
// Test-owned HTTP listener. Reuses the existing local configuration and real
// production security; never starts/stops the habitual app, workers or identity.
const fs = require('node:fs');
const path = require('node:path');
const {createHash} = require('node:crypto');
const cfg = require('../../../backend/scripts/localPlatform/config');
const digest = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex');

async function start() {
  const stateFile = path.join(cfg.folder, 'runtime.json');
  const config = cfg.readConfig(), state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
  if (state.phase !== 'READY' || state.identity.origin !== 'http://localhost:3000'
    || !state.memberAccess || !/^[0-9a-f-]{36}$/.test(state.organizationId)) throw Error('REPORT_PROBE_LOCAL_CONFIGURATION_REQUIRED');
  const env = require('../../../backend/scripts/localPlatform/runtime').runtimeEnvironment(config, state);
  const configurationDigest = () => createHash('sha256').update(JSON.stringify([
    stateFile, path.join(cfg.root, 'backend/.env'), state.catalogReaderConfigPath
  ].map(digest))).digest('hex');
  const configurationHash = configurationDigest();
  const {Pool} = require('../../../backend/node_modules/pg');
  const express = require('../../../backend/node_modules/express');
  const cors = require('../../../backend/node_modules/cors');
  const disposers = [];
  function ownResource(resource, dispose) {
    let closing;
    const close = () => closing ||= Promise.resolve().then(dispose);
    disposers.push(close); return close;
  }
  const centralPool = new Pool(cfg.connection(config, config.centralDatabase));
  ownResource(centralPool, () => centralPool.end());
  const authorityPool = new Pool({...cfg.connection(config, config.centralDatabase),
    user: 'c4g_authority_runtime', password: state.authorityPassword});
  ownResource(authorityPool, () => authorityPool.end());
  const schemaDigest = async () => createHash('sha256').update(JSON.stringify((await centralPool.query(
    'SELECT version,checksum_sha256,irreversible FROM public.c4g_schema_migration ORDER BY version'
  )).rows)).digest('hex');
  let server, composition, closing;
  async function close() {
    return closing ||= (async () => {
      const failures = [];
      if (server?.listening) {
        try { await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
        catch (error) { failures.push(error); }
      }
      for (const dispose of [...disposers].reverse()) {
        try { await dispose(); } catch (error) { failures.push(error); }
      }
      await composition?.logger.flush();
      if (failures.length) throw Error('REPORT_PROBE_CLEANUP_FAILED');
    })();
  }
  try {
    composition = require('../../../backend/src/productionComposition').createProductionComposition({env,
      dependencies: {express, cors, centralPool, authorityPool, ownResource, enableRegistration: false}});
    await composition.assertDatabaseReadiness();
    const schemaHash = await schemaDigest();
    const app = express();
    const summaryPath = `/api/organizations/${state.organizationId}/dashboard/summary`;
    app.use((req, res, next) => {
      if (req.method !== 'GET' || req.path !== summaryPath) return res.status(404).end();
      return next();
    });
    app.use(composition.app);
    server = app.listen(0, 'localhost');
    await new Promise((resolve, reject) => {server.once('listening', resolve); server.once('error', reject);});
    return {origin: `http://localhost:${server.address().port}`, close,
      configurationHash, schemaHash, assertConfigurationUnchanged() {
        if (configurationDigest() !== configurationHash) throw Error('REPORT_PROBE_CONFIGURATION_DRIFT');
      }, async assertEnvironmentUnchanged() {
        if (configurationDigest() !== configurationHash) throw Error('REPORT_PROBE_CONFIGURATION_DRIFT');
        if (await schemaDigest() !== schemaHash) throw Error('REPORT_PROBE_SCHEMA_DRIFT');
      }};
  } catch (error) { await close(); throw error; }
}

module.exports = {start};
