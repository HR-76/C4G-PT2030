'use strict';
// The persisted v1 contract requires funderName, and the EU parser no longer
// asserts a funder for portal records (context/reviews/opportunity-data-
// standardization/eu-funder-conflict-correction.md, 31/10/2026). These gates
// exercise the v1 writer, so they add an explicit fixture label to what the real
// parser returns. The label is never produced by the application.
const real = require('../../../backend/src/fundingTenders/source');
const FIXTURE_FUNDER = 'Fixture funder (v1 gate label)';
function label(record) { return { ...record, fields: { funderName: FIXTURE_FUNDER, ...record.fields } }; }
function createSource(options) {
  const source = real.createSource(options);
  return Object.freeze({
    async collect(input = {}) {
      const onPage = input.onPage && (page => input.onPage({ ...page, records: page.records.map(label) }));
      const batch = await source.collect(onPage ? { ...input, onPage } : input);
      return { ...batch, records: batch.records.map(label) };
    },
    async lookup(input) {
      const result = await source.lookup(input);
      return result.record ? { ...result, record: label(result.record) } : result;
    }
  });
}
module.exports = { ...real, createSource, FIXTURE_FUNDER };
