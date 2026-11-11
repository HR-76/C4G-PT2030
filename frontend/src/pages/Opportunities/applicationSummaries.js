import { applicationStatusLabels } from '../../utils/applicationStatuses'

export function parseApplicationSummaries(data, expectedIds) {
  if (!Array.isArray(data?.items) || data.items.length !== expectedIds.length) throw new Error('Incomplete summary')
  const result = {}
  for (const item of data.items) {
    const statuses = Object.entries(item.statuses || {})
    if (!expectedIds.includes(item.opportunityId) || result[item.opportunityId] || !Number.isSafeInteger(item.count) || item.count < 0 ||
      statuses.some(([status, count]) => !Object.hasOwn(applicationStatusLabels, status) || !Number.isSafeInteger(count) || count < 1) ||
      statuses.reduce((sum, [, count]) => sum + count, 0) !== item.count ||
      (item.count === 1 ? !item.applicationId : item.applicationId !== null)) throw new Error('Invalid summary')
    result[item.opportunityId] = item
  }
  return result
}
