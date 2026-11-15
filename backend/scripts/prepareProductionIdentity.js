'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { validateConfig } = require('./productionBootstrap/config');
const runtime = require('./productionBootstrap/runtimeConfiguration');
const { writeArtifacts } = require('./installProductionPlatform');

function parseArguments(argv) {
  const options = { write: false }, flags = { '--config': 'config', '--runtime-config': 'runtimeConfig',
    '--runtime-credentials': 'runtimeCredentials', '--output-dir': 'outputDir' }, seen = new Set();
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    if (seen.has(flag)) throw Error('PRODUCTION_IDENTITY_ARGUMENT_INVALID');
    seen.add(flag);
    if (flag === '--write') { options.write = true; continue; }
    if (!Object.hasOwn(flags, flag) || !argv[i + 1] || argv[i + 1].startsWith('--') || /:\/\//.test(argv[i + 1])) throw Error('PRODUCTION_IDENTITY_ARGUMENT_INVALID');
    options[flags[flag]] = argv[++i];
  }
  if (!options.runtimeConfig || !options.outputDir || (options.write && !options.runtimeCredentials)) throw Error('PRODUCTION_IDENTITY_ARGUMENT_INVALID');
  return options;
}
function prepare({ bootstrapConfig, runtimeConfig, runtimeCredentials, outputDir, write = false }) {
  if (typeof write !== 'boolean') throw Error('PRODUCTION_IDENTITY_ARGUMENT_INVALID');
  const config = bootstrapConfig === undefined ? undefined : validateConfig(bootstrapConfig);
  const settings = runtime.validateRuntimeConfig(runtimeConfig, config);
  const receipt = { prepared: write, ...(config ? { installationId: config.installationId } : {}), runtimeConfigurationDigest: runtime.runtimeConfigDigest(settings),
    files: ['keycloak-production.json', 'c4g-activation.properties'], providerContacted: false };
  if (write) writeArtifacts(path.resolve(outputDir), runtime.buildIdentityArtifacts({ runtimeConfig: settings, runtimeCredentials }));
  return receipt;
}
function main() {
  const args = parseArguments(process.argv.slice(2));
  const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
  const result = prepare({ bootstrapConfig: args.config ? read(args.config) : undefined, runtimeConfig: read(args.runtimeConfig),
    runtimeCredentials: args.write ? read(args.runtimeCredentials) : undefined, outputDir: args.outputDir, write: args.write });
  process.stdout.write(JSON.stringify(result) + '\n');
}
if (require.main === module) {
  try { main(); } catch (error) {
    process.stderr.write((/^PRODUCTION_[A-Z0-9_]+$/.test(error.message) ? error.message : 'PRODUCTION_IDENTITY_PREPARATION_FAILED') + '\n');
    process.exitCode = 1;
  }
}
module.exports = { prepare, parseArguments };
