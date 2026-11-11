import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'

const api = vi.hoisted(() => Object.fromEntries(['units', 'get', 'list', 'create', 'edit', 'archive'].map(name => [name, vi.fn()])))
const central = vi.hoisted(() => ({ get: vi.fn() }))
const applications = vi.hoisted(() => ({ create: vi.fn(), list: vi.fn() }))
const auth = vi.hoisted(() => ({ user: { id: 'user' }, organization: { id: 'org' } }))
vi.mock('../../api/api', () => ({ opportunityInterestsApi: api, centralOpportunitiesApi: central, privateApplicationsApi: applications }))
vi.mock('../../contexts/AuthContext', () => ({ useAuth: () => auth }))
import Interests from './Interests'
import { interestIntentionKey, saveInterestIntention } from './intentions'

// Same functional envelope as InterestFlow.test.jsx; no catalogue/detail setup is needed.
const record = { interestId: 'interest', opportunityId: 'opportunity', centralRevisionId: 'old-revision', title: 'Aviso de ensaio', revision: 1, status: 'ACTIVE', unitIds: [], units: [], capabilities: { canManage: true, canCreateApplication: true } }
const currentInterest = { ...record, revision: 3, notes: 'Análise guardada' }
const currentOpportunity = { opportunityId: 'opportunity', revisionId: 'current-revision', snapshot: { lifecycleState: 'ACTIVE' } }
const pending = { userId: 'user', organizationId: 'org', method: 'edit', id: 'interest', payload: { notes: 'Análise pendente', unitIds: [], expectedRevision: 1 }, idempotencyKey: 'pending-key' }
const actionName = `Preparar candidatura para ${record.title}`
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done }); return { promise, resolve } }
function Destination() { const location = useLocation(); return <p data-testid="destination">{location.search}</p> }
const content = (path = '/interesses') => <MemoryRouter initialEntries={[path]}><Routes><Route path="/interesses" element={<Interests/>}/><Route path="/candidaturas" element={<Destination/>}/></Routes></MemoryRouter>
const page = path => render(content(path))
const open = async () => { const button = await screen.findByRole('button', { name: actionName }); fireEvent.click(button); return button }

beforeEach(() => {
  vi.resetAllMocks(); sessionStorage.clear(); auth.user = { id: 'user' }; auth.organization = { id: 'org' }
  api.list.mockResolvedValue({ data: { items: [record], nextCursor: null, capabilities: { canCreateApplication: true } } })
  api.units.mockResolvedValue({ data: { items: [] } })
  api.get.mockResolvedValue({ data: currentInterest })
  central.get.mockResolvedValue({ data: currentOpportunity })
})
afterEach(() => { cleanup(); expect(api.create).not.toHaveBeenCalled(); expect(applications.create).not.toHaveBeenCalled() })

it('offers the shortcut only for active rows with both management and creation capabilities', async () => {
  const cases = [
    record,
    { ...record, interestId: 'reader', title: 'Consulta', capabilities: { canManage: false, canCreateApplication: false } },
    { ...record, interestId: 'manager', title: 'Sem criação', capabilities: { canManage: true, canCreateApplication: false } },
    { ...record, interestId: 'creator', title: 'Sem gestão', capabilities: { canManage: false, canCreateApplication: true } },
    { ...record, interestId: 'missing', title: 'Sem permissões', capabilities: undefined },
    { ...record, interestId: 'archived', title: 'Arquivado', status: 'ARCHIVED' },
    { ...record, interestId: 'unknown', title: 'Situação desconhecida', status: 'UNKNOWN' },
  ]
  api.list.mockResolvedValue({ data: { items: cases, nextCursor: null, capabilities: { canCreateApplication: true } } })
  page('/interesses?status=ALL&unitId=NONE')
  expect(await screen.findByRole('button', { name: actionName })).toBeTruthy()
  expect(screen.getAllByRole('button', { name: /^Preparar candidatura para/ })).toHaveLength(1)
  for (const item of cases) {
    const link = screen.getByRole('link', { name: `Rever análise de ${item.title}` })
    const target = new URL(link.getAttribute('href'), 'https://example.invalid')
    expect(target.pathname).toBe(`/interesses/${item.interestId}`)
    expect(target.searchParams.get('retorno')).toBe('/interesses?status=ALL&unitId=NONE')
  }
  expect(api.get).not.toHaveBeenCalled(); expect(central.get).not.toHaveBeenCalled()
})

it('re-reads the interest and then the current central revision before opening the existing form', async () => {
  const reading = deferred(); api.get.mockReturnValue(reading.promise)
  const returnTo = '/interesses?q=energia&unitId=NONE&status=ACTIVE&cursor=page-2&previous='
  page(returnTo); await open()
  expect(api.get).toHaveBeenCalledWith('interest', 'org', expect.any(AbortSignal))
  expect(central.get).not.toHaveBeenCalled(); expect(screen.queryByTestId('destination')).toBeNull()
  await act(async () => reading.resolve({ data: currentInterest }))
  const params = new URLSearchParams((await screen.findByTestId('destination')).textContent)
  expect(central.get).toHaveBeenCalledWith('opportunity', expect.any(AbortSignal))
  expect(Object.fromEntries(params)).toEqual({ nova: '1', origem: 'CENTRAL', oportunidade: 'opportunity', revisao: 'current-revision', interesse: 'interest', interesseRevisao: '3', retorno: returnTo })
  expect(sessionStorage.getItem(interestIntentionKey('user', 'org'))).toBeNull()
})

it.each(['pending', 'malformed'])('preserves %s interest recovery and blocks the shortcut', async kind => {
  if (kind === 'pending') saveInterestIntention(pending)
  else sessionStorage.setItem(interestIntentionKey('user', 'org'), 'not json')
  const saved = sessionStorage.getItem(interestIntentionKey('user', 'org'))
  page(); const button = await screen.findByRole('button', { name: actionName })
  expect(button.disabled).toBe(true); fireEvent.click(button)
  expect(api.get).not.toHaveBeenCalled(); expect(central.get).not.toHaveBeenCalled(); expect(api.edit).not.toHaveBeenCalled()
  expect(sessionStorage.getItem(interestIntentionKey('user', 'org'))).toBe(saved)
  expect(kind === 'pending' ? screen.getByRole('button', { name: 'Confirmar envio pendente' }) : screen.getByRole('alert')).toBeTruthy()
})

it('accepts only one opening while the current interest is being read', async () => {
  const reading = deferred(); api.get.mockReturnValue(reading.promise)
  page(); const button = await open(); fireEvent.click(button)
  expect(api.get).toHaveBeenCalledTimes(1)
  await act(async () => reading.resolve({ data: currentInterest }))
  await screen.findByTestId('destination'); expect(central.get).toHaveBeenCalledTimes(1)
})

it.each([
  ['permission loss', { capabilities: { canManage: false, canCreateApplication: false } }],
  ['creation permission loss', { capabilities: { canManage: true, canCreateApplication: false } }],
  ['management permission loss', { capabilities: { canManage: false, canCreateApplication: true } }],
  ['archive', { status: 'ARCHIVED' }],
  ['different interest', { interestId: 'other-interest' }],
  ['different opportunity', { opportunityId: 'other-opportunity' }],
])('refuses %s found by the current interest read', async (_reason, changes) => {
  api.get.mockResolvedValue({ data: { ...currentInterest, ...changes } })
  page(); await open(); await screen.findByRole('alert')
  expect(central.get).not.toHaveBeenCalled(); expect(screen.queryByTestId('destination')).toBeNull()
})

it.each([
  ['archive', { ...currentOpportunity, lifecycleState: 'ARCHIVED' }],
  ['legacy archive', { ...currentOpportunity, snapshot: { lifecycleState: 'ARCHIVED' } }],
  ['different opportunity', { ...currentOpportunity, opportunityId: 'other-opportunity' }],
  ['missing revision', { ...currentOpportunity, revisionId: null }],
])('refuses central %s without opening the form', async (_reason, value) => {
  central.get.mockResolvedValue({ data: value })
  page(); await open(); await screen.findByRole('alert')
  expect(screen.queryByTestId('destination')).toBeNull()
})

it.each(['interest', 'central'])('ignores a late %s read after filters change', async stage => {
  const reading = deferred(); (stage === 'interest' ? api.get : central.get).mockReturnValue(reading.promise)
  page(); await open(); await waitFor(() => expect(stage === 'interest' ? api.get : central.get).toHaveBeenCalledTimes(1))
  const signal = (stage === 'interest' ? api.get.mock.calls[0][2] : central.get.mock.calls[0][1])
  fireEvent.change(screen.getByLabelText('Situação'), { target: { value: 'ARCHIVED' } })
  fireEvent.click(screen.getByRole('button', { name: 'Aplicar filtros' }))
  await waitFor(() => expect(api.list.mock.lastCall[0].status).toBe('ARCHIVED'))
  expect(signal.aborted).toBe(true)
  await act(async () => reading.resolve({ data: stage === 'interest' ? currentInterest : currentOpportunity }))
  expect(screen.queryByTestId('destination')).toBeNull()
  if (stage === 'interest') expect(central.get).not.toHaveBeenCalled()
})

it.each(['organization', 'user'])('ignores a late central response after the %s changes', async context => {
  const reading = deferred(); central.get.mockReturnValue(reading.promise)
  const mounted = page(); await open(); await waitFor(() => expect(central.get).toHaveBeenCalledTimes(1))
  const signal = central.get.mock.calls[0][1]
  auth[context] = { id: `other-${context}` }; mounted.rerender(content())
  await waitFor(() => expect(api.list).toHaveBeenCalledTimes(2)); expect(signal.aborted).toBe(true)
  await act(async () => reading.resolve({ data: currentOpportunity }))
  expect(screen.queryByTestId('destination')).toBeNull()
})

it.each(['interest', 'central'])('allows an explicit retry after a failed %s read', async stage => {
  const failing = stage === 'interest' ? api.get : central.get
  failing.mockRejectedValueOnce(Error('offline'))
  page(); await open(); await screen.findByRole('alert')
  expect(screen.queryByTestId('destination')).toBeNull()
  await waitFor(() => expect(screen.getByRole('button', { name: actionName }).disabled).toBe(false))
  fireEvent.click(screen.getByRole('button', { name: actionName }))
  await screen.findByTestId('destination'); expect(api.get).toHaveBeenCalledTimes(2)
})
