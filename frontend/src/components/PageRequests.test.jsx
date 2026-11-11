import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPageRequestActivity } from '../api/pageRequests'

describe('page request ordering', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('waits for the page requests to settle before running shell work', () => {
    const activity = createPageRequestActivity({ quietMs: 250, maxWaitMs: 6000 })
    const work = vi.fn()
    activity.afterPageRequests(undefined, work)
    vi.advanceTimersByTime(100)
    activity.start()
    vi.advanceTimersByTime(2000)
    expect(work).not.toHaveBeenCalled()
    activity.start(); activity.end()
    vi.advanceTimersByTime(1000)
    expect(work).not.toHaveBeenCalled()
    activity.end()
    vi.advanceTimersByTime(249)
    expect(work).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(work).toHaveBeenCalledTimes(1)
  })

  it('never waits longer than the limit and never runs twice', () => {
    const activity = createPageRequestActivity({ quietMs: 250, maxWaitMs: 6000 })
    const work = vi.fn()
    activity.start()
    activity.afterPageRequests(undefined, work)
    vi.advanceTimersByTime(6000)
    expect(work).toHaveBeenCalledTimes(1)
    activity.end()
    vi.advanceTimersByTime(1000)
    expect(work).toHaveBeenCalledTimes(1)
  })

  it('does not run work for an aborted caller', () => {
    const activity = createPageRequestActivity({ quietMs: 250, maxWaitMs: 6000 })
    const work = vi.fn(), controller = new AbortController()
    activity.afterPageRequests(controller.signal, work)
    controller.abort()
    vi.advanceTimersByTime(7000)
    expect(work).not.toHaveBeenCalled()
    activity.afterPageRequests(controller.signal, work)
    vi.advanceTimersByTime(7000)
    expect(work).not.toHaveBeenCalled()
  })

  it('runs at once when idle and no quiet period is configured', () => {
    const activity = createPageRequestActivity({ quietMs: 0 })
    const work = vi.fn()
    activity.afterPageRequests(undefined, work)
    expect(work).toHaveBeenCalledTimes(1)
  })
})

describe('page request ordering for several shell callers', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('releases every waiting caller together, even when the first one starts a request', () => {
    const activity = createPageRequestActivity({ quietMs: 250, maxWaitMs: 6000 })
    const second = vi.fn(), third = vi.fn()
    activity.start()
    activity.afterPageRequests(undefined, () => activity.start())
    activity.afterPageRequests(undefined, second)
    activity.afterPageRequests(undefined, third)
    activity.end()
    vi.advanceTimersByTime(250)
    expect(second).toHaveBeenCalledTimes(1)
    expect(third).toHaveBeenCalledTimes(1)
  })
})
