import React from 'react'
import { it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
const mocks = vi.hoisted(() => ({ auth: {}, context: vi.fn(), get: vi.fn(), list: vi.fn(), documents: vi.fn(),
  competencies: vi.fn(), experiences: vi.fn(), attach: vi.fn(), verify: vi.fn(), revoke: vi.fn(), submit: vi.fn(), session: work => work() }))
vi.mock('../../contexts/AuthContext', () => ({ useAuth: () => mocks.auth }))
vi.mock('../../api/api', () => ({ clearCsrfToken: vi.fn(), pq1Api: mocks }))
import Pq1Profile from './Pq1Profile'
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const change = (label, value) => fireEvent.change(screen.getByLabelText(label), { target: { value } })
const click = name => fireEvent.click(screen.getByRole('button', { name, exact: true }))
const writers = ['competencies','experiences','attach','verify','revoke','submit']
afterEach(() => { cleanup(); sessionStorage.clear(); vi.clearAllMocks() })
async function setup() {
  const session = { user: { id: id(1) }, organization: { id: id(2), name: 'A' } }
  mocks.auth = { ...session, refreshSession: vi.fn().mockResolvedValue(session) }
  mocks.context.mockResolvedValue({ data: { organization: session.organization } })
  mocks.get.mockResolvedValue({ data: { draftId: id(3), revision: 4, lifecycle: 'DRAFT', items: [],
    actions: [{ operation: 'EDIT', status: 'AVAILABLE' }, { operation: 'SUBMIT', status: 'AVAILABLE' }],
    assertions: [{ assertionId: id(4), versionId: id(5), knowledgeStatus: 'KNOWN', conceptRef: { conceptId: id(6) } }],
    experiences: [{ experienceId: id(8), versionId: id(9), typeRef: { entryId: id(10) }, observedFrom: '2026-01-01T00:00:00.000Z', observedUntil: '2026-02-01T00:00:00.000Z', provenance: { recordedAt: '2026-03-01T00:00:00.000Z' } }],
    verifications: [{ verificationId: id(15), assertionVersionId: id(5), effectiveStatusAtSubmission: 'VERIFIED', revoke: { concurrencyToken: 'opaque' } }]
  } })
  const catalog = {
    COMPETENCY_CONCEPT: [{ entryId: id(6), label: 'Competência A' }, { entryId: id(7), label: 'Competência B' }],
    EXPERIENCE_TYPE: [{ entryId: id(10), label: 'Tipo A' }, { entryId: id(11), label: 'Tipo B' }],
    VERIFICATION_METHOD: [{ entryId: id(12), label: 'Método A', maxValiditySeconds: 3600 }, { entryId: id(13), label: 'Método B', maxValiditySeconds: null }]
  }
  mocks.list.mockImplementation((_, query) => Promise.resolve({ data: { items: catalog[query.kind] || [] } }))
  mocks.documents.mockResolvedValue({ data: { items: [{ documentVersionId: id(14) }] } })
  for (const method of writers) mocks[method].mockImplementation(() => new Promise(() => {}))
  render(<MemoryRouter initialEntries={[`/publicacao-perfil/rascunhos/${id(3)}`]}><Pq1Profile /></MemoryRouter>)
  await screen.findByRole('option', { name: 'Método A' })
}
function noWriteOrConfirmation() {
  expect(screen.queryByRole('region', { name: 'Confirmar ação' })).toBeNull()
  for (const method of writers) expect(mocks[method]).not.toHaveBeenCalled()
  expect(Object.keys(sessionStorage).filter(k => k.startsWith('c4g.pq1.intention.v1'))).toHaveLength(0)
}
it.each([
  ['competência', 'Guardar competências', 'competencies', () => {}, () => change('Competência',id(7)), body => expect(body.assertions[0].conceptId).toBe(id(7))],
  ['experiência', 'Guardar experiências', 'experiences', () => {}, () => change('Fim observado (UTC)','2026-03-01T00:00'), body => expect(body.experiences[0].observedUntil).toBe('2026-03-01T00:00:00.000Z')],
  ['validade', 'Verificar competência', 'verify', () => { change('Declaração guardada',id(5)); change('Método de verificação',id(12)); change('Válida até (UTC)','2026-10-17T12:00') }, () => change('Válida até (UTC)','2026-10-17T12:30'), body => expect(body.validUntil).toBe('2026-10-17T12:30:00.000Z')],
  ['método', 'Verificar competência', 'verify', () => { change('Declaração guardada',id(5)); change('Método de verificação',id(12)); change('Válida até (UTC)','2026-10-17T12:00') }, () => change('Método de verificação',id(13)), body => { expect(body.methodId).toBe(id(13)); expect(body.validUntil).toBeNull() }],
  ['motivo', 'Revogar esta verificação', 'revoke', () => {}, () => change('Motivo da revogação','VERIFICATION_ERROR'), body => expect(body.reasonCode).toBe('VERIFICATION_ERROR')]
])('invalidates stale %s confirmation and sends only the newly confirmed values', async (_, action, method, prepare, edit, verifyBody) => {
  await setup(); prepare(); click(action)
  expect(screen.getByRole('region', { name: 'Confirmar ação' })).toBeTruthy()
  edit(); noWriteOrConfirmation()
  click(action)
  const confirmation = screen.getByRole('region', { name: 'Confirmar ação' })
  fireEvent.click(confirmation.querySelector('button'))
  await vi.waitFor(() => expect(mocks[method]).toHaveBeenCalledTimes(1))
  verifyBody(mocks[method].mock.calls[0][1])
})
it('invalidates an evidence confirmation when its document changes', async () => {
  await setup(); change('Declaração guardada',id(5)); change('Experiência guardada',id(9))
  await screen.findByRole('option', { name: id(14) })
  click('Associar evidência'); change('Documento autorizado',id(14)); noWriteOrConfirmation()
  click('Associar evidência'); click('Confirmar associar evidência')
  await vi.waitFor(() => expect(mocks.attach).toHaveBeenCalledTimes(1))
  expect(mocks.attach.mock.calls[0][1].documentVersionId).toBe(id(14))
})
it('distinguishes revocation from cancelling or confirming an ordinary edit', async () => {
  await setup()
  const trigger = screen.getByRole('button', { name: 'Revogar esta verificação' })
  expect(trigger.classList.contains('btn-danger')).toBe(true)
  fireEvent.click(trigger)
  expect(screen.getByRole('button', { name: 'Confirmar revogar verificação' }).classList.contains('btn-danger-solid')).toBe(true)
  const cancel = screen.getByRole('button', { name: 'Cancelar', exact: true })
  expect(cancel.classList.contains('btn-secondary')).toBe(true); fireEvent.click(cancel)
  noWriteOrConfirmation()
  click('Guardar competências')
  expect(screen.getByRole('button', { name: 'Confirmar guardar competências' }).classList.contains('btn-primary')).toBe(true)
  click('Cancelar'); click('Revogar esta verificação'); click('Confirmar revogar verificação')
  await vi.waitFor(() => expect(mocks.revoke).toHaveBeenCalledTimes(1))
  expect(mocks.revoke.mock.calls[0]).toEqual([id(15), expect.objectContaining({ concurrencyToken: 'opaque', idempotencyKey: expect.any(String) })])
})
it.each([
  ['conhecimento', () => fireEvent.click(screen.getByLabelText('Desconhecimento declarado'))],
  ['tipo', () => change('Tipo de experiência',id(11))],
  ['início', () => change('Início observado (UTC)','2026-01-02T00:00')],
  ['declaração guardada', () => change('Declaração guardada',id(5))],
  ['experiência guardada', () => change('Experiência guardada',id(9))],
  ['adicionar competência', () => click('Adicionar competência')],
  ['remover competência', () => click('Remover declaração 1')],
  ['adicionar experiência', () => click('Adicionar experiência')]
])('invalidates a pending submission after changing %s', async (_, edit) => {
  await setup(); click('Submeter esta revisão'); edit(); noWriteOrConfirmation()
})
