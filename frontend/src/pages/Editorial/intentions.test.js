import { describe, it, expect, beforeEach } from 'vitest'
import { saveIntention, pendingIntentions, clearEditorialIntentions, removeIntention } from './intentions'
const uuid = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
describe('editorial recovery envelope', () => {
  beforeEach(() => sessionStorage.clear())
  const value = { userId: uuid(1), organizationId: uuid(2), operation: 'SUBMIT', resourceId: uuid(3), idempotencyKey: uuid(4), expectedRevision: 1 }
  it('isolates user and organization and survives a read without content', () => {
    saveIntention(value)
    expect(pendingIntentions(uuid(1), uuid(2))).toEqual([value])
    expect(pendingIntentions(uuid(1), uuid(5))).toEqual([])
    expect(pendingIntentions(uuid(6), uuid(2))).toEqual([])
    for (const key of ['content', 'concurrencyToken', 'expectedDigest', 'mfa', 'accessToken']) expect(() => saveIntention({ ...value, [key]: 'restricted' })).toThrow()
    removeIntention(value.idempotencyKey)
    expect(pendingIntentions(uuid(1), uuid(2))).toEqual([])
  })
  it('logout clears only editorial envelopes', () => {
    sessionStorage.setItem('unrelated', 'preserve')
    saveIntention(value); clearEditorialIntentions()
    expect(pendingIntentions(uuid(1), uuid(2))).toEqual([])
    expect(sessionStorage.getItem('unrelated')).toBe('preserve')
  })
})
