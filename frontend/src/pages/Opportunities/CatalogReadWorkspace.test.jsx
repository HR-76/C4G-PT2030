import React from 'react'
import { afterEach, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter, Routes, Route, Link } from 'react-router-dom'
import CatalogReadWorkspace, {
  exactAmount,
  safeLink,
  Value,
} from './CatalogReadWorkspace'
import {
  createCatalogSession,
  clearCatalogSessions,
  catalogSession,
} from './catalogReadSession'
import { catalogReadApi } from '../../api/api'
vi.mock('../../api/api', () => ({ catalogReadApi: vi.fn() }))
const item = {
  id: 'one',
  title: { state: 'PRESENT', value: 'Energia de teste' },
  externalCode: { state: 'PRESENT', value: 'T-01' },
  descriptionExcerpt: { state: 'PRESENT', value: 'Texto' },
  programmes: { items: [{ id: 'p', label: 'Programa' }] },
  funding: {
    state: 'PRESENT',
    value: {
      amount: '999999999999999999999999.12345678',
      currency: 'EUR',
      scope: 'call',
      basis: 'planned',
      sharedGroupId: 'group',
    },
  },
  fundingLabel: 'Verba partilhada',
  deadline: {
    label: 'Se houver verba',
    state: 'conditional',
    scopeLabel: 'Aviso',
  },
  opening: { state: 'UNKNOWN', value: null },
  status: { label: 'Condicionado' },
  quality: { flags: ['partial'] },
  officialLinks: [],
}
const envelope = (data = [item], nextCursor = null) => ({
  data,
  page: { limit: 25, returned: data.length, hasMore: !!nextCursor, nextCursor },
  meta: {
    snapshot: 'SECRET',
    generationId: 'g',
    asOf: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 900000).toISOString(),
  },
})
const fail = (status) => Promise.reject({ response: { status } })
it('keeps unified opportunity links in their namespace instead of legacy management IDs', async()=>{
 catalogReadApi.mockResolvedValue(envelope())
 render(<MemoryRouter><CatalogReadWorkspace scope="connected" basePath="/catalogo/consulta" isolated={false} /></MemoryRouter>)
 const link=await screen.findByRole('link',{name:'Abrir Energia de teste'})
 expect(link.getAttribute('href')).toMatch(/^\/catalogo\/consulta\/one\?/)
 expect(screen.getByText('GCNI · Catálogo unificado')).toBeTruthy()
 expect(screen.queryByText('GCNI · Laboratório de oportunidades')).toBeNull()
})
afterEach(() => {
  cleanup()
  clearCatalogSessions()
  vi.restoreAllMocks()
  vi.useRealTimers()
  catalogReadApi.mockReset()
})
it.each([401, 403, 410])(
  'clears rows, detail and all capabilities on %s from a section',
  async (status) => {
    const api = vi
        .fn()
        .mockResolvedValueOnce(envelope())
        .mockImplementationOnce(() => fail(status)),
      store = createCatalogSession(api)
    await store.list()
    await store.collection('one', 'documents')
    expect(store.getSnapshot()).toMatchObject({
      pages: [],
      detail: null,
      meta: null,
      sections: {},
      error: { status },
    })
  },
)
it('ignores a response arriving after filters replace an aborted request', async () => {
  let finish
  const api = vi
    .fn()
    .mockImplementationOnce(() => new Promise((r) => (finish = r)))
    .mockResolvedValueOnce(envelope([]))
  const store = createCatalogSession(api)
  const first = store.list()
  await vi.waitFor(() => expect(api).toHaveBeenCalledTimes(1))
  await store.apply({ q: 'new' })
  expect(api.mock.calls[0][2].aborted).toBe(true)
  finish(envelope())
  await first
  expect(store.getSnapshot().pages[0].data).toEqual([])
  store.invalidate(403)
})
it('retains snapshot and cached pages when navigating back', async () => {
  const api = vi
    .fn()
    .mockResolvedValueOnce(envelope([item], 'NEXT'))
    .mockResolvedValueOnce(envelope([{ ...item, id: 'two' }]))
    .mockResolvedValueOnce(envelope({ summary: item }))
  const store = createCatalogSession(api, { q: 'test' })
  await store.list()
  await store.next()
  await store.detail('two')
  expect(api.mock.calls[1][1]).toMatchObject({
    snapshot: 'SECRET',
    cursor: 'NEXT',
    q: 'test',
  })
  store.previous()
  expect(store.getSnapshot().pages[store.getSnapshot().index].data[0].id).toBe(
    'one',
  )
  store.invalidate(403)
})
it('expires absolutely and aborts an outstanding request', async () => {
  vi.useFakeTimers()
  const api = vi
      .fn()
      .mockResolvedValueOnce(envelope())
      .mockImplementationOnce(() => new Promise(() => {})),
    store = createCatalogSession(api)
  await store.list()
  store.collection('one', 'documents')
  await Promise.resolve()
  await vi.advanceTimersByTimeAsync(900000)
  expect(store.getSnapshot().error.status).toBe(410)
  expect(api.mock.calls[1][2].aborted).toBe(true)
})
it('keeps the ficha and snapshot after a transient section error; retry works', async () => {
  const api = vi
      .fn()
      .mockResolvedValueOnce(envelope({ summary: item }))
      .mockImplementationOnce(() => fail(503))
      .mockResolvedValueOnce(envelope([])),
    store = createCatalogSession(api)
  await store.detail('one')
  await store.collection('one', 'documents')
  expect(store.getSnapshot().detail.summary).toBe(item)
  expect(store.getSnapshot().sections.documents.error.status).toBe(503)
  await store.collection('one', 'documents')
  expect(store.getSnapshot().sections.documents.data).toEqual([])
  store.invalidate(403)
})
it('rejects generation substitution within the same consultation', async () => {
  const api = vi
      .fn()
      .mockResolvedValueOnce(envelope())
      .mockResolvedValueOnce({
        ...envelope(),
        meta: { ...envelope().meta, generationId: 'other' },
      }),
    store = createCatalogSession(api)
  await store.list()
  await store.collection('one', 'funding')
  expect(store.getSnapshot().error.status).toBe(410)
})
it('displays exact money, shared/planned labels and safe text/links', () => {
  expect(exactAmount('999999999999999999999999.12345678')).toBe(
    '999 999 999 999 999 999 999 999,12345678',
  )
  expect(safeLink('javascript:alert(1)')).toBeNull()
  expect(safeLink('https://user:pass@example.org')).toBeNull()
  render(<Value value={item.funding} />)
  expect(screen.getByText(/Planeado/)).toBeTruthy()
  expect(screen.getByText(/Verba partilhada/)).toBeTruthy()
})
const view = () => (
  <MemoryRouter initialEntries={['/catalogo']}>
    <Routes>
      <Route path="/catalogo" element={<CatalogReadWorkspace scope="test" />} />
      <Route
        path="/catalogo/:id"
        element={<CatalogReadWorkspace scope="test" />}
      />
    </Routes>
  </MemoryRouter>
)
it('integrates filters, table, lazy detail and return without exposing tokens in links', async () => {
  catalogReadApi.mockImplementation((path) =>
    Promise.resolve(
      path === '/opportunities'
        ? envelope()
        : path === '/opportunities/one'
          ? envelope({
              summary: item,
              description: { state: 'PRESENT', value: 'Descrição completa' },
              statusExplanation: 'Condição aplicável',
              collections: { windows: { completeness: 'complete' } },
            })
          : envelope([]),
    ),
  )
  render(view())
  await screen.findByText('Energia de teste')
  expect(screen.queryByRole('button', { name: /Prazo desde:/ })).toBeNull()
  expect(catalogReadApi.mock.calls[0][1]).not.toHaveProperty('deadline_from')
  const link = screen.getByRole('link', { name: 'Abrir Energia de teste' })
  expect(link.getAttribute('href')).not.toMatch(/SECRET|snapshot|cursor/)
  fireEvent.click(link)
  await screen.findByText('Descrição completa')
  await screen.findByText('Sem elementos registados.')
  fireEvent.click(screen.getByRole('link', { name: /Voltar aos resultados/ }))
  await screen.findByText('Energia de teste')
  fireEvent.click(screen.getByRole('button', { name: 'Limpar filtros' }))
  await act(async () => {})
  expect(catalogReadApi.mock.lastCall[1]).toEqual({})
  expect(screen.queryByRole('button', { name: /Prazo desde:/ })).toBeNull()
})
it('shows access revocation and removes the previously visible table', async () => {
  catalogReadApi
    .mockResolvedValueOnce(envelope())
    .mockImplementation(() => fail(403))
  render(view())
  await screen.findByText('Energia de teste')
  fireEvent(window, new Event('focus'))
  await screen.findByText(/O acesso foi revogado/)
  expect(screen.queryByText('Energia de teste')).toBeNull()
})
it('separates empty results from a failed request', async () => {
  catalogReadApi
    .mockResolvedValueOnce(envelope([]))
    .mockImplementation(() => fail(503))
  render(view())
  await screen.findByText(/Nenhuma oportunidade/)
  fireEvent.click(screen.getByRole('button', { name: 'Pesquisar' }))
  await screen.findByText(/temporariamente indisponível/)
  expect(screen.queryByText(/Nenhuma oportunidade/)).toBeNull()
})

it('paginates options and sections with the same snapshot without duplicating the first page', async () => {
  const api = vi
    .fn()
    .mockResolvedValueOnce(envelope([{ id: 'p1' }], 'OPT'))
    .mockResolvedValueOnce(envelope([{ id: 'p2' }]))
    .mockResolvedValueOnce(envelope([{ id: 'doc1' }], 'DOC'))
    .mockResolvedValueOnce(envelope([{ id: 'doc2' }]))
  const store = createCatalogSession(api)
  await store.options('programme')
  await store.options('programme', true)
  await store.collection('one', 'documents')
  await store.collection('one', 'documents', true)
  expect(api.mock.calls[1][1]).toMatchObject({
    dimension: 'programme',
    cursor: 'OPT',
    snapshot: 'SECRET',
  })
  expect(api.mock.calls[3][1]).toMatchObject({
    cursor: 'DOC',
    snapshot: 'SECRET',
  })
  expect(store.getSnapshot().options.programme.data.map((v) => v.id)).toEqual([
    'p1',
    'p2',
  ])
  expect(store.getSnapshot().sections.documents.data.map((v) => v.id)).toEqual([
    'doc1',
    'doc2',
  ])
  store.invalidate(403)
})
it('clears the previous authority context before accepting a different scope', async () => {
  catalogReadApi
    .mockResolvedValueOnce(envelope())
    .mockImplementation(() => fail(403))
  const mounted = render(
    <MemoryRouter>
      <CatalogReadWorkspace scope="first" />
    </MemoryRouter>,
  )
  await screen.findByText('Energia de teste')
  mounted.rerender(
    <MemoryRouter>
      <CatalogReadWorkspace scope="second" />
    </MemoryRouter>,
  )
  await screen.findByText(/O acesso foi revogado/)
  expect(screen.queryByText('Energia de teste')).toBeNull()
})
it('adopts filters from navigation without persisting snapshot capabilities', async () => {
  catalogReadApi.mockResolvedValue(envelope([]))
  render(
    <MemoryRouter initialEntries={['/catalogo?view=all']}>
      <Link to="/catalogo?q=novo&view=all">Outra pesquisa</Link>
      <CatalogReadWorkspace scope="url" />
    </MemoryRouter>,
  )
  await screen.findByText(/Nenhuma oportunidade/)
  fireEvent.click(screen.getByText('Outra pesquisa'))
  await vi.waitFor(() =>
    expect(catalogReadApi.mock.lastCall[1]).toMatchObject({ q: 'novo' }),
  )
  expect(screen.getByLabelText('Código ou título').value).toBe('novo')
})
it.each([
  'NOT_FOUND',
  'NOT_COLLECTED',
  'NOT_APPLICABLE',
  'CONFLICT',
  'UNSUPPORTED',
])('keeps the %s state distinct from zero or absence', (state) => {
  render(<Value value={{ state, value: null }} />)
  expect(screen.queryByText('Não disponível')).toBeNull()
  expect(document.body.textContent).not.toBe('0')
})
it('indicates the selected alternative without hiding a material conflict', () => {
  render(
    <Value
      value={{
        severity: 'material',
        selectedAlternativeId: 'a',
        alternatives: [
          { id: 'a', value: '10' },
          { id: 'b', value: '20' },
        ],
      }}
    />,
  )
  expect(screen.getByText('Alternativa selecionada')).toBeTruthy()
  expect(screen.getByText('Material')).toBeTruthy()
  expect(screen.getByText('20')).toBeTruthy()
})

it('honours Retry-After before allowing a manual retry', async () => {
  vi.useFakeTimers()
  catalogReadApi.mockRejectedValue({
    response: { status: 429, headers: { 'retry-after': '4' } },
  })
  render(view())
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0)
  })
  expect(
    screen.getByRole('button', { name: 'Tentar novamente em 4 s' }).disabled,
  ).toBe(true)
  await act(async () => {
    await vi.advanceTimersByTimeAsync(4000)
  })
  expect(
    screen.getByRole('button', { name: 'Tentar novamente' }).disabled,
  ).toBe(false)
  expect(catalogReadApi).toHaveBeenCalledTimes(1)
})

it('shows planned source identity without presenting it as a published notice code', async () => {
  const planned = {...item, kind: 'planned_notice', externalCode: {state: 'UNSUPPORTED', value: null}, funding: {state: 'UNSUPPORTED', value: null}, sources: [{namespace: 'PORTUGAL2030_PLAN', externalId: '8485'}]}
  catalogReadApi.mockImplementation(path => Promise.resolve(path === '/opportunities' ? envelope([planned]) : path === '/opportunities/one' ? envelope({summary: planned, statusExplanation: 'PLANNED', description: {state: 'NOT_FOUND', value: null}, collections: {}}) : envelope([])))
  render(view())
  await screen.findByText('ID do plano · 8485')
  expect(screen.getByText('Portugal 2030 · Plano')).toBeTruthy()
  fireEvent.click(screen.getByText('Mais filtros', {exact: true}))
  expect(screen.getByRole('combobox', {name: 'Ordenação', exact: true})).toBeTruthy()
  expect(screen.getByText('Consultar detalhe do financiamento')).toBeTruthy()
  fireEvent.click(screen.getByRole('link', {name: 'Abrir Energia de teste'}))
  await screen.findByText(/Registo do plano: a publicação do aviso/)
  expect(screen.queryByText('Formato não suportado')).toBeNull()
})

it('places the coloured notice state beside opportunity identity in the table',async()=>{
 catalogReadApi.mockResolvedValue(envelope([{...item,status:{code:'open',label:'Aberto'}}]))
 render(<MemoryRouter><CatalogReadWorkspace scope="presentation-order" /></MemoryRouter>)
 await screen.findByRole('table')
 expect(screen.getAllByRole('columnheader').slice(0,2).map(node=>node.textContent)).toEqual(['Oportunidade','Estado do aviso'])
 expect(document.querySelector('td[data-label="Estado do aviso"] .cr-status-open').textContent).toBe('Aberto')
})

it('renders unavailable malformed temporal fields and collections safely', () => {
  render(<Value value={[{kind: 'local_datetime', local: null}, {kind: 'instant'}, {sourceUrls: null, alternatives: null}]} />)
  expect(screen.getAllByText('Não disponível').length).toBe(4)
})

it('isolates concurrent catalog scopes and scoped invalidation', async () => {
 const api=vi.fn().mockResolvedValue(envelope())
 const first=catalogSession('first',api,{}), second=catalogSession('second',api,{})
 await Promise.all([first.list(),second.list()])
 clearCatalogSessions(403,'first')
 expect(first.getSnapshot().error.status).toBe(403)
 expect(second.getSnapshot().pages).toHaveLength(1)
 expect(second.getSnapshot().error).toBeNull()
})

it('shows the four summary fields and preserves filters while browsing the current results', async () => {
 const first={...item,sources:[{namespace:'EU_FUNDING_TENDERS',externalId:'T-01',officialUrl:'https://example.invalid/notice'}]}
 const second={...item,id:'two',title:{state:'PRESENT',value:'Segundo aviso'}}
 catalogReadApi.mockResolvedValue(envelope([first,second]))
 render(<MemoryRouter initialEntries={['/catalogo/consulta?q=energia&status=open']}>
  <CatalogReadWorkspace scope="connected" basePath="/catalogo/consulta" isolated={false}/>
 </MemoryRouter>)
 await screen.findByRole('link',{name:'Abrir Energia de teste'})
 fireEvent.click(screen.getByRole('button',{name:'Lista'}))
 const button=screen.getByRole('button',{name:'Resumo de Energia de teste'})
 fireEvent.click(button)
 const preview=screen.getByRole('region',{name:'Resumo da oportunidade'})
 expect(preview.parentElement.querySelector('.cr-result-cards')).toBeTruthy()
 expect(within(preview).getAllByRole('term').map(term=>term.textContent)).toEqual(['Prazo','Programa','Dotação','Fonte'])
 expect(within(preview).getByText('Se houver verba')).toBeTruthy()
 expect(within(preview).getByText('EU Funding & Tenders')).toBeTruthy()
 expect(within(preview).getByRole('link',{name:/Consultar fonte oficial/}).getAttribute('href')).toBe('https://example.invalid/notice')
 expect(within(preview).getByRole('link',{name:'Abrir ficha completa'}).getAttribute('href')).toBe('/catalogo/consulta/one?q=energia&status=open&view=all')
 const secondButton=screen.getByRole('button',{name:'Resumo de Segundo aviso'})
 fireEvent.click(secondButton)
 expect(within(preview).getByRole('heading',{name:'Segundo aviso'})).toBeTruthy()
 expect(button.getAttribute('aria-expanded')).toBe('false')
 expect(screen.getByLabelText('Código ou título').value).toBe('energia')
 fireEvent.keyDown(preview,{key:'Escape'})
 expect(screen.queryByRole('region',{name:'Resumo da oportunidade'})).toBeNull()
 expect(document.activeElement).toBe(secondButton)
 fireEvent.click(secondButton)
 fireEvent.click(screen.getByRole('button',{name:'Tabela'}))
 expect(screen.queryByRole('region',{name:'Resumo da oportunidade'})).toBeNull()
 expect(screen.getByRole('region',{name:'Tabela de oportunidades'})).toBeTruthy()
})
