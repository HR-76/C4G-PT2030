'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { normalizeRecord } = require('../src/fundingTenders/source');
const { sourceDescription } = require('../src/fundingTenders/sourceDescription');
test('source text keeps paragraphs and entities without executable markup', () => {
  assert.equal(sourceDescription('<p>R&amp;I</p><p>Budget <strong>20</strong>0 &#8364;</p><script>bad()</script><img onerror="bad()">'), 'R&I\nBudget 200 €');
  assert.equal(sourceDescription(null), undefined);
  const excerpt = sourceDescription('x'.repeat(5000));
  assert(excerpt.length <= 4000); assert(excerpt.includes('Excerto'));
});
test('cascade descriptions and public links use call metadata, not the parent topic URL', () => {
  const item = { content: 'Cascade call', url: 'https://ec.europa.eu/wrong-parent', metadata: { type: ['8'], identifier: ['PARENT'], callccm2Id: ['12345'], description: ['<p>Students</p>'], furtherInformation: ['<p>Eligibility</p>'], deadlineDate: ['2027-01-03'] } };
  const result = normalizeRecord(item).fields;
  assert(result.officialUrl.endsWith('/competitive-calls-cs/12345'));
  assert.equal(result.summary, 'Students\n\nEligibility');
  item.metadata.description = []; item.metadata.beneficiaryAdministration = ['<p>Protection grants</p>'];
  assert.equal(normalizeRecord(item).fields.summary, 'Protection grants');
  item.metadata.callccm2Id = ['../bad'];
  assert.throws(() => normalizeRecord(item), { code: 'SOURCE_RECORD_INVALID' });
});
