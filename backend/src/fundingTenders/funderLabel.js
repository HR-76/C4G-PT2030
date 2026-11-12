'use strict';
// The Funding & Tenders search API returns no funder, and the persisted v1 opportunity contract requires one, so every
// real record fails with OPPORTUNITY_INVALID_INPUT. The parser never asserts a funder; a label is added here, around the
// source, and only where the caller opts in (fixture rehearsal and the staging test environment). A funder the source does
// supply always wins. Production does not use this: it needs the canonical v2 writer and human review of new identities.
const FIXTURE_FUNDER = 'Financiador sintético (fixture local)';
const STAGING_FUNDER = 'Financiador não indicado pela fonte (recolha de staging)';
function labelFunder(source, label) {
  const labelled = record => ({ ...record, fields: { funderName: label, ...record.fields } });
  return {
    async collect(input) { const batch = await source.collect(input); return { ...batch, records: batch.records.map(labelled) }; },
    async lookup(input) { const result = await source.lookup(input); return result.record ? { ...result, record: labelled(result.record) } : result; }
  };
}
// Which label, if any, the worker puts on the EU source: fixture rehearsal and the staging test environment, never another
// live mode and never when the canonical v2 writer is selected (it takes the record as it is).
function labelledEuSource({ source, mode, live, canonicalWriter }) {
  if (!live) return labelFunder(source, FIXTURE_FUNDER);
  if (mode === 'live-staging' && !canonicalWriter) return labelFunder(source, STAGING_FUNDER);
  return source;
}
module.exports = { labelFunder, labelledEuSource, FIXTURE_FUNDER, STAGING_FUNDER };
