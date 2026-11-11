import { expect, it, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { acceptAll, reauthenticateAcceptance, validAcceptanceQueue } from './euLegacyAcceptanceReview'

it('resolves the lazy route to the JSX component, not the case-colliding helper', () => {
  const source = fs.readFileSync(path.resolve(process.cwd(), 'src/App.jsx'), 'utf8')
  expect(source).toContain("import('./pages/Platform/EuLegacyAcceptanceReview.jsx')")
  expect(source).not.toContain("import('./pages/Platform/EuLegacyAcceptanceReview')")
})

it('gets OIDC step-up policy without account email preference', async () => {
  const auth = { stepUpPolicy: vi.fn(async () => ({ data: { mfaOptional: true } })), stepUp: vi.fn() }
  await reauthenticateAcceptance(auth, `/administracao/aceitacoes-eu?pacote=${id}`)
  expect(auth.stepUpPolicy).toHaveBeenCalledOnce()
  expect(auth.stepUp).toHaveBeenCalledWith('recent-auth', `/administracao/aceitacoes-eu?pacote=${id}`)
})

const id = '00000000-0000-4000-8000-000000000001'
const digest = 'a'.repeat(64)
const queue = () => ({ packageId: id, profile: 'EU_LEGACY_391', expiresAt: '2026-11-01T23:00:00.000Z',
  eligibleCount: 391, conflictCount: 7, sourceFence: 7,
  items: Array.from({ length: 391 }, (_, index) => ({ itemDigest: index.toString(16).padStart(64, '0'),
    externalIdentifier: `EU-${index}`, title: `Item ${index}`, accepted: index > 0 })) })
const ids = ['01900000-0000-7000-8000-000000000001', '01900000-0000-7000-8000-000000000002',
  '01900000-0000-7000-8000-000000000003']

it('accepts only a complete live queue with seven excluded conflicts', () => {
  expect(validAcceptanceQueue(queue(), id, Date.parse('2026-11-01T20:00:00.000Z'))).toBe(true)
  expect(validAcceptanceQueue({ ...queue(), conflictCount: 0 }, id)).toBe(false)
  const reviewed = { ...queue(), profile: 'EU_REVIEW_137', eligibleCount: 137,
    items: queue().items.slice(0, 137) }
  expect(validAcceptanceQueue(reviewed, id, Date.parse('2026-11-01T20:00:00.000Z'))).toBe(true)
  expect(validAcceptanceQueue({ ...reviewed, items: reviewed.items.slice(1) }, id)).toBe(false)
})

it('prepares, approves and accepts one pending identity with stable intentions', async () => {
  const q = queue(), calls = []
  const api = {
    euLegacyAcceptanceItem: vi.fn(async () => ({ data: { packageId: id, item: {
      itemDigest: q.items[0].itemDigest, externalIdentifier: 'EU-0', action: 'CHANGE_REQUIRES_APPROVAL',
      previewDigest: digest, expected: { opportunityId: id } } } })),
    prepareEuLegacyAcceptance: vi.fn(async (_p, _d, body) => { calls.push(['prepare', body.requestId]);
      return { data: { planId: id, planDigest: digest, preview: { previewDigest: digest,
        items: [{ action: 'CHANGE_REQUIRES_APPROVAL' }] } } } }),
    approveEuLegacyAcceptance: vi.fn(async (_p, _d, body) => { calls.push(['approve', body.requestId]);
      return { data: { planId: id, state: 'APPROVED', fence: 2 } } }),
    acceptEuLegacyCandidate: vi.fn(async (_p, _d, body) => { calls.push(['accept', body.requestId]);
      return { data: { opportunityId: id, revisionId: id, sourceVersion: 2, action: 'REVISION_CREATED' } } })
  }
  let progress = { items: {} }, next = 0
  await acceptAll({ api, queue: q, progress, persist: value => { progress = value },
    now: () => Date.parse('2026-11-01T20:00:00.000Z'), uuid: () => ids[next++] })
  expect(calls).toEqual([['prepare', ids[0]], ['approve', ids[1]], ['accept', ids[2]]])
  expect(progress.items[q.items[0].itemDigest].result.action).toBe('REVISION_CREATED')
})

it('an uncertain approval stops and the retry reuses its request ID and plan', async () => {
  const q = queue(); let approvals = 0, next = 0, progress = { items: {} }
  const api = { euLegacyAcceptanceItem: async () => ({ data: { packageId: id, item: {
    itemDigest: q.items[0].itemDigest, externalIdentifier: 'EU-0', action: 'CHANGE_REQUIRES_APPROVAL',
    previewDigest: digest, expected: { opportunityId: id } } } }),
  prepareEuLegacyAcceptance: vi.fn(async () => ({ data: { planId: id, planDigest: digest,
    preview: { previewDigest: digest, items: [{ action: 'CHANGE_REQUIRES_APPROVAL' }] } } })),
  approveEuLegacyAcceptance: vi.fn(async () => { approvals++; if (approvals === 1) throw Error('TIMEOUT');
    return { data: { planId: id, state: 'APPROVED', fence: 2 } } }),
  acceptEuLegacyCandidate: vi.fn(async () => ({ data: { opportunityId: id, revisionId: id,
    sourceVersion: 2, action: 'REVISION_CREATED' } })) }
  const args = { api, queue: q, persist: value => { progress = value },
    now: () => Date.parse('2026-11-01T20:00:00.000Z'), uuid: () => ids[next++] }
  await expect(acceptAll({ ...args, progress })).rejects.toThrow('TIMEOUT')
  await acceptAll({ ...args, progress })
  expect(api.prepareEuLegacyAcceptance).toHaveBeenCalledTimes(1)
  expect(api.approveEuLegacyAcceptance.mock.calls[0][2].requestId)
    .toBe(api.approveEuLegacyAcceptance.mock.calls[1][2].requestId)
  expect(next).toBe(3)
})
