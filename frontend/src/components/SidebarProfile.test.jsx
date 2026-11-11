import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
const auth = vi.hoisted(() => ({ user: { name: 'Teste', platformRoles: [] }, organization: null, logout: vi.fn() }))
vi.mock('../contexts/AuthContext', () => ({ useAuth: () => auth }))
import Sidebar from './Layout/Sidebar'
afterEach(cleanup)
const view = () => <MemoryRouter><Sidebar open mobile={false} onClose={() => {}} /></MemoryRouter>
it('shows the current client profile and clears it when organization context changes', () => {
  auth.user = { name: 'Teste', platformRoles: [] }
  auth.organization = { id: 'a', profileLabel: 'Administrador do cliente' }
  const { rerender } = render(view())
  expect(screen.getByText('Administrador do cliente')).toBeTruthy()
  auth.organization = { id: 'b', profileLabel: 'Membro da organização' }
  rerender(view())
  expect(screen.queryByText('Administrador do cliente')).toBeNull()
  expect(screen.getByText('Membro da organização')).toBeTruthy()
  auth.organization = null
  rerender(view())
  expect(screen.getByText('Sem entidade selecionada')).toBeTruthy()
  expect(screen.queryByText('Membro da organização')).toBeNull()
})
it('distinguishes platform administration without implying client administration', () => {
  auth.user = { name: 'Teste', platformRoles: ['C4G_ADMIN'] }
  auth.organization = null
  render(view())
  expect(screen.getByText('Administração C4G')).toBeTruthy()
  expect(screen.queryByRole('link', { name: 'Candidaturas' })).toBeNull()
})
it('does not infer client administration from an unverified user role', () => {
  auth.user = { name: 'Teste', role: 'ADMIN', platformRoles: [] }
  auth.organization = { id: 'a' }
  render(view())
  expect(screen.queryByText('Administrador do cliente')).toBeNull()
  expect(screen.getByText('Membro da organização')).toBeTruthy()
})
it('omits the organization group when none of its areas are authorized', () => {
  auth.user = { id: 'technician', name: 'Técnico', platformRoles: [] }
  auth.organization = { id: 'a' }
  render(<MemoryRouter><Sidebar open mobile={false} navigationAccess={{directory:false,units:false,access:false}} /></MemoryRouter>)
  expect(screen.queryByRole('region', {name:'Organização'})).toBeNull()
  expect(screen.queryByRole('link', {name:'Acessos'})).toBeNull()
  expect(screen.getByRole('link', {name:'Candidaturas'})).toBeTruthy()
})
