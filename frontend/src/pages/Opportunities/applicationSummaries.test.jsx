import { expect, it } from 'vitest'
import { parseApplicationSummaries } from './applicationSummaries'

const zero = opportunityId => ({ opportunityId, statuses: {}, count: 0, applicationId: null })

it('accepts only the complete requested page and preserves its status counts', () => {
  const multiple = { opportunityId: 'one', statuses: { PREPARATION: 2, ARCHIVED: 1 }, count: 3, applicationId: null }
  const single = { opportunityId: 'two', statuses: { IDENTIFIED: 1 }, count: 1, applicationId: 'application' }
  expect(parseApplicationSummaries({ items: [single, multiple, zero('three')] }, ['one', 'two', 'three'])).toEqual({ one: multiple, two: single, three: zero('three') })
})

it.each([
  [],
  [zero('other')],
  [{ ...zero('one'), count: -1 }],
  [{ ...zero('one'), count: 0.5 }],
  [{ ...zero('one'), count: 1, statuses: { UNKNOWN: 1 }, applicationId: 'application' }],
  [{ ...zero('one'), count: 1, statuses: { IDENTIFIED: 1 } }],
  [{ ...zero('one'), applicationId: 'unexpected' }],
  [{ ...zero('one'), count: 2, statuses: { IDENTIFIED: 1 } }],
  [{ ...zero('one'), statuses: { IDENTIFIED: 0 } }],
])('rejects incomplete or inconsistent application metadata %j', items => {
  expect(() => parseApplicationSummaries({ items }, ['one'])).toThrow()
})

it('rejects duplicate opportunity summaries instead of accepting a partial page', () => {
  expect(() => parseApplicationSummaries({ items: [zero('one'), zero('one')] }, ['one', 'two'])).toThrow('Invalid summary')
})
