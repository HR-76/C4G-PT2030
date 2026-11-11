import { expect, it, vi } from 'vitest'
import { createUuidV7, emitPreapprovals, reauthenticateForReview, validQueue } from './euLegacyReview'

const packageId = '01900000-0000-7000-8000-000000000001'
const sha = n => n.toString(16).padStart(64, '0')
const queue = () => ({ packageId, eligibleCount: 391, conflictCount: 7, sourceFence: 7,
  expiresAt: new Date(Date.now() + 300000).toISOString(),
  items: Array.from({ length: 391 }, (_, index) => ({ externalIdentifier: `EU-${index + 1}`,
    title: `Oportunidade ${index + 1}`, itemDigest: sha(index + 1) })) })

it('creates a current UUIDv7 and refuses changed queue scope', () => {
  const id = createUuidV7(Date.now(), new Uint8Array(16))
  expect(id).toMatch(/^[a-f0-9]{8}-[a-f0-9]{4}-7[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/)
  expect(validQueue(queue(), packageId)).toBe(true)
  expect(validQueue({ ...queue(), conflictCount: 0 }, packageId)).toBe(false)
  expect(validQueue({ ...queue(), expiresAt: '2020-01-01T00:00:00.000Z' }, packageId)).toBe(false)
})

it('uses the server account policy for a fresh OIDC login and returns to the package', async () => {
  const stepUp = vi.fn()
  const auth = { stepUpPolicy: vi.fn(async () => ({ data: { mfaOptional: true } })), stepUp }
  await reauthenticateForReview(auth, `/administracao/aprovacoes-eu?pacote=${packageId}`)
  expect(stepUp).toHaveBeenCalledWith('recent-auth', `/administracao/aprovacoes-eu?pacote=${packageId}`)
  auth.stepUpPolicy.mockResolvedValue({ data: { mfaOptional: false } })
  await reauthenticateForReview(auth, '/administracao/aprovacoes-eu')
  expect(stepUp).toHaveBeenLastCalledWith('recent-mfa', '/administracao/aprovacoes-eu')
  auth.stepUpPolicy.mockResolvedValue({ data: {} })
  await expect(reauthenticateForReview(auth, '/administracao/aprovacoes-eu')).rejects.toThrow('POLITICA_AUTENTICACAO_INDISPONIVEL')
})

it('stops on an uncertain POST, preserves its UUIDv7 and resumes with the same intention', async () => {
  const value = queue(), sent = [], progress = { pending: {}, receipts: {} }
  let saved = progress, failed = false
  const persist = next => { saved = structuredClone(next) }
  const api = {
    euLegacyPreapproval: vi.fn(async (_packageId, itemDigest) => {
      const item = value.items.find(entry => entry.itemDigest === itemDigest)
      return { data: { scope: 'PREARCHIVE_ONLY', binding: { externalIdentifier: item.externalIdentifier,
        itemDigest }, bindingDigest: sha(900) } }
    }),
    approveEuLegacyPrearchive: vi.fn(async (_packageId, itemDigest, intention) => {
      sent.push({ itemDigest, ...intention })
      if (itemDigest === value.items[1].itemDigest && !failed) { failed = true; throw Error('uncertain response') }
      return { data: { scope: 'PREARCHIVE_ONLY', packageId, externalIdentifier: value.items.find(item => item.itemDigest === itemDigest).externalIdentifier,
        itemDigest, bindingDigest: intention.bindingDigest, requestId: intention.requestId,
        actorId: packageId, eventId: intention.requestId, eventHash: sha(901), expiresAt: value.expiresAt } }
    })
  }
  await expect(emitPreapprovals({ api, queue: value, progress, persist })).rejects.toThrow('uncertain response')
  expect(Object.keys(saved.receipts)).toHaveLength(1)
  expect(saved.pending[value.items[1].itemDigest].requestId).toBe(sent[1].requestId)
  await emitPreapprovals({ api, queue: value, progress: saved, persist })
  expect(sent[2].requestId).toBe(sent[1].requestId)
  expect(Object.keys(saved.receipts)).toHaveLength(391)
  expect(Object.keys(saved.pending)).toHaveLength(0)
})
