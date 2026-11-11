import { afterEach, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { ErrorState } from './CatalogReadDetails'

afterEach(() => { cleanup(); vi.useRealTimers() })

it('stops the retry timer after the wait expires', () => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-11-10T10:00:00Z'))
  render(<MemoryRouter><ErrorState error={{status:429,retryAt:Date.now()+2000}} retry={()=>{}} /></MemoryRouter>)
  expect(screen.getByRole('button').disabled).toBe(true)
  act(() => vi.advanceTimersByTime(2000))
  expect(screen.getByRole('button').disabled).toBe(false)
  expect(vi.getTimerCount()).toBe(0)
})
