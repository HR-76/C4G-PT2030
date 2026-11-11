import React from 'react'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
const mocks = vi.hoisted(() => ({ context: vi.fn(), list: vi.fn(), get: vi.fn(), lookup: vi.fn(), stepUp: vi.fn(), approve: vi.fn(), auth: {} }))
vi.mock('../../contexts/AuthContext', () => ({ useAuth: () => mocks.auth }))
vi.mock('../../api/api', () => ({ clearCsrfToken: vi.fn(), editorialApi: mocks }))
import EditorialProfile from './EditorialProfile'
afterEach(() => { cleanup(); sessionStorage.clear(); vi.clearAllMocks() })
describe('editorial organization boundary', () => {
  it('does not request resources before an organization is confirmed', () => {
    mocks.auth = { user: { id: 'user' }, organization: null }
    render(<MemoryRouter initialEntries={['/perfil-organizacao']}><EditorialProfile /></MemoryRouter>)
    expect(screen.getByRole('status').textContent).toContain('não tem uma entidade associada')
    expect(mocks.context).not.toHaveBeenCalled()
  })
  it('shows an unavailable service instead of an empty authorized list', async () => {
    mocks.auth = { user: { id: 'user' }, organization: { id: 'A', name: 'Organização A' }, refreshSession: vi.fn().mockResolvedValue({ user: { id: 'user' }, organization: { id: 'A' } }) }
    mocks.context.mockRejectedValue({ response: { status: 503 } })
    render(<MemoryRouter initialEntries={['/perfil-organizacao']}><EditorialProfile /></MemoryRouter>)
    expect((await screen.findByRole('alert')).textContent).toContain('Serviço indisponível')
    expect(screen.queryByText('Sem registos autorizados nesta organização.')).toBeNull()
  })
})

it('discards an old organization response after switching organization', async () => {
  let resolveA
  const lateA = new Promise(resolve => { resolveA = resolve })
  mocks.context.mockImplementationOnce(() => lateA).mockResolvedValue({ data: { organization: { id: 'B', name: 'B atual' }, canCreateDraft: false } })
  mocks.list.mockResolvedValue({ data: { items: [] } })
  const auth = id => ({ user: { id: 'user' }, organization: { id }, refreshSession: vi.fn().mockResolvedValue({ user: { id: 'user' }, organization: { id } }) })
  mocks.auth = auth('A')
  const view = render(<MemoryRouter initialEntries={['/perfil-organizacao']}><EditorialProfile /></MemoryRouter>)
  await vi.waitFor(() => expect(mocks.context).toHaveBeenCalledTimes(1))
  mocks.auth = auth('B')
  view.rerender(<MemoryRouter initialEntries={['/perfil-organizacao']}><EditorialProfile /></MemoryRouter>)
  await screen.findByText('Organização: B atual')
  resolveA({ data: { organization: { id: 'A', name: 'A antiga' }, canCreateDraft: true } })
  await vi.waitFor(() => expect(screen.queryByText('Organização: A antiga')).toBeNull())
  expect(screen.queryByRole('button', { name: 'Criar rascunho' })).toBeNull()
})

it('MFA return presents a fresh decision and never automatically approves', async () => {
  const id = '12345678-1234-4234-8234-123456789012'
  const session = { user: { id }, organization: { id, name: 'A' } }
  mocks.auth = { ...session, refreshSession: vi.fn().mockResolvedValue(session) }
  mocks.context.mockResolvedValue({ data: { organization: session.organization, mfa: { category: 'recent-mfa' } } })
  mocks.get.mockResolvedValue({ data: { items: [], state: 'SUBMITTED', actions: [{ operation: 'APPROVE', status: 'MFA_REQUIRED' }] } })
  const route = `/perfil-organizacao/candidaturas/${id}`
  const view = render(<MemoryRouter initialEntries={[route]}><EditorialProfile /></MemoryRouter>)
  fireEvent.click(await screen.findByRole('button', { name: 'Confirmar autentica??o' }))
  await vi.waitFor(() => expect(mocks.stepUp).toHaveBeenCalledWith('recent-mfa', route))
  expect(mocks.approve).not.toHaveBeenCalled()
  view.unmount()
  mocks.get.mockResolvedValue({ data: { items: [], state: 'SUBMITTED', actions: [{ operation: 'APPROVE', status: 'AVAILABLE', concurrencyToken: 'memory-only' }] } })
  render(<MemoryRouter initialEntries={[route]}><EditorialProfile /></MemoryRouter>)
  await screen.findByRole('button', { name: 'Aprovar candidatura' })
  expect(mocks.approve).not.toHaveBeenCalled()
  expect(screen.queryByRole('button', { name: 'Confirmar aprovar candidatura' })).toBeNull()
})

it('double confirmation creates one request and stores only the minimal intention envelope', async () => {
  const id = '12345678-1234-4234-8234-123456789012'
  const session = { user: { id }, organization: { id, name: 'A' } }
  mocks.auth = { ...session, refreshSession: vi.fn().mockResolvedValue(session) }
  mocks.context.mockResolvedValue({ data: { organization: session.organization, mfa: { category: 'recent-mfa' } } })
  mocks.get.mockResolvedValue({ data: { items: [], state: 'SUBMITTED', actions: [{ operation: 'APPROVE', status: 'AVAILABLE', concurrencyToken: 'memory-only-token' }] } })
  mocks.approve.mockImplementation(() => new Promise(() => {}))
  render(<MemoryRouter initialEntries={[`/perfil-organizacao/candidaturas/${id}`]}><EditorialProfile /></MemoryRouter>)
  fireEvent.click(await screen.findByRole('button', { name: 'Aprovar candidatura' }))
  const confirm = await screen.findByRole('button', { name: 'Confirmar aprovar candidatura' })
  fireEvent.click(confirm); fireEvent.click(confirm)
  await vi.waitFor(() => expect(mocks.approve).toHaveBeenCalledTimes(1))
  const values = Object.keys(sessionStorage).filter(k => k.startsWith('c4g.editorial.intention.v1')).map(k => JSON.parse(sessionStorage.getItem(k)))
  expect(values).toHaveLength(1)
  expect(Object.keys(values[0]).sort()).toEqual(['idempotencyKey', 'operation', 'organizationId', 'resourceId', 'userId'])
  expect(JSON.stringify(values)).not.toContain('memory-only-token')
})

it('a published inactive version does not suggest an unresolved publication action', async () => {
  const id = '12345678-1234-4234-8234-123456789012'
  const session = { user: { id }, organization: { id, name: 'A' } }
  mocks.auth = { ...session, refreshSession: vi.fn().mockResolvedValue(session) }
  mocks.context.mockResolvedValue({ data: { organization: session.organization } })
  mocks.get.mockResolvedValue({ data: { items: [], state: 'PUBLISHED', active: false, actions: [{ operation: 'PUBLISH', status: 'BLOCKED', reason: 'STATE_CONFLICT' }] } })
  render(<MemoryRouter initialEntries={[`/perfil-organizacao/versoes/${id}`]}><EditorialProfile /></MemoryRouter>)
  await screen.findByRole('heading', { name: 'Publicada — inativa' })
  expect(screen.queryByText(/O estado mudou/)).toBeNull()
  expect(screen.queryByRole('button', { name: 'Publicar versão' })).toBeNull()
})
