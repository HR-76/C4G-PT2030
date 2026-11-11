'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { CASES } = require('./support/partnerBrowseContract');
const { createReferenceHarness } = require('./support/partnerBrowseReferenceHarness');

// Baseline characterization only. Register a future SQL harness against CASES
// after its isolated database/authority setup is explicitly authorized.
for (const scenario of CASES) test(scenario.title, () => scenario.run(createReferenceHarness));

test('contract detects a candidate deriving countries from only the returned page', async () => {
  const wrongCountries = async options => {
    const h = await createReferenceHarness(options), browse = h.browse;
    return { ...h, async browse(input) {
      const result = await browse(input);
      return { ...result, countries: [...new Set(result.items.map(item => item.country).filter(Boolean))] };
    } };
  };
  await assert.rejects(CASES.find(item => item.name === 'countries-before-filters').run(wrongCountries), { code: 'ERR_ASSERTION' });
});

test('contract detects a candidate reversing the prescribed item order', async () => {
  const wrongOrder = async options => {
    const h = await createReferenceHarness(options), browse = h.browse;
    return { ...h, async browse(input) { const result = await browse(input); return { ...result, items: [...result.items].reverse() }; } };
  };
  await assert.rejects(CASES.find(item => item.name === 'ordered-pages').run(wrongOrder), { code: 'ERR_ASSERTION' });
});

test('contract detects a candidate accepting a cursor despite an unseen content change', async () => {
  const staleAccepted = async options => {
    const h = await createReferenceHarness(options), browse = h.browse;
    return { ...h, async browse(input = {}) {
      if (!input.cursor) return browse(input);
      const { cursor, ...filters } = input, current = await browse(filters);
      const position = h.decode(cursor).position;
      const digest = h.decode(current.nextCursor).position.digest;
      return browse({ ...filters, cursor: h.issue({ ...position, digest }, filters) });
    } };
  };
  await assert.rejects(CASES.find(item => item.name === 'unseen-mutation').run(staleAccepted), { code: 'ERR_ASSERTION' });
});
