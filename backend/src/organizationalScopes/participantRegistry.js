'use strict';
const { isTenantCapabilityEvidence } = require('../security/tenantMigrationPreflight');
const F13_CAPABILITY = 'F13_ORGANIZATIONAL_PROFILE';
const registries = new WeakSet();
const productionRegistries = new WeakSet();

function buildRegistry({ capabilities, participant, production }) {
  if (!Array.isArray(capabilities) || !Object.isFrozen(capabilities)
      || (participant !== null && (!Object.isFrozen(participant) || typeof participant.beforeArchive !== 'function'
        || participant.capability !== F13_CAPABILITY || typeof participant.version !== 'string'))) {
    throw new TypeError('Archive participant registry is invalid.');
  }
  const required = capabilities.includes(F13_CAPABILITY);
  if (required !== Boolean(participant)) throw new TypeError('Archive participant capability is incompatible.');
  const registry = Object.freeze({
    capabilities,
    async beforeArchive(client, context) {
      if (!required) return Object.freeze({ status: 'NOT_APPLICABLE' });
      if (!client || typeof client.query !== 'function') throw new TypeError('Prepared transaction client is required.');
      const result = await participant.beforeArchive(client, Object.freeze({ ...context }));
      if (!result || result.status !== 'READY') throw new Error('ORGANIZATIONAL_SCOPE_PARTICIPANT_FAILED');
      return result;
    }
  });
  registries.add(registry);
  if (production) productionRegistries.add(registry);
  return registry;
}

function createArchiveParticipantRegistry({ capabilityEvidence, participant = null } = {}) {
  if (!isTenantCapabilityEvidence(capabilityEvidence)) throw new TypeError('Verified tenant capability evidence is required.');
  return buildRegistry({ capabilities:capabilityEvidence.capabilities, participant, production:true });
}

function createArchiveParticipantRegistryFixture({ required = false, participant = null } = {}) {
  return buildRegistry({ capabilities:Object.freeze(required?[F13_CAPABILITY]:[]), participant, production:false });
}

function isArchiveParticipantRegistry(value) { return registries.has(value); }
function isProductionArchiveParticipantRegistry(value) { return productionRegistries.has(value); }

module.exports = { F13_CAPABILITY, createArchiveParticipantRegistry, createArchiveParticipantRegistryFixture,
  isArchiveParticipantRegistry, isProductionArchiveParticipantRegistry };
