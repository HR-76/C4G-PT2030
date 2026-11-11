'use strict';
const { cloneData } = require('../../src/opportunities/v2/data');
const DISABLED = Object.freeze({ OPPORTUNITY_EU_WRITER: 'disabled' });
function euWriterRuntimeEnvironment(state, activationEnvironment) {
  const descriptor = Object.getOwnPropertyDescriptor(state, 'opportunityEuWriter');
  if (!descriptor) return DISABLED;
  const fail = () => { throw Error('LOCAL_EU_WRITER_CONFIGURATION_INVALID'); };
  if (!Object.hasOwn(descriptor, 'value')) fail();
  let selected;
  try { selected = cloneData(descriptor.value, { maxBytes: 1024 }); } catch { fail(); }
  if (!selected || Array.isArray(selected) || Object.keys(selected).length !== 3
      || selected.packageId !== 'opportunity-eu-writer-v2'
      || activationEnvironment.OPPORTUNITY_ACTIVATION_RUNTIME !== 'authenticated-v2'
      || state.funding?.coverage !== 'durable-v1' || state.funding?.source !== 'live-local') fail();
  const capability = require('../../src/fundingTenders/euWriter').euWriterConfiguration();
  if (selected.policyVersion !== capability.policyVersion || selected.mappingDigest !== capability.mappingDigest) fail();
  return Object.freeze({ OPPORTUNITY_EU_WRITER: 'canonical-v2', FUNDING_TENDERS_ENRICHMENT: 'verified-v1' });
}
module.exports = { euWriterRuntimeEnvironment };
