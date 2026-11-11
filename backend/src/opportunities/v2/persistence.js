'use strict';

const { validateSnapshotV2 } = require('./validation');
const { cloneData, deepFreeze } = require('./data');
const { OpportunityV2Error } = require('./errors');
const { contentDigestV2 } = require('./digests');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const ENVELOPE_KEYS = ['opportunityId', 'revisionId', 'revisionNumber', 'rowVersion'];

function revisionEnvelope(input) {
  const value = cloneData(input, { maxBytes: 1024 });
  if (!value || Array.isArray(value) || Object.keys(value).length !== ENVELOPE_KEYS.length
    || ENVELOPE_KEYS.some(key => !Object.hasOwn(value, key))
    || !UUID.test(value.opportunityId) || !UUID.test(value.revisionId)
    || value.opportunityId === value.revisionId
    || !Number.isSafeInteger(value.revisionNumber) || value.revisionNumber < 1
    || !Number.isSafeInteger(value.rowVersion) || value.rowVersion < 1) {
    throw new OpportunityV2Error('OPPORTUNITY_V2_INVALID_REVISION_ENVELOPE');
  }
  return value;
}

// A pure projection for the future writer. No SQL, connection, authority, clock,
// UUID generation or mutation belongs here; the server supplies the revision IDs.
// Empty row sets are interpreted using the original Fact state in revision.snapshot.
function projectPersistenceV2(input, serverEnvelope) {
  const snapshot = validateSnapshotV2(input);
  const envelope = revisionEnvelope(serverEnvelope);
  const binding = { opportunityId: envelope.opportunityId, revisionId: envelope.revisionId };
  const rows = fact => fact.state === 'PRESENT' ? fact.value : [];
  const financialRows = field => rows(snapshot.financing[field]).map((item, ordinal) => ({ ...binding, ordinal, ...item }));
  return deepFreeze({
    projectionVersion: 'opportunity-persistence-v2.0',
    revision: { ...envelope, schemaVersion: 2, snapshot, contentDigest: contentDigestV2(snapshot) },
    sourceIdentities: snapshot.sourceRecords.map(record => ({ ...binding, ...record })),
    allocations: rows(snapshot.financing.allocations).map(allocation => ({
      ...binding,
      key: allocation.key,
      amount: allocation.money.amount,
      currencyCode: allocation.money.currency.value,
      currencyState: allocation.money.currency.state,
      interpretation: allocation.money.interpretation,
      scope: allocation.scope,
      basis: allocation.basis,
      programmeRefs: allocation.programmeRefs,
      fundRefs: allocation.fundRefs,
      period: allocation.period,
      sharedGroup: allocation.sharedGroup,
      aggregation: allocation.aggregation,
      qualifiers: allocation.qualifiers
    })),
    support: financialRows('support'),
    rates: financialRows('rates'),
    eligibleCosts: financialRows('eligibleCosts'),
    deadlines: rows(snapshot.schedule.deadlines).map((deadline, ordinal) => ({ ...binding, ordinal, ...deadline })),
    calendar: snapshot.schedule,
    programmes: rows(snapshot.programmes).map(concept => ({ ...binding, ...concept })),
    funds: rows(snapshot.funds).map(concept => ({ ...binding, ...concept }))
  });
}

module.exports = { projectPersistenceV2 };
