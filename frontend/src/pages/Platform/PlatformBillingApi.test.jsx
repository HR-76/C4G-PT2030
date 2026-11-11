import { beforeEach, describe, expect, it, vi } from 'vitest'

const http = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  put: vi.fn(),
}))

vi.mock('axios', () => ({
  default: {
    create: () => ({
      ...http,
      interceptors: { request: { use: vi.fn() }, response: { use: vi.fn() } },
    }),
    get: vi.fn(),
  },
}))

import { platformBillingApi } from '../../api/api'

beforeEach(() => {
  vi.clearAllMocks()
  http.get.mockResolvedValue({ data: {} })
  http.post.mockResolvedValue({ data: {} })
  http.put.mockResolvedValue({ data: {} })
})

describe('cliente HTTP da faturação administrativa', () => {
  it('liga as quatro projeções aos endpoints e limites de leitura', async () => {
    const signal = new AbortController().signal
    await platformBillingApi.summary({ currency: 'EUR' }, signal)
    await platformBillingApi.cycles({ page: 2 }, signal)
    await platformBillingApi.cycle('cycle-1', signal)
    await platformBillingApi.account('organization-1', signal)

    expect(http.get.mock.calls).toEqual([
      ['/admin/billing/summary', { params: { currency: 'EUR' }, signal, timeout: 15000 }],
      ['/admin/billing/cycles', { params: { page: 2 }, signal, timeout: 15000 }],
      ['/admin/billing/cycles/cycle-1', { signal, timeout: 15000 }],
      ['/admin/billing/organizations/organization-1/account', { signal, timeout: 15000 }],
    ])
  })

  it('liga todos os comandos sem acrescentar organização a recursos existentes', async () => {
    const body = { idempotencyKey: 'intent-1' }
    await platformBillingApi.accountWrite('organization-1', body)
    await platformBillingApi.cycleCreate(body)
    await platformBillingApi.cycleEdit('cycle-1', body)
    await platformBillingApi.cycleTransition('cycle-1', body)
    await platformBillingApi.documentRecord('cycle-1', body)
    await platformBillingApi.documentTransition('document-1', body)
    await platformBillingApi.paymentRecord('document-1', body)
    await platformBillingApi.paymentReverse('payment-1', body)

    expect(http.put.mock.calls).toEqual([
      ['/admin/billing/organizations/organization-1/account', body, { timeout: 20000 }],
      ['/admin/billing/cycles/cycle-1', body, { timeout: 20000 }],
    ])
    expect(http.post.mock.calls).toEqual([
      ['/admin/billing/cycles', body, { timeout: 20000 }],
      ['/admin/billing/cycles/cycle-1/transitions', body, { timeout: 20000 }],
      ['/admin/billing/cycles/cycle-1/documents', body, { timeout: 20000 }],
      ['/admin/billing/documents/document-1/transitions', body, { timeout: 20000 }],
      ['/admin/billing/documents/document-1/payments', body, { timeout: 20000 }],
      ['/admin/billing/payments/payment-1/reversals', body, { timeout: 20000 }],
    ])
  })
})
