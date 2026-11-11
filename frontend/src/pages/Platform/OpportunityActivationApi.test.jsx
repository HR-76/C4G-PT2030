import { beforeEach, expect, it, vi } from 'vitest'
const http = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }))
vi.mock('axios', () => ({ default: { create: () => ({ ...http, interceptors: { request: { use: vi.fn() }, response: { use: vi.fn() } } }) } }))
import { opportunityActivationApi } from '../../api/api'
beforeEach(() => { vi.clearAllMocks(); http.get.mockResolvedValue({ data: {} }); http.post.mockResolvedValue({ data: {} }) })

it('keeps review reads cancellable and cannot turn a plan identifier into another route', async () => {
  const signal = new AbortController().signal
  await opportunityActivationApi.list({ cursor: 'cursor-1' }, signal)
  await opportunityActivationApi.get('../sources/eu/resume', signal)
  await opportunityActivationApi.euStatus(signal)
  expect(http.get.mock.calls.every(([, config]) => config.signal === signal)).toBe(true)
  expect(http.get.mock.calls[1][0]).toContain('/plans/..%2Fsources%2Feu%2Fresume')
  expect(http.post).not.toHaveBeenCalled()
})
it('keeps the reviewed digest and source fence intact and never creates a second intent after failure', async () => {
  const failure = Object.assign(new Error('timeout'), { code: 'ECONNABORTED' })
  http.post.mockRejectedValue(failure)
  const approval = Object.freeze({ requestId: 'stable-request', planDigest: 'a'.repeat(64) })
  await expect(opportunityActivationApi.approve('plan-1', approval)).rejects.toBe(failure)
  expect(http.post).toHaveBeenCalledTimes(1)
  expect(http.post.mock.calls[0][1]).toBe(approval)
  const control = Object.freeze({ requestId: 'stable-control', expectedFence: 7 })
  await expect(opportunityActivationApi.suspendEu(control)).rejects.toBe(failure)
  expect(http.post).toHaveBeenCalledTimes(2)
  expect(http.post.mock.calls[1][1]).toBe(control)
})
it('offers bounded 11145 execution without a generic publication command', () => {
  expect(Object.keys(opportunityActivationApi).sort()).toEqual(['approve', 'euStatus', 'get', 'list', 'prepare', 'quiesceEu', 'resumeEu', 'revoke', 'suspendEu', 'collect11145', 'prepare11145', 'accept11145', 'configureEuWriter', 'euWriterReviews', 'euWriterWindow', 'approveEuWriterWindow', 'euReconciliation', 'approveEuReconciliation', 'executeEuReconciliation', 'euLegacyPreapproval', 'euLegacyQueue', 'approveEuLegacyPrearchive', 'euLegacyAcceptanceQueue', 'euLegacyAcceptanceItem', 'prepareEuLegacyAcceptance', 'approveEuLegacyAcceptance', 'acceptEuLegacyCandidate'].sort())
  expect(opportunityActivationApi.accept).toBeUndefined()
  expect(opportunityActivationApi.publish).toBeUndefined()
})
it('reads and approves only the encoded legacy identity binding, with no archive operation', async () => {
  const signal = new AbortController().signal
  const packageId = '../sources/eu/resume', itemDigest = 'a'.repeat(64)
  const approval = Object.freeze({ requestId: 'stable-preapproval', bindingDigest: 'b'.repeat(64) })
  await opportunityActivationApi.euLegacyPreapproval(packageId, itemDigest, signal)
  await opportunityActivationApi.euLegacyQueue(packageId, signal)
  await opportunityActivationApi.approveEuLegacyPrearchive(packageId, itemDigest, approval)
  const base = '/admin/opportunity-activation/eu-legacy/preapprovals/..%2Fsources%2Feu%2Fresume/' + itemDigest
  expect(http.get.mock.calls).toEqual([[base, { signal }],
    ['/admin/opportunity-activation/eu-legacy/preapprovals/..%2Fsources%2Feu%2Fresume', { signal }]])
  expect(http.post.mock.calls).toEqual([[base + '/approve', approval]])
  expect(opportunityActivationApi.archiveEuLegacy).toBeUndefined()
})
it('reconciles only the encoded plan with exact approval and execution intentions and no blind retry', async () => {
  const signal = new AbortController().signal
  const id = '../sources/eu/resume'
  const approval = Object.freeze({ requestId: 'approval-id', previewDigest: 'a'.repeat(64) })
  const execution = Object.freeze({ requestId: 'execution-id', previewDigest: 'a'.repeat(64), approvalEventId: 'event-id', approvalEventHash: 'b'.repeat(64) })
  await opportunityActivationApi.euReconciliation(id, signal)
  await opportunityActivationApi.approveEuReconciliation(id, approval)
  await opportunityActivationApi.executeEuReconciliation(id, execution)
  const base = '/admin/opportunity-activation/eu-writer/reconciliations/..%2Fsources%2Feu%2Fresume'
  expect(http.get.mock.calls).toEqual([[base, { signal }]])
  expect(http.post.mock.calls).toEqual([[base + '/approve', approval], [base + '/execute', execution]])
  expect(http.post.mock.calls[1][1]).toBe(execution)
  const failure = new Error('uncertain response')
  http.post.mockRejectedValue(failure)
  await expect(opportunityActivationApi.executeEuReconciliation('plan-id', execution)).rejects.toBe(failure)
  expect(http.post).toHaveBeenCalledTimes(3)
  expect(http.post.mock.calls[2][1]).toBe(execution)
})
it('binds operational approval to the encoded window path and exact request without configuring or resuming', async () => {
  const signal = new AbortController().signal
  const windowId = '../sources/eu/resume'
  const approval = Object.freeze({ requestId: 'window-approval-request', planDigest: 'e'.repeat(64) })
  await opportunityActivationApi.euWriterWindow(windowId, signal)
  await opportunityActivationApi.approveEuWriterWindow(windowId, approval)
  expect(http.get.mock.calls).toEqual([['/admin/opportunity-activation/eu-writer/windows/..%2Fsources%2Feu%2Fresume', { signal }]])
  expect(http.post.mock.calls).toEqual([['/admin/opportunity-activation/eu-writer/windows/..%2Fsources%2Feu%2Fresume/approve', approval]])
  expect(http.post.mock.calls[0][1]).toBe(approval)
  const failure = new Error('uncertain response')
  http.post.mockRejectedValue(failure)
  await expect(opportunityActivationApi.approveEuWriterWindow('window-id', approval)).rejects.toBe(failure)
  expect(http.post).toHaveBeenCalledTimes(2)
  expect(http.post.mock.calls[1]).toEqual(['/admin/opportunity-activation/eu-writer/windows/window-id/approve', approval])
})
it('keeps writer policy server-owned and review reads bounded and cancellable', async () => {
  const signal = new AbortController().signal
  const control = Object.freeze({ requestId: 'writer-configuration', expectedFence: 3 })
  await opportunityActivationApi.configureEuWriter(control)
  await opportunityActivationApi.euWriterReviews({ cursor: 'bounded-cursor' }, signal)
  expect(http.post.mock.calls).toEqual([['/admin/opportunity-activation/sources/eu/writer', control]])
  expect(http.get.mock.calls).toEqual([['/admin/opportunity-activation/eu-writer/reviews', { params: { cursor: 'bounded-cursor' }, signal }]])
})
it('uses fixed 11145 routes and retains exact collection, plan and approval intentions', async () => {
  const signal = new AbortController().signal
  const collect = Object.freeze({ requestId: 'collection-id', expectedSourceFence: 1 })
  const prepare = Object.freeze({ requestId: 'plan-request', runId: 'run-id' })
  const accept = Object.freeze({ requestId: 'accept-request', planDigest: 'd'.repeat(64), fence: 2, sourceFence: 3 })
  await opportunityActivationApi.collect11145(collect, signal)
  await opportunityActivationApi.prepare11145(prepare)
  await opportunityActivationApi.accept11145('../sources/eu/resume', accept)
  expect(http.post.mock.calls.map(call => call[0])).toEqual([
    '/admin/opportunity-activation/calls/11145/collect',
    '/admin/opportunity-activation/calls/11145/plans',
    '/admin/opportunity-activation/calls/11145/plans/..%2Fsources%2Feu%2Fresume/accept',
  ])
  expect(http.post.mock.calls.map(call => call[1])).toEqual([collect, prepare, accept])
  expect(http.post.mock.calls[0][2].signal).toBe(signal)
  expect(http.post.mock.calls[0][2].timeout).toBe(45000)
  const failure = new Error('uncertain response')
  http.post.mockRejectedValue(failure)
  await expect(opportunityActivationApi.accept11145('plan-id', accept)).rejects.toBe(failure)
  expect(http.post).toHaveBeenCalledTimes(4)
  expect(http.post.mock.calls[3][1]).toBe(accept)
})
