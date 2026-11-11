import { beforeEach, expect, it } from 'vitest'
import { clearConfirmedReads, confirmedRead, confirmedReadsEpoch, dropConfirmedRead, keepConfirmedRead, readScope, startConfirmedRead } from '../api/confirmedReads'

beforeEach(clearConfirmedReads)

it('keeps an answer only for the user and organization that received it', () => {
  const scope = readScope('user-a', 'org-a')
  keepConfirmedRead(scope, 'dashboard', { total: 3 })
  expect(confirmedRead(scope, 'dashboard')).toEqual({ total: 3 })
  expect(confirmedRead(readScope('user-b', 'org-a'), 'dashboard')).toBeNull()
  expect(confirmedRead(readScope('user-a', 'org-b'), 'dashboard')).toBeNull()
  expect(confirmedRead(scope, 'alerts:0')).toBeNull()
})

it('forgets everything on a write, logout or organization change, and one answer when its read is refused', () => {
  const scope = readScope('user-a', 'org-a')
  keepConfirmedRead(scope, 'dashboard', { total: 3 }); keepConfirmedRead(scope, 'alerts:0', { values: [] })
  dropConfirmedRead(scope, 'dashboard')
  expect(confirmedRead(scope, 'dashboard')).toBeNull()
  expect(confirmedRead(scope, 'alerts:0')).toEqual({ values: [] })
  clearConfirmedReads()
  expect(confirmedRead(scope, 'alerts:0')).toBeNull()
})

it('does not keep an answer that crossed a write or a logout', () => {
  const scope = readScope('user-a', 'org-a'), read = startConfirmedRead(scope, 'dashboard'), since = confirmedReadsEpoch()
  clearConfirmedReads()
  read.keep({ total: 1 }); keepConfirmedRead(scope, 'alerts:0', { values: [] }, since)
  expect(confirmedRead(scope, 'dashboard')).toBeNull()
  expect(confirmedRead(scope, 'alerts:0')).toBeNull()
})

it('keeps nothing without a scope or a name and bounds what it holds', () => {
  const unnamed = startConfirmedRead(readScope('user-a', 'org-a'), null), unscoped = startConfirmedRead(null, 'dashboard')
  unnamed.keep({ a: 1 }); unscoped.keep({ a: 1 })
  expect(unnamed.held).toBeNull(); expect(unscoped.held).toBeNull()
  const scope = readScope('user-a', 'org-a')
  for (let index = 0; index < 80; index++) keepConfirmedRead(scope, `page:${index}`, { index })
  expect(confirmedRead(scope, 'page:0')).toBeNull()
  expect(confirmedRead(scope, 'page:79')).toEqual({ index: 79 })
})
