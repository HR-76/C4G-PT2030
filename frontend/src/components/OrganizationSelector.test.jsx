import React from 'react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import OrganizationSelector from './OrganizationSelector'

const state = vi.hoisted(() => ({ auth: {} }))
vi.mock('../contexts/AuthContext', () => ({ useAuth: () => state.auth }))

beforeEach(() => {
  state.auth = { user: { platformRoles: [] }, organization: { id: 'org', displayName: 'C4G' } }
})
afterEach(cleanup)

it('shows the resolved entity as fixed session context', () => {
  render(<OrganizationSelector />)
  expect(screen.getByLabelText('Entidade: C4G')).toBeTruthy()
  expect(screen.getByText('C4G')).toBeTruthy()
  expect(screen.queryByRole('combobox')).toBeNull()
})

it('shows platform administration without an entity membership', () => {
  state.auth = { user: { platformRoles: ['C4G_ADMIN'] }, organization: null }
  render(<OrganizationSelector />)
  expect(screen.getByText('Administração da plataforma C4G')).toBeTruthy()
  expect(screen.queryByRole('combobox')).toBeNull()
})

it('explains missing access for a regular account without a membership', () => {
  state.auth.organization = null
  render(<OrganizationSelector />)
  expect(screen.getByText(/Sem organização associada/)).toBeTruthy()
  expect(screen.queryByRole('combobox')).toBeNull()
})
