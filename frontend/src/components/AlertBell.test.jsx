import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
const api = vi.hoisted(() => ({ list: vi.fn(), refreshList: vi.fn() }))
vi.mock('../api/api', () => ({ organizationNotificationsApi: api }))
vi.mock('../contexts/AuthContext', () => ({ useAuth: () => ({}) }))
import { AlertBell } from './Layout/Header'
import { ALERT_GENERATION_INTERVAL_MS, markAlertsGenerated } from '../api/alertGeneration'
const bell = (scope = 'user:org') => render(<MemoryRouter><AlertBell organizationId="org" scope={scope} /></MemoryRouter>)
const start = new Date('2026-11-14T10:00:00Z').getTime()
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(start)
  api.list.mockReset(); api.refreshList.mockReset()
  api.list.mockResolvedValue({ data: { unread_count: 2 } }); api.refreshList.mockResolvedValue({ data: { unread_count: 3 } })
})
afterEach(() => { cleanup(); vi.useRealTimers() })

it('generates deadline alerts when due and only reads on the pages that follow, until the interval passes', async () => {
  bell(); await screen.findByLabelText('Alertas · 3 não lidos')
  expect(api.refreshList).toHaveBeenCalledTimes(1); expect(api.list).not.toHaveBeenCalled(); cleanup()
  bell(); await screen.findByLabelText('Alertas · 2 não lidos')
  expect(api.refreshList).toHaveBeenCalledTimes(1); expect(api.list).toHaveBeenCalledTimes(1); cleanup()
  vi.setSystemTime(start + ALERT_GENERATION_INTERVAL_MS)
  bell(); await screen.findByLabelText('Alertas · 3 não lidos')
  expect(api.refreshList).toHaveBeenCalledTimes(2)
})

it('only reads when the alerts page has just generated, and generates for another user', async () => {
  markAlertsGenerated('user:org')
  bell(); await screen.findByLabelText('Alertas · 2 não lidos')
  expect(api.refreshList).not.toHaveBeenCalled(); cleanup()
  bell('other:org'); await screen.findByLabelText('Alertas · 3 não lidos')
  expect(api.refreshList).toHaveBeenCalledTimes(1)
})

it('generates again on the next page when the generation failed', async () => {
  api.refreshList.mockRejectedValueOnce({ response: { status: 503 } })
  bell(); await screen.findByLabelText('Alertas · 2 não lidos'); cleanup()
  bell(); await screen.findByLabelText('Alertas · 3 não lidos')
  expect(api.refreshList).toHaveBeenCalledTimes(2)
})

it('reads again on window focus at most once a minute, and always after a change', async () => {
  markAlertsGenerated('user:org')
  bell(); await screen.findByLabelText('Alertas · 2 não lidos')
  expect(api.list).toHaveBeenCalledTimes(1)
  vi.setSystemTime(start + 59000); fireEvent.focus(window)
  expect(api.list).toHaveBeenCalledTimes(1)
  window.dispatchEvent(new Event('notifications:changed'))
  await waitFor(() => expect(api.list).toHaveBeenCalledTimes(2))
  vi.setSystemTime(start + 59000 + 60000); fireEvent.focus(window)
  await waitFor(() => expect(api.list).toHaveBeenCalledTimes(3))
})
