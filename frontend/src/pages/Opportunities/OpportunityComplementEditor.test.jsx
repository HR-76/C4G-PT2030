import React from 'react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

const api = vi.hoisted(() => ({ get: vi.fn(), save: vi.fn(), collectPortugal2030: vi.fn() }))
vi.mock('../../api/api', () => ({ opportunityComplementsApi: api }))
import OpportunityComplementEditor, { ComplementCollection, complementFields } from './OpportunityComplementEditor'
import { OpportunityOverview } from './OpportunityPresentation'

const ID = '11111111-1111-4111-8111-111111111111'
const view = (overrides = {}) => ({ data: { opportunityId: ID, editorial: { fields: {}, revision: 0, updatedAt: null, updatedBy: null },
  collected: { fields: { description: 'Resumo publicado', noticeCode: 'FA0241/2025', priorities: ['4A'] }, sourceUrl: 'https://portugal2030.pt/aviso/x/', observedAt: '2026-11-14T10:00:00.000Z', descriptionTruncated: true },
  effective: null, collection: 'disabled', ...overrides } })
const refused = code => Object.assign(new Error(code), { response: { data: { error: { code } } } })
beforeEach(() => { Object.values(api).forEach(mock => mock.mockReset()) })
afterEach(cleanup)

it('sends only what the administrator stated, with the revision that was read', async () => {
  api.get.mockResolvedValue(view()); api.save.mockResolvedValue({ data: {} })
  const saved = vi.fn()
  render(<OpportunityComplementEditor opportunityId={ID} onSaved={saved} />)
  fireEvent.click(screen.getByRole('button', { name: 'Editar informação' }))
  const description = await screen.findByLabelText(/^Descrição/)
  expect(description.value).toBe('')
  expect(screen.getByText('Valor recolhido: Resumo publicado')).toBeTruthy()
  fireEvent.change(description, { target: { value: '  Texto da C4G.\nSegunda linha.  ' } })
  fireEvent.change(screen.getByLabelText(/^Prioridades/), { target: { value: '4A - Social\n\n 4B - Saúde ' } })
  fireEvent.change(screen.getByLabelText(/^Taxa de comparticipação/), { target: { value: '82,5' } })
  fireEvent.click(screen.getByRole('button', { name: 'Guardar' }))
  await waitFor(() => expect(saved).toHaveBeenCalled())
  expect(api.save).toHaveBeenCalledWith(ID, { fields: { description: 'Texto da C4G.\nSegunda linha.', priorities: ['4A - Social', '4B - Saúde'], cofinancingRate: 82.5 },
    expectedRevision: 0, idempotencyKey: expect.any(String) })
  expect(screen.queryByRole('dialog')).toBeNull()
})

it('opens with the text already written and keeps the dialog on a refused save', async () => {
  api.get.mockResolvedValue(view({ editorial: { fields: { description: 'Texto anterior', officialUrl: 'https://exemplo.pt/aviso' }, revision: 3, updatedAt: '2026-11-14T12:00:00.000Z', updatedBy: 'admin@example.invalid' } }))
  api.save.mockRejectedValue(refused('STALE_REVISION'))
  render(<OpportunityComplementEditor opportunityId={ID} />)
  fireEvent.click(screen.getByRole('button', { name: 'Editar informação' }))
  expect((await screen.findByLabelText(/^Descrição/)).value).toBe('Texto anterior')
  expect(screen.getByText(/Última alteração por admin@example.invalid/)).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Guardar' }))
  expect((await screen.findByRole('alert')).textContent).toMatch(/alterada entretanto/)
  expect(api.save.mock.calls[0][1].expectedRevision).toBe(3)
  // Repeating uses the same request key.
  fireEvent.click(screen.getByRole('button', { name: 'Guardar' }))
  await waitFor(() => expect(api.save).toHaveBeenCalledTimes(2))
  expect(api.save.mock.calls[1][1].idempotencyKey).toBe(api.save.mock.calls[0][1].idempotencyKey)
})

it('refuses values the server would refuse before sending them', () => {
  const empty = { description: '', officialUrl: '', noticeCode: '', priorities: '', actionTypologies: '', interventionTypologies: '', operationTypologies: '', cofinancingRate: '' }
  expect(complementFields(empty)).toEqual({ fields: {} })
  expect(complementFields({ ...empty, officialUrl: 'http://exemplo.pt' })).toEqual({ invalid: 'Página oficial do aviso' })
  expect(complementFields({ ...empty, cofinancingRate: '120' })).toEqual({ invalid: 'Taxa de comparticipação' })
  expect(complementFields({ ...empty, priorities: 'A\nA' })).toEqual({ invalid: 'Prioridades' })
  expect(complementFields({ ...empty, cofinancingRate: '85' })).toEqual({ fields: { cofinancingRate: 85 } })
})

it('reports what a collection changed and explains when it is not active', async () => {
  api.collectPortugal2030.mockResolvedValueOnce({ data: { written: 2, unchanged: 150, unmatched: 20 } }).mockRejectedValueOnce(refused('COLLECTION_NOT_CONFIGURED'))
  const collected = vi.fn()
  render(<ComplementCollection onCollected={collected} />)
  fireEvent.click(screen.getByRole('button', { name: 'Atualizar dados PT2030' }))
  expect((await screen.findByRole('status')).textContent).toBe('2 avisos atualizados, 150 sem alterações, 20 sem oportunidade no catálogo.')
  expect(collected).toHaveBeenCalledTimes(1)
  fireEvent.click(screen.getByRole('button', { name: 'Atualizar dados PT2030' }))
  expect((await screen.findByRole('alert')).textContent).toMatch(/não está ativa/)
})

it('shows the complement in the ficha with the origin of each description', () => {
  const collected = { fields: { description: { value: 'Resumo publicado do aviso.', origin: 'COLLECTED', sourceUrl: 'https://portugal2030.pt/aviso/x/', observedAt: '2026-11-14T10:00:00.000Z', truncated: true },
    officialUrl: { value: 'https://portugal2030.pt/aviso/x/', origin: 'COLLECTED' }, noticeCode: { value: 'FA0241/2025', origin: 'COLLECTED' },
    priorities: { value: ['4A - Madeira'], origin: 'COLLECTED' }, cofinancingRate: { value: 82.5, origin: 'COLLECTED' } } }
  const { unmount } = render(<MemoryRouter><OpportunityOverview central source="PORTUGAL2030_PLAN" fields={{ title: 'Aviso planeado' }} complement={collected} /></MemoryRouter>)
  expect(screen.getByText('Resumo publicado do aviso.')).toBeTruthy()
  expect(screen.getByText(/Resumo parcial publicado em/).querySelector('a').getAttribute('href')).toBe('https://portugal2030.pt/aviso/x/')
  expect(screen.getByRole('link', { name: /Consultar fonte oficial/ }).getAttribute('href')).toBe('https://portugal2030.pt/aviso/x/')
  expect(screen.getByText('FA0241/2025')).toBeTruthy(); expect(screen.getByText('4A - Madeira')).toBeTruthy(); expect(screen.getByText('82,5 %')).toBeTruthy()
  unmount()
  render(<MemoryRouter><OpportunityOverview central fields={{ title: 'Aviso', summary: 'Descrição da fonte.' }} complement={{ fields: { description: { value: 'Texto da C4G.', origin: 'EDITORIAL' } } }} /></MemoryRouter>)
  expect(screen.getByText('Texto da C4G.')).toBeTruthy()
  expect(screen.queryByText('Descrição da fonte.')).toBeNull()
  expect(screen.getByText('Texto redigido pela C4G.')).toBeTruthy()
  expect(screen.queryByRole('heading', { name: 'Informação complementar' })).toBeNull()
})
