import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
vi.mock('../contexts/AuthContext', () => ({ AuthProvider: ({ children }) => children, useAuth: () => ({ user: null, organization: null, loading: false }) }))
import App from '../App'
afterEach(cleanup)
it('shows unavailable recovery guidance without accepting account data', () => {
  const { container } = render(<MemoryRouter initialEntries={['/recuperar-password']}><App /></MemoryRouter>)
  expect(screen.getByRole('heading', { name: 'Recuperar password' })).toBeTruthy()
  expect(screen.getByText('A recuperação por email ainda não está disponível neste ambiente.')).toBeTruthy()
  expect(container.querySelectorAll('input, form')).toHaveLength(0)
  expect(screen.getByRole('link', { name: 'Voltar ao login' }).getAttribute('href')).toBe('/login')
})
