'use strict';

// Opt-in domain API. Existing repositories, HTTP routes and workers remain v1
// until their separately gated source/consumer integration is implemented.
module.exports = Object.freeze({
  contractVersion: 'opportunity-v2.0',
  validateSnapshotV2: require('./validation').validateSnapshotV2,
  normalizers: Object.freeze(require('./normalization')),
  readOpportunitySnapshot: require('./compatibility').readOpportunitySnapshot,
  projectTemporalV2: require('./temporal').projectTemporalV2,
  semanticSnapshotV2: require('./digests').semanticSnapshotV2,
  contentDigestV2: require('./digests').contentDigestV2,
  compareSnapshotsV2: require('./digests').compareSnapshotsV2,
  projectPersistenceV2: require('./persistence').projectPersistenceV2,
  OpportunityV2Error: require('./errors').OpportunityV2Error
});
