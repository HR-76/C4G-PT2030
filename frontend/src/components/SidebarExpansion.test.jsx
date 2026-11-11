import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
vi.mock('../contexts/AuthContext', () => ({ useAuth: () => ({ user: { name: 'Teste', platformRoles: [] }, organization: { id: 'a' }, logout: vi.fn() }) }))
vi.mock('../api/api', () => ({ customerBillingApi: () => ({ access: () => Promise.resolve({ data: { canRead: false } }) }) }))
import Sidebar from './Layout/Sidebar'
afterEach(cleanup)
it('permite fechar e abrir um grupo sem navegar', () => {
  render(<MemoryRouter><Sidebar open mobile onClose={() => {}} /></MemoryRouter>)
  const toggle = screen.getByRole('button', { name: 'Organização' })
  expect(toggle.getAttribute('aria-expanded')).toBe('true')
  fireEvent.click(toggle)
  expect(toggle.getAttribute('aria-expanded')).toBe('false')
  expect(screen.queryByRole('link', { name: 'Pessoas' })).toBeNull()
  fireEvent.click(toggle)
  expect(screen.getByRole('link', { name: 'Pessoas' })).toBeTruthy()
})
