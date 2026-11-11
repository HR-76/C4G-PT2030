import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import fundingTendersSource from '../pages/FundingTenders.jsx?raw'
import importSource from '../pages/Import.jsx?raw'
import { scheduleWhenVisible } from './visiblePolling'

let state = 'visible'
const setVisibility = value => { state = value; document.dispatchEvent(new Event('visibilitychange')) }

beforeEach(() => {
  vi.useFakeTimers(); state = 'visible'
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state })
})
afterEach(() => { vi.useRealTimers(); delete document.visibilityState })

describe('scheduleWhenVisible', () => {
  it('runs after the delay while the tab is visible', () => {
    const work = vi.fn(); scheduleWhenVisible(work, 2000)
    vi.advanceTimersByTime(1999); expect(work).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1); expect(work).toHaveBeenCalledTimes(1)
  })

  it('does not poll a hidden tab and resumes once when it becomes visible', () => {
    const work = vi.fn(); scheduleWhenVisible(work, 2000)
    setVisibility('hidden'); vi.advanceTimersByTime(60000)
    expect(work).not.toHaveBeenCalled()
    setVisibility('visible'); expect(work).toHaveBeenCalledTimes(1)
    setVisibility('hidden'); setVisibility('visible'); expect(work).toHaveBeenCalledTimes(1)
  })

  it('cancel stops both the timer and the pending resume', () => {
    const early = vi.fn(), late = vi.fn()
    scheduleWhenVisible(early, 2000)(); vi.advanceTimersByTime(5000)
    const cancel = scheduleWhenVisible(late, 2000)
    setVisibility('hidden'); vi.advanceTimersByTime(5000); cancel(); setVisibility('visible')
    expect(early).not.toHaveBeenCalled(); expect(late).not.toHaveBeenCalled()
  })

  it('the polling pages schedule through the visibility-aware helper', () => {
    for (const source of [fundingTendersSource, importSource]) {
      expect(source).toMatch(/scheduleWhenVisible\(/)
      expect(source).not.toMatch(/setTimeout\((load|poll),/)
    }
  })
})
