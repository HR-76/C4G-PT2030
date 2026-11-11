'use strict';
const { cloneData } = require('../../src/opportunities/v2/data');
const { PACKAGE_ID, tenantAddition, TENANT_CAPABILITY } = require('../../src/security/opportunityV2MigrationPackage');
const DISABLED = Object.freeze({ OPPORTUNITY_ACTIVATION_RUNTIME: 'disabled', OPPORTUNITY_11145_EXECUTOR: 'disabled' });
const ENABLED = Object.freeze({ OPPORTUNITY_ACTIVATION_RUNTIME: 'authenticated-v2', OPPORTUNITY_11145_EXECUTOR: 'bounded-v2' });
function fail(suffix) { throw Error('LOCAL_OPPORTUNITY_ACTIVATION_' + suffix); }

// Shared by the local API and its separate worker. This pure selection neither
// reads private configuration nor substitutes for the normal DB preflights and
// physical tenant binding verification performed at startup.
function opportunityV2RuntimeEnvironment(config, state) {
  const descriptor = Object.getOwnPropertyDescriptor(state, 'opportunityActivation');
  if (!descriptor) return DISABLED;
  if (!Object.hasOwn(descriptor, 'value')) fail('CONFIGURATION_INVALID');
  let selected;
  try { selected = cloneData(descriptor.value, { maxBytes: 1024 }); } catch { fail('CONFIGURATION_INVALID'); }
  if (!selected || Array.isArray(selected) || Object.keys(selected).length !== 3
      || selected.packageId !== PACKAGE_ID || selected.runtime !== ENABLED.OPPORTUNITY_ACTIVATION_RUNTIME
      || selected.executor !== ENABLED.OPPORTUNITY_11145_EXECUTOR) fail('CONFIGURATION_INVALID');
  if (config.host !== 'localhost' || config.port !== 5432 || config.centralDatabase !== 'c4g_central_dev'
      || config.tenantDatabase !== 'c4g_tenant_dev' || state.phase !== 'READY'
      || !['host', 'port', 'centralDatabase', 'tenantDatabase'].every(key => state.target?.[key] === config[key])
      || (state.identity?.origin || 'http://localhost:3000') !== 'http://localhost:3000') fail('TARGET_INVALID');
  const schema = state.snapshot?.schema;
  const {assignedReviewManifest,applicationChatManifest,organizationStrategyManifest,applicationTaskDetailsManifest,documentDeletionManifest}=require('../../src/security/tenantMigrationManifest');
  const verifiedVersion = [tenantAddition, assignedReviewManifest.at(-1), applicationChatManifest.at(-1), organizationStrategyManifest.at(-1), applicationTaskDetailsManifest.at(-1), documentDeletionManifest.at(-1)].some(entry =>
    schema?.currentVersion === entry.version && schema.schemaFingerprint === entry.schemaFingerprint);
  if (!schema || schema.compatibilityState !== 'COMPATIBLE' || !verifiedVersion || !Number.isSafeInteger(schema.revision) || schema.revision < 1
      || schema.verifiedCapabilities?.[TENANT_CAPABILITY] !== true) fail('SCHEMA_REQUIRED');
  return ENABLED;
}

module.exports = { opportunityV2RuntimeEnvironment };
