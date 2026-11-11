import React from 'react'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
const mocks = vi.hoisted(() => ({ context: vi.fn(), list: vi.fn(), get: vi.fn(), lookup: vi.fn(), session: work => work(), auth: {} }))
vi.mock('../../contexts/AuthContext', () => ({ useAuth: () => mocks.auth }))
vi.mock('../../api/api', () => ({ clearCsrfToken: vi.fn(), pq1Api: mocks }))
import Pq1Profile from './Pq1Profile'
import { saveIntention, pendingIntentions } from './intentions'
const uuid = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
afterEach(() => { cleanup(); sessionStorage.clear(); vi.clearAllMocks() })
function setup(operation, resource, dependent = {}) {
  const session = { user: { id: uuid(1) }, organization: { id: uuid(2), name: 'A' } }
  mocks.auth = { ...session, refreshSession: vi.fn().mockResolvedValue(session) }
  mocks.context.mockResolvedValue({ data: { organization: session.organization } })
  mocks.list.mockResolvedValue({ data: { items: [] } })
  mocks.get.mockResolvedValue({ data: { versionId: uuid(3), state: 'APPROVED', items: [], actions: [{ operation: 'PUBLISH', status: 'AVAILABLE' }], ...dependent } })
  mocks.lookup.mockResolvedValue({ data: { status: 'UNKNOWN', receipt: null } })
  saveIntention({ userId: uuid(1), organizationId: uuid(2), operation, resourceId: resource, idempotencyKey: uuid(4) })
  return render(<MemoryRouter initialEntries={[`/publicacao-perfil/versoes/${uuid(3)}`]}><Pq1Profile /></MemoryRouter>)
}
describe('PQ1 pending intention scope in the actual panel', () => {
  it('keeps UNKNOWN blocked on the same version after lookup and exposes support references', async () => {
    setup('PUBLISH', uuid(3))
    expect((await screen.findByRole('button', { name: 'Publicar versão' })).disabled).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'Consultar resultado da operação' }))
    await vi.waitFor(() => expect(mocks.lookup).toHaveBeenCalledTimes(1))
    await vi.waitFor(() => expect(screen.getByRole('button', { name: 'Consultar resultado da operação' }).disabled).toBe(false))
    expect(screen.getByRole('button', { name: 'Publicar versão' }).disabled).toBe(true)
    expect(pendingIntentions(uuid(1), uuid(2))).toHaveLength(1)
    expect(screen.getByText(/Referência da intenção:/).textContent).toContain(uuid(4))
    expect(screen.getByText(/resolução automática não é garantida/)).toBeTruthy()
  })
  it('allows another version in the same organization', async () => {
    setup('PUBLISH', uuid(5))
    expect((await screen.findByRole('button', { name: 'Publicar versão' })).disabled).toBe(false)
  })
  it('blocks publication dependent on an unresolved approval', async () => {
    setup('APPROVE', uuid(5), { candidateId: uuid(5) })
    expect((await screen.findByRole('button', { name: 'Publicar versão' })).disabled).toBe(true)
  })
  it('blocks actions dependent on a verification with unresolved revocation', async () => {
    setup('REVOKE_VERIFICATION', uuid(5), { verifications: [{ verificationId: uuid(5) }] })
    expect((await screen.findByRole('button', { name: 'Publicar versão' })).disabled).toBe(true)
  })
  it('labels historical expired verification without presenting incomplete knowledge', async () => {
    setup('PUBLISH', uuid(5), { completion: { result: 'COMPLETE', findings: [{ slot: 'competencies', code: 'VERIFICATION_EXPIRED' }] } })
    expect(await screen.findByText('Competências: Verificação expirada; preservada como histórica')).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Recorte editorial completo' })).toBeTruthy()
  })
})
