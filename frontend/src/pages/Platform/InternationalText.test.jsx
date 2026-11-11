import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import EntityInvitation from './EntityInvitation'

afterEach(cleanup)
it('renders a long mixed Unicode and RTL name and Lisbon date from the invitation list', async () => {
  const name = 'Á'.repeat(170) + ' العربية 👩‍💻'
  const api = { list: vi.fn().mockResolvedValue({ data: { page: 1, total: 1, items: [{ id: '1', name, email: 'a@example.invalid', phase: 'IDENTITY', createdAt: '2026-11-10T01:00:00Z', createdBy: 'C4G' }] } }) }
  render(<MemoryRouter><EntityInvitation api={api} /></MemoryRouter>)
  expect((await screen.findByText(name)).textContent).toBe(name)
  expect(screen.getByText(name).tagName).toBe('BDI')
  expect(screen.getByText(/10\/11\/2026, 01:00:00 \(Lisboa\)/)).toBeTruthy()
})
it.each([[0, 'convites'], [1, 'convite'], [2, 'convites']])('uses the correct invitation count for %i', async (total, label) => {
  const api = { list: vi.fn().mockResolvedValue({ data: { page: 1, total, items: [] } }) }
  render(<MemoryRouter><EntityInvitation api={api} /></MemoryRouter>)
  expect(await screen.findByText(`Página 1 · ${total} ${label}`)).toBeTruthy()
})
