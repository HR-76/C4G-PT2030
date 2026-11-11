import React from 'react'
import { afterEach, expect, it, vi } from 'vitest'
import { render, screen, cleanup, fireEvent, act, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { collectPages, summarizeOrganizationDashboard, sumMoney, lisbonDay } from '../api/organizationDashboard'
import Dashboard from '../pages/Dashboard'
import { clearConfirmedReads } from '../api/confirmedReads'
const state = vi.hoisted(() => ({ get: vi.fn(), organization: vi.fn(), organizationReport: vi.fn(), reportPage: vi.fn(), auth: {} }))
vi.mock('../api/api', () => ({ dashboardApi: state }))
vi.mock('../contexts/AuthContext', () => ({ useAuth: () => state.auth }))
afterEach(() => { cleanup(); vi.resetAllMocks(); clearConfirmedReads() })
const deferred = () => {
  let resolve, reject
  const promise = new Promise((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
const dashboardResponse = (organizationId = 'a', title = 'Oportunidade atual') => ({ data: {
  ...summarizeOrganizationDashboard([], [], [], '2026-10-29', { organizationId, items: [], unitsAvailable: false, digest: 'snapshot', generatedAt: '2026-10-29T10:00:00Z' }),
  recent_opportunities: [{ id: title, title, href: '/catalogo/current' }],
} })

it('shows dashboard navigation immediately without inventing indicators while the summary is pending', async () => {
  state.auth = { user: { id: 'u' }, organization: { id: 'a', displayName: 'Entidade A' } }
  const pending = deferred()
  state.organization.mockReturnValue(pending.promise)
  render(<MemoryRouter initialEntries={['/dashboard?vista=indicadores']}><Dashboard /></MemoryRouter>)
  expect(screen.getByRole('heading', { name: 'Dashboard operacional' })).toBeTruthy()
  expect(screen.getByRole('link', { name: 'Ver oportunidades' }).getAttribute('href')).toBe('/catalogo')
  expect(screen.getByRole('link', { name: 'Acompanhar candidaturas' }).getAttribute('href')).toBe('/candidaturas')
  fireEvent.click(screen.getByRole('button', { name: 'Relatório da organização' }))
  expect(screen.getByText('A carregar os indicadores da organização…')).toBeTruthy()
  expect(screen.queryByText('Sem candidaturas acessíveis')).toBeNull()
  expect(document.querySelector('.dashboard-stats')).toBeNull()
  expect(screen.queryByRole('button', { name: 'Exportar candidaturas para Excel' })).toBeNull()
  await act(async () => { pending.resolve(dashboardResponse()) })
  expect(await screen.findByRole('button', { name: 'Exportar candidaturas para Excel' })).toBeTruthy()
})

it('cancels the StrictMode probe and the active request on unmount', () => {
  state.auth = { user: { id: 'u' }, organization: { id: 'a' } }
  state.organization.mockImplementation(() => new Promise(() => {}))
  const mounted = render(<React.StrictMode><MemoryRouter initialEntries={['/dashboard?vista=indicadores']}><Dashboard /></MemoryRouter></React.StrictMode>)
  expect(state.organization).toHaveBeenCalledTimes(2)
  const [first, current] = state.organization.mock.calls.map(([request]) => request)
  expect(first.signal).toBeInstanceOf(AbortSignal)
  expect(first.signal.aborted).toBe(true)
  expect(first.isCurrent()).toBe(false)
  expect(current.signal.aborted).toBe(false)
  expect(current.isCurrent()).toBe(true)
  mounted.unmount()
  expect(current.signal.aborted).toBe(true)
  expect(current.isCurrent()).toBe(false)
})

it('cancels a replaced read and ignores its late result when refreshing', async () => {
  state.auth = { user: { id: 'u' }, organization: { id: 'a' } }
  const first = deferred(), second = deferred()
  state.organization.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)
  render(<MemoryRouter initialEntries={['/dashboard?vista=indicadores']}><Dashboard /></MemoryRouter>)
  const oldRequest = state.organization.mock.calls[0][0]
  fireEvent.click(screen.getByRole('button', { name: 'Atualizar' }))
  expect(oldRequest.signal.aborted).toBe(true)
  expect(oldRequest.isCurrent()).toBe(false)
  await act(async () => { first.resolve(dashboardResponse('a', 'Resultado substituído')) })
  expect(screen.queryByText('Resultado substituído')).toBeNull()
  expect(screen.getByText('A carregar os indicadores da organização…')).toBeTruthy()
  await act(async () => { second.resolve(dashboardResponse('a', 'Resultado atual')) })
  expect(await screen.findByRole('link', { name: 'Resultado atual' })).toBeTruthy()
})

it.each(['organization', 'user'])('cancels the old read when the %s changes and never renders its result', async changed => {
  state.auth = { user: { id: 'u' }, organization: { id: 'a', displayName: 'Entidade A' } }
  const first = deferred(), second = deferred()
  state.organization.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)
  const mounted = render(<MemoryRouter initialEntries={['/dashboard?vista=indicadores']}><Dashboard /></MemoryRouter>)
  const oldRequest = state.organization.mock.calls[0][0]
  state.auth = changed === 'organization'
    ? { ...state.auth, organization: { id: 'b', displayName: 'Entidade B' } }
    : { ...state.auth, user: { id: 'other' } }
  mounted.rerender(<MemoryRouter initialEntries={['/dashboard?vista=indicadores']}><Dashboard /></MemoryRouter>)
  expect(oldRequest.signal.aborted).toBe(true)
  expect(oldRequest.isCurrent()).toBe(false)
  await act(async () => { first.resolve(dashboardResponse('a', 'Dados anteriores')) })
  expect(screen.queryByText('Dados anteriores')).toBeNull()
  expect(screen.getByText('A carregar os indicadores da organização…')).toBeTruthy()
  await act(async () => { second.resolve(dashboardResponse(state.auth.organization.id)) })
  expect(await screen.findByRole('link', { name: 'Oportunidade atual' })).toBeTruthy()
})

it('does not request a summary without an organization', () => {
  state.auth = { user: { id: 'u' }, organization: null }
  state.organization.mockResolvedValue(dashboardResponse())
  render(<MemoryRouter initialEntries={['/dashboard?vista=indicadores']}><Dashboard /></MemoryRouter>)
  expect(screen.getByText('Entidade não associada')).toBeTruthy()
  expect(state.organization).not.toHaveBeenCalled()
})

it('keeps navigation available after an error and retries without displaying false totals', async () => {
  state.auth = { user: { id: 'u' }, organization: { id: 'a' } }
  state.organization.mockRejectedValueOnce(new Error('Unavailable')).mockResolvedValueOnce(dashboardResponse())
  render(<MemoryRouter initialEntries={['/dashboard?vista=indicadores']}><Dashboard /></MemoryRouter>)
  expect(await screen.findByRole('alert')).toBeTruthy()
  expect(screen.getByRole('heading', { name: 'Dashboard operacional' })).toBeTruthy()
  expect(screen.getByRole('link', { name: 'Ver oportunidades' })).toBeTruthy()
  expect(document.querySelector('.dashboard-stats')).toBeNull()
  expect(screen.queryByText('Sem candidaturas acessíveis')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }))
  expect(await screen.findByRole('link', { name: 'Oportunidade atual' })).toBeTruthy()
  expect(screen.queryByRole('alert')).toBeNull()
})

it('removes previous indicators and their timestamp while refreshing', async () => {
  state.auth = { user: { id: 'u' }, organization: { id: 'a' } }
  const pending = deferred()
  state.organization.mockResolvedValueOnce(dashboardResponse()).mockReturnValueOnce(pending.promise)
  render(<MemoryRouter initialEntries={['/dashboard?vista=indicadores']}><Dashboard /></MemoryRouter>)
  await screen.findByRole('link', { name: 'Oportunidade atual' })
  expect(document.querySelector('.dashboard-stats')).toBeTruthy()
  expect(screen.getByRole('button', { name: 'Informação sobre o dashboard' })).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Atualizar' }))
  expect(screen.getByRole('heading', { name: 'Dashboard operacional' })).toBeTruthy()
  expect(screen.queryByRole('link', { name: 'Oportunidade atual' })).toBeNull()
  expect(document.querySelector('.dashboard-stats')).toBeNull()
  expect(screen.queryByRole('button', { name: 'Informação sobre o dashboard' })).toBeNull()
})

it.each(['organization', 'user'])('never commits loaded data under a different %s context', async changed => {
  state.auth = { user: { id: 'u' }, organization: { id: 'a', displayName: 'Entidade A' } }
  state.organization.mockResolvedValueOnce(dashboardResponse('a', 'Dados privados anteriores'))
    .mockReturnValueOnce(new Promise(() => {}))
  const commits = []
  function ObserveCommit() {
    React.useLayoutEffect(() => { commits.push(document.body.textContent) })
    return null
  }
  const tree = () => <MemoryRouter initialEntries={['/dashboard?vista=indicadores']}><Dashboard /><ObserveCommit /></MemoryRouter>
  const mounted = render(tree())
  await screen.findByRole('link', { name: 'Dados privados anteriores' })
  commits.length = 0
  state.auth = changed === 'organization'
    ? { ...state.auth, organization: { id: 'b', displayName: 'Entidade B' } }
    : { ...state.auth, user: { id: 'other' } }
  mounted.rerender(tree())
  expect(commits.length).toBeGreaterThan(0)
  expect(commits.every(text => !text.includes('Dados privados anteriores'))).toBe(true)
  expect(screen.getByText('A carregar os indicadores da organização…')).toBeTruthy()
})

it('allows a new export after refreshing while an old export is still pending', async () => {
  state.auth = { user: { id: 'u' }, organization: { id: 'a' } }
  const oldExport = deferred()
  state.organization.mockResolvedValue(dashboardResponse())
  state.organizationReport.mockReturnValueOnce(oldExport.promise)
    .mockRejectedValueOnce({ response: { status: 409 } })
  render(<MemoryRouter initialEntries={['/dashboard?vista=indicadores']}><Dashboard /></MemoryRouter>)
  await screen.findByRole('link', { name: 'Oportunidade atual' })
  fireEvent.click(screen.getByRole('button', { name: 'Relatório da organização' }))
  fireEvent.click(screen.getByRole('button', { name: 'Exportar candidaturas para Excel' }))
  expect(screen.getByRole('button', { name: 'A preparar Excel…' }).disabled).toBe(true)
  fireEvent.click(screen.getByRole('button', { name: 'Atualizar' }))
  await waitFor(() => expect(state.organization).toHaveBeenCalledTimes(2))
  const currentExport = await screen.findByRole('button', { name: 'Exportar candidaturas para Excel' })
  expect(currentExport.disabled).toBe(false)
  await act(async () => { oldExport.resolve({ data: new Blob(['obsolete']) }) })
  expect(screen.queryByRole('alert')).toBeNull()
  fireEvent.click(currentExport)
  expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'Os dados mudaram. Atualize os indicadores antes de exportar.')
  expect(state.organizationReport).toHaveBeenCalledTimes(2)
})
it('downloads the workbook with an Excel filename', async () => {
  state.auth = { user: { id: 'u' }, organization: { id: 'a' } }
  const workbook = new Blob(['xlsx'], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
  state.organization.mockResolvedValue(dashboardResponse())
  state.organizationReport.mockResolvedValue({ data: workbook })
  const create = vi.fn(() => 'blob:report'), revoke = vi.fn()
  vi.stubGlobal('URL', class extends URL { static createObjectURL = create; static revokeObjectURL = revoke })
  const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
  try {
    render(<MemoryRouter initialEntries={['/dashboard?vista=indicadores']}><Dashboard /></MemoryRouter>)
    fireEvent.click(await screen.findByRole('button', { name: 'Relatório da organização' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Exportar candidaturas para Excel' }))
    await waitFor(() => expect(click).toHaveBeenCalledTimes(1))
    expect(create).toHaveBeenCalledWith(workbook)
    expect(click.mock.instances[0].download).toBe('relatorio-candidaturas-c4g.xlsx')
    expect(revoke).toHaveBeenCalledWith('blob:report')
  } finally {
    click.mockRestore()
    vi.unstubAllGlobals()
  }
})
it('reads every authorized page and rejects an incomplete total', async () => {
  const list = vi.fn().mockResolvedValueOnce({ data: { items: [1], nextCursor: 'next' } }).mockResolvedValueOnce({ data: { items: [2] } })
  expect(await collectPages(list)).toEqual([1, 2])
  expect(list.mock.calls[1][0]).toEqual({ cursor: 'next' })
  await expect(collectPages(vi.fn().mockResolvedValue({ data: { items: [], nextCursor: 'repeat' } }))).rejects.toThrow('Repeated cursor')
  await expect(collectPages(vi.fn().mockRejectedValue(new Error('Forbidden')))).rejects.toThrow('Forbidden')
})
it('stops reading when the organization changes, including between pages', async () => {
  let current = true
  const list = vi.fn(async () => { current = false; return { data: { items: ['private'], nextCursor: 'next' } } })
  await expect(collectPages(list, () => current)).rejects.toThrow('Incomplete read')
  expect(list).toHaveBeenCalledTimes(1)
})
it('keeps unknown dates and budgets distinct from zero and excludes archived opportunities', () => {
  const result = summarizeOrganizationDashboard([
    { opportunityId: 'a', title: 'Current', lifecycleState: 'ACTIVE', closingDate: '2026-10-31' },
    { opportunityId: 'b', lifecycleState: 'ACTIVE', closingDate: null },
    { opportunityId: 'c', lifecycleState: 'ARCHIVED', closingDate: '2026-10-18' },
  ], [], [{ applicationId: 'd', title: 'Draft', status: 'INTENTION', deadline: '2026-10-19' }], '2026-10-17')
  expect(result.opportunities).toEqual({ total: 3, open: 1, closing_soon: 1 })
  expect(result.applications.active).toBe(1)
  expect(result.budget.total).toBeNull()
  expect(result.deadlines[0].days_left).toBe(2)
  expect(result.recent_opportunities[0].href).toBe('/catalogo/a')
})
it('mounts the organization dashboard using current services without Matching links', async () => {
  state.auth = { user: { id: 'u' }, organization: { id: 'a', displayName: 'Entidade A' } }
  state.organization.mockResolvedValue({ data: summarizeOrganizationDashboard([], [], [], '2026-10-17') })
  render(<MemoryRouter initialEntries={['/dashboard?vista=indicadores']}><Dashboard /></MemoryRouter>)
  expect(await screen.findByRole('heading', { name: 'Dashboard operacional' })).toBeTruthy()
  expect(state.get).not.toHaveBeenCalled()
  expect(screen.getByText('Entidade A')).toBeTruthy()
  expect(screen.getByText('Sem candidaturas acessíveis')).toBeTruthy()
  expect([...document.querySelectorAll('a')].some(a => a.getAttribute('href').includes('/matching'))).toBe(false)
})

it('keeps the dashboard markup aligned with its responsive CSS contract', async () => {
  state.auth = { user: { id: 'u' }, organization: { id: 'a', displayName: 'Entidade A' } }
  state.organization.mockResolvedValue({ data: {
    opportunities: { total: 3, open: 2, closing_soon: 1 },
    catalogIndicators: { total: 2, open: 1, closingSoon: 0 },
    applications: { total: 2, active: 2, by_status: { IDENTIFIED: 2 } },
    budget: { total: '10.00', missing: 1 },
    deadlines: [{ id: 'application-a', title: 'Candidatura A', days_left: 4 }],
    recent_opportunities: [],
    source_totals: [{ source: 'POCTEP', total: 3 }],
    today: '2026-10-26',
    report: { generatedAt: '2026-10-26T10:00:00Z', approvalHistory: {all: {total: '200.50', count: 3, missing: 1}, '2026': {total: '125.50', count: 2, missing: 1}, '2026-10': {total: '125.50', count: 2, missing: 1}, '2025': {total: '75.00', count: 1, missing: 0}} },
  } })
  render(<MemoryRouter initialEntries={['/dashboard?vista=indicadores']}><Dashboard /></MemoryRouter>)
  await screen.findByRole('heading', { name: 'Dashboard operacional' })

  const stats = [...document.querySelectorAll('.dashboard-stats > .stat-item')]
  expect(stats).toHaveLength(6)
  expect(screen.getByText('Oportunidades da plataforma').closest('a').querySelector('.stat-num').textContent).toBe('2')
  const approved = screen.getByText('Orçamento global aprovado').closest('.stat-item')
  expect(approved.textContent).toContain('125,50 €')
  expect(approved.textContent).toContain('200,50 €')
  expect(approved.textContent).toContain('2026 · 125,50 € · 2 aprovações · 1 sem valor')
  const period = screen.getByRole('combobox', {name: 'Ano'})
  fireEvent.change(period, {target: {value: '2026'}})
  expect(screen.getByText('Outubro').closest('li').textContent).toContain('125,50 €')
  fireEvent.change(period, {target: {value: ''}})
  expect(screen.queryByText('Outubro')).toBeNull()
  expect(stats.every(item => item.querySelector('.stat-num') && item.querySelector('.stat-lbl'))).toBe(true)
  expect(document.querySelector('.metric-row > .metric-bar > i')?.style.width).toBe('100%')
  expect(document.querySelectorAll('.dashboard-list, .deadline-group ul')).toHaveLength(2)
  expect(document.querySelector('.dashboard-grid .section-hd > h2')?.textContent).toBe('Pipeline de candidaturas')
})

it('computes decisions, exact budgets, missing amounts, source provenance and internal overdue dates', () => {
  const items = ['IDENTIFIED','INTENTION','PREPARATION','SUBMITTED','APPROVED','REJECTED','CANCELLED','ARCHIVED'].map((status,i) => ({ applicationId: String(i), status, deadline: i === 0 ? '2026-10-01' : '2026-12-31', totalBudget: '0.10', organizationBudget: i === 4 ? '0.20' : null }))
  const result = summarizeOrganizationDashboard([{ source:'POCTEP', lifecycleState:'ACTIVE', closingDate:'2026-11-01' }, { source:'CORDIS', lifecycleState:'ACTIVE', closingDate:'2026-10-19' }],[],items,'2026-10-18')
  expect(result.applications).toMatchObject({ total:8, active:4, submitted:3, approved:1, rejected:1, decisions:2, successRate:50 })
  expect(result.applications.totalBudget.total).toBe('0.80')
  expect(result.budget).toMatchObject({ total:'0.20', approved:'0.20', missing:7, approvedMissing:0 })
  expect(result.source_totals.map(r=>r.source)).toEqual(['CORDIS','POCTEP'])
  expect(result.deadlines[0].days_left).toBe(-17)
  expect(sumMoney([{v:'99999999999999.99'},{v:'0.01'}], 'v').total).toBe('100000000000000.00')
  expect(sumMoney([{v:null}], 'v').total).toBeNull()
  expect(sumMoney([{v:'0'}], 'v').total).toBe('0.00')
  expect(sumMoney([], 'v').total).toBe('0.00')
  expect(lisbonDay(new Date('2026-07-01T23:30:00Z'))).toBe('2026-07-02')
})

it('reconciles unit and state reports, and handles a stale export without downloading', async () => {
  const items=[{applicationId:'a',title:'Projeto A',status:'APPROVED',unitId:'one',organizationBudget:'10.01',totalBudget:'20.01'},{applicationId:'b',title:'Projeto B',status:'SUBMITTED',unitId:null,organizationBudget:null,totalBudget:null}]
  const report={items,unitsAvailable:true,units:[{unitId:'one',label:'Departamento A',people:1},{unitId:null,label:'Sem unidade atribuída',people:0}],digest:'x',generatedAt:'2026-10-18T10:00:00Z'}
  const result=summarizeOrganizationDashboard([],[],items,'2026-10-18',report)
  expect(result.unit_totals.reduce((sum,row)=>sum+row.total,0)).toBe(2)
  state.auth={user:{id:'u'},organization:{id:'org',displayName:'Entidade A'}}
  state.organization.mockResolvedValue({data:result});state.organizationReport.mockRejectedValue({response:{status:409}})
  render(<MemoryRouter initialEntries={['/dashboard?vista=indicadores']}><Dashboard /></MemoryRouter>)
  fireEvent.click(await screen.findByRole('button',{name:'Relatório da organização'}))
  expect(screen.getByRole('cell',{name:'Departamento A',exact:true})).toBeTruthy()
  expect(screen.queryByText(/Distribuição pela unidade principal atual/)).toBeNull()
  expect(screen.getByText(/Por unidade, cada candidatura pertence à unidade principal do responsável, sem somar subunidades/)).toBeTruthy()
  fireEvent.click(screen.getByRole('button',{name:'Candidaturas',exact:true}))
  expect(screen.getByRole('link',{name:'Projeto A'}).getAttribute('href')).toBe('/candidaturas/a')
  fireEvent.click(screen.getByRole('button',{name:'Exportar candidaturas para Excel'}))
  expect(await screen.findByRole('alert')).toHaveProperty('textContent','Os dados mudaram. Atualize os indicadores antes de exportar.')
  expect(state.organizationReport).toHaveBeenCalledWith({organizationId:'org',digest:'x'})
})
it('loads report details by page without recomputing the server totals', async () => {
 const first={applicationId:'a',title:'Primeira página',status:'IDENTIFIED'},second={applicationId:'b',title:'Segunda página',status:'APPROVED'}
 const report={organizationId:'org',items:[first],total:26,page:1,pageSize:25,nextCursor:'next',previousCursor:null,digest:'snapshot',unitsAvailable:false,units:[]}
 const summary=summarizeOrganizationDashboard([],[],[first],'2026-10-26',report)
 summary.applications.total=26
 state.auth={user:{id:'u'},organization:{id:'org',displayName:'Entidade'}}
 state.organization.mockResolvedValue({data:summary})
 state.reportPage.mockResolvedValue({data:{...report,items:[second],page:2,nextCursor:null,previousCursor:'previous'}})
 render(<MemoryRouter initialEntries={['/dashboard?vista=indicadores']}><Dashboard /></MemoryRouter>)
 fireEvent.click(await screen.findByRole('button',{name:'Relatório da organização'}))
 fireEvent.click(screen.getByRole('button',{name:'Candidaturas',exact:true}))
 fireEvent.click(screen.getByRole('button',{name:'Seguinte'}))
 expect(await screen.findByRole('link',{name:'Segunda página'})).toBeTruthy()
 expect(screen.queryByRole('link',{name:'Primeira página'})).toBeNull()
 expect(screen.getByText(/Página 2 · 26 candidaturas/)).toBeTruthy()
 expect(state.reportPage).toHaveBeenCalledWith(expect.objectContaining({organizationId:'org',cursor:'next',signal:expect.any(AbortSignal)}))
})
it('links the catalog subset to the open state and the dashboard UTC deadline window', async () => {
  state.auth = { user: { id: 'u' }, organization: { id: 'a' } }
  const response = dashboardResponse()
  response.data.opportunities.open = 4
  response.data.catalogIndicators = { open: 3, closingSoon: 1, asOfDay: '2026-10-29' }
  state.organization.mockResolvedValue(response)
  render(<MemoryRouter initialEntries={['/dashboard?vista=indicadores']}><Dashboard /></MemoryRouter>)
  const open = await screen.findByRole('link', { name: /4 Oportunidades abertas.*Ver no catálogo \(3\)/ })
  expect(open.getAttribute('href')).toContain('temporalState=OPEN')
  const soon = screen.getByRole('link', { name: /Fecham em 14 dias/ })
  expect(soon.getAttribute('href')).toContain('closingFrom=2026-10-29&closingTo=2026-11-12')
})
it('opens charts directly without revealing restricted units or treating missing budgets as zero',async()=>{
  state.auth={user:{id:'u'},organization:{id:'a'}}
  const response=dashboardResponse()
  response.data.applications.totalBudget={total:null,missing:1,count:1}
  response.data.applications.organizationBudget={total:'0.00',missing:0,count:1}
  state.organization.mockResolvedValue(response)
  render(<MemoryRouter initialEntries={['/dashboard?vista=graficos']}><Dashboard/></MemoryRouter>)
  expect(await screen.findAllByText('Sem acesso aos indicadores do diretório.')).toHaveLength(2)
  expect(screen.getByText('Não disponível')).toBeTruthy()
  expect(screen.getByText('Sem candidaturas acessíveis.')).toBeTruthy()
  expect(screen.getByText('1 sem valor registado')).toBeTruthy()
})

it('abre o dashboard com Gráficos à esquerda e selecionado', async () => {
  state.organization.mockResolvedValue(dashboardResponse())
  render(<MemoryRouter><Dashboard /></MemoryRouter>)
  const charts = screen.getByRole('button', { name: 'Gráficos' })
  await screen.findByText('Sem candidaturas acessíveis.')
  expect(charts.previousElementSibling).toBeNull()
  expect(charts.getAttribute('aria-pressed')).toBe('true')
})

it('mostra quatro indicadores principais na vista de gráficos', async () => {
  state.organization.mockResolvedValue(dashboardResponse())
  render(<MemoryRouter><Dashboard /></MemoryRouter>)
  await screen.findByText('Sem candidaturas acessíveis.')
  const links = [...screen.getByRole('region', { name: 'Indicadores principais' }).querySelectorAll('a')]
  expect(links).toHaveLength(4)
  expect(links[0].textContent).toContain('Candidaturas acessíveis')
  expect(links[0].getAttribute('href')).toBe('/candidaturas')
  expect(links[3].getAttribute('href')).toBe('#approval-timeline')
})

it('destaca prazos autorizados na vista inicial e liga à candidatura',async()=>{
 state.auth={user:{id:'u'},organization:{id:'a',displayName:'Entidade A'}};const response=dashboardResponse();response.data.deadlines=[{id:'app-1',title:'Preparar candidatura',days_left:2}];state.organization.mockResolvedValue(response)
 render(<MemoryRouter><Dashboard/></MemoryRouter>);const link=await screen.findByRole('link',{name:'Preparar candidatura'});expect(link.getAttribute('href')).toBe('/candidaturas/app-1');expect(screen.getByText('Faltam 2 dias')).toBeTruthy()
})

it('explica o âmbito dos indicadores sem alterar os valores',async()=>{
 state.auth={user:{id:'u'},organization:{id:'a',displayName:'Entidade A'}};state.organization.mockResolvedValue(dashboardResponse());render(<MemoryRouter initialEntries={['/dashboard?vista=indicadores']}><Dashboard/></MemoryRouter>)
 const button=await screen.findByRole('button',{name:'Âmbito dos indicadores'});const tooltip=document.getElementById(button.getAttribute('aria-describedby'));expect(tooltip.textContent).toMatch(/não representa financiamento recebido/);expect(tooltip.textContent).toMatch(/registos acessíveis nesta entidade/)
})

it('shows indicators already received on return, reads them again and removes them when the read is refused', async () => {
  state.auth = { user: { id: 'u' }, organization: { id: 'a', displayName: 'Entidade A' } }
  state.organization.mockResolvedValueOnce(dashboardResponse('a', 'Oportunidade conhecida'))
  const tree = () => <MemoryRouter initialEntries={['/dashboard?vista=indicadores']}><Dashboard /></MemoryRouter>
  render(tree())
  await screen.findByRole('link', { name: 'Oportunidade conhecida' })
  cleanup()
  const again = deferred()
  state.organization.mockReturnValueOnce(again.promise)
  render(tree())
  expect(screen.getByRole('link', { name: 'Oportunidade conhecida' })).toBeTruthy()
  expect(screen.queryByText('A carregar os indicadores da organização…')).toBeNull()
  expect(state.organization).toHaveBeenCalledTimes(2)
  await act(async () => { again.reject(new Error('refused')) })
  expect(screen.queryByRole('link', { name: 'Oportunidade conhecida' })).toBeNull()
  cleanup()
  state.organization.mockReturnValueOnce(deferred().promise)
  render(tree())
  expect(screen.queryByRole('link', { name: 'Oportunidade conhecida' })).toBeNull()
  expect(screen.getByText('A carregar os indicadores da organização…')).toBeTruthy()
})

it('never shows indicators kept for another user or organization', async () => {
  state.auth = { user: { id: 'u' }, organization: { id: 'a', displayName: 'Entidade A' } }
  state.organization.mockResolvedValueOnce(dashboardResponse('a', 'Dados privados anteriores'))
  const tree = () => <MemoryRouter initialEntries={['/dashboard?vista=indicadores']}><Dashboard /></MemoryRouter>
  render(tree())
  await screen.findByRole('link', { name: 'Dados privados anteriores' })
  for (const auth of [{ user: { id: 'other' }, organization: { id: 'a' } }, { user: { id: 'u' }, organization: { id: 'b' } }]) {
    cleanup(); state.auth = auth; state.organization.mockReturnValueOnce(deferred().promise)
    render(tree())
    expect(screen.queryByRole('link', { name: 'Dados privados anteriores' })).toBeNull()
    expect(screen.getByText('A carregar os indicadores da organização…')).toBeTruthy()
  }
})
