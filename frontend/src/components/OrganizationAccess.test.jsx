import React from 'react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import OrganizationSelector from './OrganizationSelector'
import { getHomePath } from '../utils/navigation'

const state = vi.hoisted(() => ({ auth: {} }))
vi.mock('../contexts/AuthContext', () => ({ useAuth: () => state.auth }))
beforeEach(() => {
  state.auth = { user: { platformRoles: [] }, organization: null }
})
afterEach(cleanup)
const view = () => render(<MemoryRouter><OrganizationSelector /></MemoryRouter>)
it('shows the platform context instead of an empty organization selector', async () => {
  state.auth.user.platformRoles = ['C4G_ADMIN']; view()
  await screen.findByText('Administração da plataforma C4G')
  expect(screen.queryByRole('combobox')).toBeNull()
})
it('explains missing membership for a regular user', async () => {
  view(); await screen.findByText(/Sem organização associada/)
  expect(screen.queryByRole('combobox')).toBeNull()
})
it('shows an administrator membership as fixed entity context', () => {
  state.auth.user.platformRoles = ['C4G_ADMIN']
  state.auth.organization = { id: 'org', displayName: 'C4G' }
  view()
  expect(screen.getByLabelText('Entidade: C4G')).toBeTruthy()
  expect(screen.queryByRole('combobox')).toBeNull()
})
it('chooses useful home routes by platform assignment', () => {
  expect(getHomePath({ platformRoles: ['C4G_ADMIN'] })).toBe('/administracao/dashboard')
  expect(getHomePath({ role: 'ADMIN' })).toBe('/dashboard')
  expect(getHomePath(null)).toBe('/login')
})
