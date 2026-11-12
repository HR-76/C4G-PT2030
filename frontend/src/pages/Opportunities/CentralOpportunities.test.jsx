import React from 'react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom'
import CentralOpportunities from './CentralOpportunities'
import { centralOpportunitiesApi as api, platformCentralOpportunitiesApi as platformApi, catalogReadApi, privateApplicationsApi, opportunityInterestsApi as interestApi } from '../../api/api'
const state = vi.hoisted(() => ({ organization: { id: 'a' }, user: { id: 'user' } }))
vi.mock('../../contexts/AuthContext', () => ({ useAuth: () => state }))
vi.mock('../../api/api', () => ({ catalogReadApi: vi.fn(async()=>{throw {response:{status:503}}}), opportunityInterestsApi: {context:vi.fn(),summaries:vi.fn(),units:vi.fn(),create:vi.fn()},centralOpportunitiesApi: { list: vi.fn(), get: vi.fn() }, platformCentralOpportunitiesApi: { list: vi.fn(), get: vi.fn() }, privateApplicationsApi: { list: vi.fn(async () => ({ data: { items: [], nextCursor: null } })), opportunitySummaries: vi.fn(async ids => ({ data: { items: ids.map(opportunityId => ({ opportunityId, count: 0, statuses: {}, applicationId: null })) } })) } }))
const response = (items = [], nextCursor = null) => ({ data: { items, nextCursor, programmes: ['Horizon'], sourceMode: 'fixture' } })
const view = () => <MemoryRouter><CentralOpportunities /></MemoryRouter>
const current = () => ({ closingFrom: new Date().toISOString().slice(0, 10) })

it('cancels replaced catalog reads and ignores responses after filters or context change', async () => {
  let finish
  api.list.mockReturnValueOnce(new Promise(resolve => { finish = resolve }))
  const mounted = render(view())
  const firstSignal = api.list.mock.calls[0][1]
  expect(firstSignal).toBeInstanceOf(AbortSignal)
  expect(firstSignal.aborted).toBe(false)
  fireEvent.change(screen.getByLabelText('Pesquisar'), { target: { value: 'climate' } })
  fireEvent.click(screen.getByRole('button', { name: 'Aplicar filtros' }))
  expect(firstSignal.aborted).toBe(true)
  await screen.findByText('Sem resultados para estes filtros')
  await act(async () => { finish(response([{ opportunityId: 'old', title: 'Obsolete private response' }])) })
  expect(screen.queryByText('Obsolete private response')).toBeNull()
  const replacedSignal = api.list.mock.lastCall[1]
  state.organization = { id: 'b' }
  mounted.rerender(view())
  expect(replacedSignal.aborted).toBe(true)
  const activeSignal = api.list.mock.lastCall[1]
  mounted.unmount()
  expect(activeSignal.aborted).toBe(true)
})

it('cancels platform catalog detail reads when leaving the view', () => {
  state.organization = null; state.user.platformRoles = ['C4G_ADMIN']
  platformApi.get.mockReturnValue(new Promise(() => {}))
  const mounted = render(<MemoryRouter initialEntries={['/catalogo/one']}><Routes><Route path="/catalogo/:id" element={<CentralOpportunities />} /></Routes></MemoryRouter>)
  const signal = platformApi.get.mock.calls[0][1]
  expect(signal).toBeInstanceOf(AbortSignal)
  expect(signal.aborted).toBe(false)
  mounted.unmount()
  expect(signal.aborted).toBe(true)
})

it('keeps planned opportunities as an explicit filter and exports only the loaded page', async () => {
  api.list.mockResolvedValue(response([{ opportunityId: 'one', title: 'Current page' }], 'next-page'))
  const originalCreate = Object.getOwnPropertyDescriptor(URL, 'createObjectURL'), originalRevoke = Object.getOwnPropertyDescriptor(URL, 'revokeObjectURL')
  const create = vi.fn(() => 'blob:current-page'), revoke = vi.fn(), click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
  Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: create })
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: revoke })
  try {
    render(view())
    fireEvent.click(await screen.findByRole('button', { name: 'Exportar página' }))
    expect(create).toHaveBeenCalledTimes(1); expect(click).toHaveBeenCalledTimes(1)
    expect(click.mock.instances[0].download).toBe('oportunidades-pagina.csv')
    expect(revoke).toHaveBeenCalledWith('blob:current-page'); expect(api.list).toHaveBeenCalledTimes(1)
    fireEvent.change(screen.getByLabelText('Estado temporal'), { target: { value: 'PLANNED' } })
    fireEvent.click(screen.getByRole('button', { name: 'Aplicar filtros' }))
    await waitFor(() => expect(api.list).toHaveBeenLastCalledWith({ temporalState: 'PLANNED' }, expect.any(AbortSignal)))
  } finally {
    click.mockRestore()
    if (originalCreate) Object.defineProperty(URL, 'createObjectURL', originalCreate); else delete URL.createObjectURL
    if (originalRevoke) Object.defineProperty(URL, 'revokeObjectURL', originalRevoke); else delete URL.revokeObjectURL
  }
})

it('saves interest from the table using the current revision and hides new registration for archived records', async()=>{
 api.list.mockResolvedValue(response([{opportunityId:'one',title:'Open call',lifecycleState:'ACTIVE'},{opportunityId:'old',title:'Archived call',lifecycleState:'ARCHIVED'}]))
 api.get.mockResolvedValue({data:{opportunityId:'one',revisionId:'current-revision',snapshot:{lifecycleState:'ACTIVE'}}})
 render(<MemoryRouter><Routes><Route path="/" element={<CentralOpportunities/>}/><Route path="/candidaturas" element={<p>Formulário de candidatura</p>}/></Routes></MemoryRouter>)
 const button=await screen.findByRole('button',{name:'Registar interesse em Open call'})
 expect(screen.queryByRole('button',{name:'Registar interesse em Archived call'})).toBeNull()
 const row=button.closest('tr')
 expect(screen.getAllByRole('columnheader').at(-1).textContent).toBe('Interesse')
 expect(within(row).getAllByRole('button')).toHaveLength(1)
 expect(row.classList.contains('catalog-interest-registered')).toBe(false)
 expect(screen.queryByText('Sem candidaturas visíveis')).toBeNull()
 expect(button.querySelector('svg').getAttribute('fill')).toBe('none')
 fireEvent.click(button);await screen.findByRole('dialog');fireEvent.click(await screen.findByLabelText('Interesse transversal à C4G'));fireEvent.click(screen.getByRole('button',{name:'Guardar interesse'}))
 const saved=await within(row).findByRole('link',{name:'Consultar na lista de interesses: Open call'})
 expect(saved.querySelector('svg').getAttribute('fill')).toBe('currentColor')
 expect(row.classList.contains('catalog-interest-registered')).toBe(true)
 expect(within(row).queryByRole('button')).toBeNull()
 expect(saved.getAttribute('href').split('?')[0]).toBe('/interesses')
 expect(screen.queryByRole('link',{name:'Consultar na lista de interesses'})).toBeNull()
 expect(privateApplicationsApi.opportunitySummaries).not.toHaveBeenCalled()
 expect(api.get).toHaveBeenCalledWith('one');expect(interestApi.create).toHaveBeenCalledWith(expect.objectContaining({opportunityId:'one',centralRevisionId:'current-revision',unitIds:[]}),'a');expect(screen.queryByText('Formulário de candidatura')).toBeNull()
})
it('starts an application straight from the table, without an interest, using the current revision',async()=>{
 api.list.mockResolvedValue(response([{opportunityId:'one',title:'Open call',lifecycleState:'ACTIVE'},{opportunityId:'old',title:'Archived call',lifecycleState:'ARCHIVED'}]))
 api.get.mockResolvedValue({data:{opportunityId:'one',revisionId:'current-revision',snapshot:{lifecycleState:'ACTIVE'}}})
 interestApi.context.mockResolvedValue({data:{capabilities:{canRegister:true,canManage:true,canCreateApplication:true}}})
 let target=''
 const Probe=()=>{const l=useLocation();target=l.pathname+l.search;return <p>Formulário de candidatura</p>}
 render(<MemoryRouter><Routes><Route path="/" element={<CentralOpportunities/>}/><Route path="/candidaturas" element={<Probe/>}/></Routes></MemoryRouter>)
 const button=await screen.findByRole('button',{name:'Iniciar candidatura para Open call'})
 expect(screen.queryByRole('button',{name:'Iniciar candidatura para Archived call'})).toBeNull()
 fireEvent.click(button)
 await screen.findByText('Formulário de candidatura')
 const url=new URL(target,'https://example.invalid')
 expect(url.searchParams.get('nova')).toBe('1');expect(url.searchParams.get('origem')).toBe('CENTRAL')
 expect(url.searchParams.get('oportunidade')).toBe('one');expect(url.searchParams.get('revisao')).toBe('current-revision')
 expect(url.searchParams.has('interesse')).toBe(false)
 expect(api.get).toHaveBeenCalledWith('one');expect(interestApi.create).not.toHaveBeenCalled()
})
it('shows Iniciar candidatura beside the heart when the summaries response carries the capability',async()=>{
 api.list.mockResolvedValue(response([{opportunityId:'one',title:'Open call',lifecycleState:'ACTIVE'}]))
 interestApi.summaries.mockImplementation(ids=>Promise.resolve({data:{capabilities:{canRegister:true,canManage:true,canCreateApplication:true},items:ids.map(opportunityId=>({opportunityId,interestId:null,status:null,unitIds:[]}))}}))
 render(view())
 const start=await screen.findByRole('button',{name:'Iniciar candidatura para Open call'})
 expect(within(start.closest('tr')).getByRole('button',{name:'Registar interesse em Open call'})).toBeTruthy()
 expect(interestApi.context).not.toHaveBeenCalled()
})
it('hides Iniciar candidatura when the profile cannot create applications and offers Interesses and Candidaturas',async()=>{
 api.list.mockResolvedValue(response([{opportunityId:'one',title:'Open call',lifecycleState:'ACTIVE'}]))
 render(view());await screen.findByRole('button',{name:'Registar interesse em Open call'})
 expect(screen.queryByRole('button',{name:/Iniciar candidatura/})).toBeNull()
 expect(screen.getByRole('heading',{name:'Oportunidades'})).toBeTruthy()
 expect(screen.getByRole('link',{name:'Interesses'}).getAttribute('href')).toBe('/interesses')
 expect(screen.getByRole('link',{name:'Candidaturas'}).getAttribute('href')).toBe('/candidaturas')
})
it.each(['ARCHIVED',null,'UNKNOWN'])('does not highlight an interest with status %s as registered',async status=>{
 api.list.mockResolvedValue(response([{opportunityId:'one',title:'Open call'}]))
 interestApi.summaries.mockResolvedValue({data:{items:[{opportunityId:'one',interestId:'saved',status}]}})
 render(view());const row=(await screen.findByRole('link',{name:'Open call'})).closest('tr')
 await waitFor(()=>expect(interestApi.summaries).toHaveBeenCalled())
 expect(row.classList.contains('catalog-interest-registered')).toBe(false)
 expect(screen.queryByText('Interesse registado')).toBeNull()
 expect(screen.queryByRole('button',{name:'Registar interesse em Open call'})).toBeNull()
})
it('keeps an uncertain save recoverable without colouring the row as registered',async()=>{
 api.list.mockResolvedValue(response([{opportunityId:'one',title:'Open call'}]))
 api.get.mockResolvedValue({data:{opportunityId:'one',revisionId:'current-revision',lifecycleState:'ACTIVE'}})
 interestApi.create.mockRejectedValue({response:{status:503}})
 render(view());const button=await screen.findByRole('button',{name:'Registar interesse em Open call'}),row=button.closest('tr')
 fireEvent.click(button);fireEvent.click(await screen.findByLabelText('Interesse transversal à C4G'));fireEvent.click(await screen.findByRole('button',{name:'Guardar interesse'}))
 await screen.findByRole('button',{name:'Confirmar envio pendente'})
 expect(row.classList.contains('catalog-interest-registered')).toBe(false)
 expect(screen.queryByText('Interesse registado')).toBeNull()
})
it('keeps the catalog available when resolving interest fails',async()=>{
 api.list.mockResolvedValue(response([{opportunityId:'one',title:'Open call',lifecycleState:'ACTIVE'}]));api.get.mockRejectedValue(Error('unavailable'))
 render(view());fireEvent.click(await screen.findByRole('button',{name:'Registar interesse em Open call'}));await screen.findByText('Não foi possível preparar o interesse. Tente novamente.');expect(screen.getByRole('button',{name:'Registar interesse em Open call'}).disabled).toBe(false)
})
afterEach(cleanup)
beforeEach(() => { vi.resetAllMocks(); sessionStorage.clear(); state.organization = { id: 'a' }; state.user = { id: 'user' }; api.list.mockResolvedValue(response());interestApi.context.mockResolvedValue({data:{capabilities:{canRegister:true}}});interestApi.summaries.mockImplementation(ids=>Promise.resolve({data:{items:ids.map(opportunityId=>({opportunityId,interestId:null,status:null,unitIds:[]}))}}));interestApi.units.mockResolvedValue({data:{items:[]}});interestApi.create.mockResolvedValue({data:{opportunityId:'one',interestId:'saved',status:'ACTIVE'}}) })
it('identifies synthetic data and distinguishes empty catalog from filtered results', async () => {
  render(view())
  expect(await screen.findByText('Dados de teste')).toBeTruthy()
  expect(api.list).toHaveBeenLastCalledWith({}, expect.any(AbortSignal))
  fireEvent.click(screen.getByRole('button', { name: 'Limpar filtros' }))
  expect(await screen.findByText('Ainda não existem oportunidades no catálogo comum.')).toBeTruthy()
  expect(api.list).toHaveBeenLastCalledWith({}, expect.any(AbortSignal))
  fireEvent.change(screen.getByLabelText('Pesquisar'), { target: { value: 'climate' } })
  fireEvent.click(screen.getByRole('button', { name: 'Aplicar filtros' }))
  expect(await screen.findByText('Sem resultados para estes filtros')).toBeTruthy()
  expect(api.list).toHaveBeenLastCalledWith({ q: 'climate' }, expect.any(AbortSignal))
})
it('supports next/back and resets cursor when applying filters', async () => {
  api.list.mockImplementation(query => Promise.resolve(response([{ opportunityId: 'one', title: 'Public opportunity' }], query.cursor ? null : 'next')))
  render(view()); await screen.findByText('Public opportunity')
  fireEvent.click(screen.getByRole('button', { name: 'Página seguinte' }))
  await waitFor(() => expect(api.list).toHaveBeenLastCalledWith({ cursor: 'next' }, expect.any(AbortSignal)))
  fireEvent.click(await screen.findByRole('button', { name: 'Página anterior' }))
  await waitFor(() => expect(api.list).toHaveBeenLastCalledWith({}, expect.any(AbortSignal)))
  fireEvent.change(screen.getByLabelText('Programa'), { target: { value: 'Horizon' } })
  fireEvent.click(screen.getByRole('button', { name: 'Aplicar filtros' }))
  await waitFor(() => expect(api.list).toHaveBeenLastCalledWith({ programme: 'Horizon' }, expect.any(AbortSignal)))
})
it('clears old organization data and ignores its delayed response', async () => {
  let finish
  api.list.mockReturnValueOnce(new Promise(resolve => { finish = resolve }))
  const mounted = render(view()); state.organization = { id: 'b' }; mounted.rerender(view())
  await screen.findByText('Ainda não existem oportunidades no catálogo comum.')
  finish(response([{ opportunityId: 'old', title: 'Stale result' }]))
  await waitFor(() => expect(api.list).toHaveBeenCalledTimes(2))
  expect(screen.queryByText('Stale result')).toBeNull()
})
it('offers retry after failure and prevents inverted dates', async () => {
  api.list.mockRejectedValueOnce(new Error('offline'))
  render(view()); fireEvent.click(await screen.findByRole('button', { name: 'Tentar novamente' }))
  await screen.findByText('Ainda não existem oportunidades no catálogo comum.')
  fireEvent.change(screen.getByLabelText('Fecho a partir de'), { target: { value: '2027-12-01' } })
  fireEvent.change(screen.getByLabelText('Fecho até'), { target: { value: '2027-01-01' } })
  expect(screen.getByRole('button', { name: 'Aplicar filtros' }).disabled).toBe(true)
})
it('combines programme with closing shortcuts and keeps catalogue-wide choices', async () => {
  render(view()); await screen.findByText('Ainda não existem oportunidades no catálogo comum.')
  fireEvent.change(screen.getByLabelText('Programa'), { target: { value: 'Horizon' } })
  fireEvent.change(screen.getByLabelText('Prazo'), { target: { value: '30' } })
  expect(api.list.mock.lastCall[0].programme).not.toBe('Horizon')
  fireEvent.click(screen.getByRole('button', { name: 'Aplicar filtros' }))
  const today = current().closingFrom
  const end = new Date(Date.parse(today) + 30 * 86400000).toISOString().slice(0, 10)
  await waitFor(() => expect(api.list).toHaveBeenLastCalledWith({ programme: 'Horizon', closingFrom: today, closingTo: end }, expect.any(AbortSignal)))
  fireEvent.change(screen.getByLabelText('Prazo'), { target: { value: 'past' } })
  fireEvent.click(screen.getByRole('button', { name: 'Aplicar filtros' }))
  await waitFor(() => expect(api.list).toHaveBeenLastCalledWith({ programme: 'Horizon', closingTo: new Date(Date.parse(today) - 86400000).toISOString().slice(0, 10) }, expect.any(AbortSignal)))
  expect(screen.getByRole('option', { name: 'Horizon' })).toBeTruthy()
})
it('renders source text inertly and identifies absent descriptions', async () => {
  api.get.mockResolvedValue({ data: { snapshot: { title: 'Detail', summary: '<img src=x onerror=alert(1)>' }, sourceMode: 'fixture' } })
  const detail = () => <MemoryRouter initialEntries={['/catalogo/one']}><Routes><Route path="/catalogo/:id" element={<CentralOpportunities />} /></Routes></MemoryRouter>
  const mounted = render(detail()); await screen.findByText('<img src=x onerror=alert(1)>')
  expect(document.querySelector('article img')).toBeNull()
  mounted.unmount(); api.get.mockResolvedValue({ data: { snapshot: { title: 'Empty' } } })
  render(detail()); expect(await screen.findByText(/Descrição não disponível neste registo/)).toBeTruthy()
})
it('preserves applied filters when returning from detail and offers organizational registration', async () => {
  api.list.mockResolvedValue(response([{ opportunityId: 'one', title: 'Public opportunity' }]))
  api.get.mockResolvedValue({ data: { opportunityId: 'one', revisionId: 'revision-one', snapshot: { title: 'Public opportunity', lifecycleState: 'ACTIVE' } } })
  render(<MemoryRouter><Routes><Route path="/" element={<CentralOpportunities />} /><Route path="/catalogo" element={<CentralOpportunities />} /><Route path="/catalogo/:id" element={<CentralOpportunities />} /></Routes></MemoryRouter>)
  await screen.findByText('Public opportunity')
  fireEvent.change(screen.getByLabelText('Programa'), { target: { value: 'Horizon' } })
  fireEvent.change(screen.getByLabelText('Prazo'), { target: { value: '30' } })
  expect(api.list.mock.lastCall[0].programme).not.toBe('Horizon')
  fireEvent.click(screen.getByRole('button', { name: 'Aplicar filtros' }))
  await waitFor(() => expect(api.list.mock.lastCall[0].programme).toBe('Horizon'))
  fireEvent.click(await screen.findByRole('link', { name: 'Public opportunity' }))
  expect(await screen.findByRole('button', { name: 'Registar interesse em Public opportunity' })).toBeTruthy()
  expect(screen.queryByRole('link',{name:'Registar interesse'})).toBeNull()
  fireEvent.click(screen.getByRole('link', { name: 'Voltar ao catálogo' }))
  await screen.findByRole('link', { name: 'Public opportunity' })
  expect(screen.getByLabelText('Programa').value).toBe('Horizon')
  expect(screen.getByLabelText('Prazo').value).toBe('30')
  expect(api.list.mock.lastCall[0].closingTo).toBe(new Date(Date.parse(current().closingFrom) + 30 * 86400000).toISOString().slice(0, 10))
})
it('lets platform administration read and filter the public catalog without private calls', async () => {
  state.organization = null; state.user.platformRoles = ['C4G_ADMIN']
  platformApi.list.mockResolvedValue(response([{ opportunityId: 'one', title: 'Public opportunity' }]))
  render(view()); await screen.findByRole('link', { name: 'Public opportunity' })
  expect(api.list).not.toHaveBeenCalled()
  expect(privateApplicationsApi.opportunitySummaries).not.toHaveBeenCalled()
  expect(interestApi.context).not.toHaveBeenCalled()
  expect(screen.queryByRole('columnheader', { name: 'Candidaturas' })).toBeNull()
  expect(screen.queryByRole('link', { name: 'Oportunidades privadas' })).toBeNull()
  fireEvent.change(screen.getByLabelText('Programa'), { target: { value: 'Horizon' } })
  fireEvent.click(screen.getByRole('button', { name: 'Aplicar filtros' }))
  await waitFor(() => expect(platformApi.list).toHaveBeenLastCalledWith({ programme: 'Horizon' }, expect.any(AbortSignal)))
})
it('does not mount organizational application actions in the platform detail', async () => {
  state.organization = null; state.user.platformRoles = ['C4G_ADMIN']
  platformApi.get.mockResolvedValue({ data: { opportunityId: 'one', snapshot: { title: 'Public detail', lifecycleState: 'ACTIVE' }, sourceMode: 'live-local' } })
  render(<MemoryRouter initialEntries={['/catalogo/one']}><Routes><Route path="/catalogo/:id" element={<CentralOpportunities />} /></Routes></MemoryRouter>)
  await screen.findByRole('heading', { name: 'Public detail' })
  expect(privateApplicationsApi.list).not.toHaveBeenCalled()
  expect(api.get).not.toHaveBeenCalled()
  expect(screen.queryByRole('link', { name: /Criar candidatura/ })).toBeNull()
})
it('cannot use global legacy ADMIN as platform authority without organization context', () => {
  state.organization = null; state.user.role = 'ADMIN'
  render(view())
  expect(api.list).not.toHaveBeenCalled(); expect(platformApi.list).not.toHaveBeenCalled()
  expect(screen.getByText(/Escolha uma organização autorizada/)).toBeTruthy()
})
it('keeps a reopened documentary resolution visible as history in the catalog detail', async () => {
  state.organization = null; state.user.platformRoles = ['C4G_ADMIN']
  platformApi.get.mockResolvedValue({ data: {
    opportunityId: 'one', sourceReview: 'CONFLICT', temporal: { state: 'UNKNOWN' },
    snapshot: { title: 'Aviso revisto', lifecycleState: 'ACTIVE', sourceResolution: {
      schemaVersion: 1, decidedAt: '2026-10-28T23:00:00Z', reason: 'Prazo confirmado na ficha oficial.',
      note: 'O prazo retirado fica no histórico.', sources: [{ title: 'Ficha ECHE', url: 'https://ec.europa.eu/fiche.pdf' }],
    } },
  } })
  render(<MemoryRouter initialEntries={['/catalogo/one']}><Routes><Route path="/catalogo/:id" element={<CentralOpportunities />} /></Routes></MemoryRouter>)
  await screen.findByRole('heading', { name: 'Aviso revisto' })
  expect(screen.getByText('Resolução anterior — requer nova revisão.')).toBeTruthy()
  expect(screen.getByText('Prazo confirmado na ficha oficial.')).toBeTruthy()
  expect(screen.getByRole('link', { name: 'Ficha ECHE' }).getAttribute('href')).toBe('https://ec.europa.eu/fiche.pdf')
  expect(screen.getByText('A fonte requer nova revisão. Os dados anteriores foram preservados.')).toBeTruthy()
  expect(screen.getByText('Por confirmar')).toBeTruthy()
})

it.each([false,true])('shows updated habitual catalog for platform admin=%s without an exposure lease',async platform=>{
 state.organization=platform?null:{id:'a'};state.user={id:'user',platformRoles:platform?['C4G_ADMIN']:[]};
 const selected=platform?platformApi:api;
 const interventionClassification={status:'CLASSIFIED',areas:[{code:'RESEARCH',label:'Investigação e Inovação',evidence:[]}]};
 const catalogPresentation={presentation:{typification:{value:'Concurso'},areas:{value:'Ciência'}},callInformation:{topic:{value:'TOPIC-1'},eligibleCandidates:{value:'Entidades elegíveis'},duration:{value:'12 meses'},location:{value:'Portugal'}},description:{value:'Descrição integral verificada da call'}};
 selected.list.mockResolvedValue(response([{opportunityId:'one',title:'Aviso de teste',temporal:{state:'CLOSED'},catalogPresentation,interventionClassification}]));
 selected.get.mockResolvedValue({data:{opportunityId:'one',snapshot:{title:'Aviso de teste'},temporal:{state:'CLOSED'},catalogPresentation,interventionClassification}});
 render(<MemoryRouter initialEntries={['/catalogo']}><Routes><Route path="/catalogo" element={<CentralOpportunities/>}/><Route path="/catalogo/:id" element={<CentralOpportunities/>}/></Routes></MemoryRouter>);
 await screen.findByRole('link',{name:'Aviso de teste'});
 expect(selected.list).toHaveBeenCalledWith({},expect.any(AbortSignal));expect(screen.getByLabelText('Prazo').value).toBe('all');
 expect(screen.getByText('Encerrado').className).toContain('cr-status-closed');screen.getByText('Concurso');screen.getByText('Investigação e Inovação');
 expect(catalogReadApi).not.toHaveBeenCalled();expect(screen.queryByText('Explorar catálogo unificado')).toBeNull();
 fireEvent.click(screen.getByRole('link',{name:'Aviso de teste'}));await screen.findByRole('heading',{name:'Aviso de teste'});
 for(const label of ['Topic','Candidatos elegíveis','Duração','Localização'])screen.getByText(label);
 screen.getByText('12 meses');screen.getByText('Descrição integral verificada da call');
 if(platform){expect(privateApplicationsApi.opportunitySummaries).not.toHaveBeenCalled();expect(privateApplicationsApi.list).not.toHaveBeenCalled();expect(interestApi.context).not.toHaveBeenCalled();}
});

it.each([false,true])('combines source with dates and status, resets pagination and removes only source for platform=%s',async platform=>{
 state.organization=platform?null:{id:'a'};state.user={id:'user',platformRoles:platform?['C4G_ADMIN']:[]}
 const selected=platform?platformApi:api
 selected.list.mockResolvedValue(response([{opportunityId:'one',title:'Source result'}],'next-page'))
 render(view())
 await screen.findByText('Source result')
 fireEvent.click(screen.getByRole('button',{name:'Página seguinte'}))
 await waitFor(()=>expect(selected.list.mock.lastCall[0].cursor).toBe('next-page'))
 fireEvent.change(screen.getByLabelText('Fonte'),{target:{value:'POCTEP'}})
 fireEvent.change(screen.getByLabelText('Fecho a partir de'),{target:{value:'2026-11-01'}})
 fireEvent.change(screen.getByLabelText('Estado temporal'),{target:{value:'OPEN'}})
 expect(screen.getByLabelText('Fecho a partir de').value).toBe('2026-11-01')
 screen.getByText('Alterações por aplicar')
 fireEvent.click(screen.getByRole('button',{name:'Aplicar filtros'}))
 await waitFor(()=>expect(selected.list).toHaveBeenLastCalledWith({source:'POCTEP',closingFrom:'2026-11-01',temporalState:'OPEN'},expect.any(AbortSignal)))
 const link=await screen.findByRole('link',{name:'Source result'})
 expect(link.getAttribute('href')).toContain('source=POCTEP')
 expect(screen.queryByText('Alterações por aplicar')).toBeNull()
 fireEvent.click(screen.getByRole('button',{name:'Remover filtro de fonte'}))
 await waitFor(()=>expect(selected.list).toHaveBeenLastCalledWith({closingFrom:'2026-11-01',temporalState:'OPEN'},expect.any(AbortSignal)))
 expect(screen.getByLabelText('Fonte').value).toBe('')
 fireEvent.click(screen.getByRole('button',{name:'Limpar filtros'}))
 await waitFor(()=>expect(selected.list).toHaveBeenLastCalledWith({},expect.any(AbortSignal)))
})

it('restores source from URL and preserves official links and return to the filtered catalog',async()=>{
 api.list.mockResolvedValue(response([{opportunityId:'one',title:'Official call'}]))
 api.get.mockResolvedValue({data:{opportunityId:'one',snapshot:{title:'Official call',officialUrl:'https://www.poctep.eu/aviso'},source:'POCTEP'}})
 render(<MemoryRouter initialEntries={['/catalogo?view=filtered&source=POCTEP']}><Routes><Route path="/catalogo" element={<CentralOpportunities/>}/><Route path="/catalogo/:id" element={<CentralOpportunities/>}/></Routes></MemoryRouter>)
 await screen.findByRole('link',{name:'Official call'})
 expect(api.list).toHaveBeenLastCalledWith({source:'POCTEP'},expect.any(AbortSignal))
 fireEvent.click(screen.getByRole('link',{name:'Official call'}))
 await screen.findByRole('heading',{name:'Official call'})
 expect(document.querySelector('a[href="https://www.poctep.eu/aviso"]')).toBeTruthy()
 fireEvent.click(screen.getByRole('link',{name:'Voltar ao catálogo'}))
 await screen.findByRole('link',{name:'Official call'})
 expect(screen.getByLabelText('Fonte').value).toBe('POCTEP')
})

it('keeps an invalid source visible and allows recovery without misreporting a permission failure',async()=>{
 api.list.mockRejectedValueOnce({response:{data:{error:{code:'INVALID_INPUT'}}}})
 render(<MemoryRouter initialEntries={['/catalogo?view=filtered&source=forged']}><CentralOpportunities/></MemoryRouter>)
 expect((await screen.findByRole('alert')).textContent).toContain('Filtros inválidos')
 expect(screen.getByLabelText('Fonte').value).toBe('forged')
 fireEvent.click(screen.getByRole('button',{name:'Limpar filtros'}))
 await waitFor(()=>expect(api.list).toHaveBeenLastCalledWith({},expect.any(AbortSignal)))
 expect(screen.getByLabelText('Fonte').value).toBe('')
})

it('offers one Portugal 2030 option and European programmes provided by the catalogue',async()=>{
 api.list.mockResolvedValue({data:{...response().data,programmes:['CENTRO2030','Horizon Europe (HORIZON)','Programme for the Environment and Climate Action (LIFE)']}})
 render(view());await screen.findByRole('option',{name:'Horizon Europe (HORIZON)'})
 expect(screen.getAllByRole('option',{name:'Portugal 2030',exact:true})).toHaveLength(1)
 expect(screen.queryByRole('option',{name:'Registo manual C4G'})).toBeNull()
 expect(screen.queryByRole('option',{name:/Portugal 2030.*plano/i})).toBeNull()
 fireEvent.change(screen.getByLabelText('Fonte'),{target:{value:'PORTUGAL2030'}})
 fireEvent.click(screen.getByRole('button',{name:'Aplicar filtros'}))
 await waitFor(()=>expect(api.list).toHaveBeenLastCalledWith({source:'PORTUGAL2030'},expect.any(AbortSignal)))
})
it('keeps individual column choices in detail links when applying filters without sending columns to the API',async()=>{
  api.list.mockResolvedValue(response([{opportunityId:'one',title:'Aviso de ensaio'}]))
  render(view())
  await screen.findByRole('link',{name:'Aviso de ensaio'})
  fireEvent.click(screen.getByText('Colunas',{selector:'summary'}))
  fireEvent.click(screen.getByRole('button',{name:'Comparar programa, fecho e dotação'}))
  fireEvent.click(screen.getByText('Colunas',{selector:'summary'}))
  fireEvent.click(screen.getByRole('checkbox',{name:'Dotação da call'}))
  fireEvent.change(screen.getByLabelText('Pesquisar'),{target:{value:'ensaio'}})
  fireEvent.click(screen.getByRole('button',{name:'Aplicar filtros'}))
  const link=await screen.findByRole('link',{name:'Aviso de ensaio'})
  const query=new URL(link.href).searchParams
  expect(query.get('colunas')).toBe('fecho,programa')
  expect(query.get('q')).toBe('ensaio')
  expect(api.list).toHaveBeenLastCalledWith({q:'ensaio'},expect.any(AbortSignal))
  expect(screen.queryByRole('columnheader',{name:'Dotação da call'})).toBeNull()
})

it('requests ordering from the catalog and resets the page cursor when the order changes', async () => {
  api.list.mockResolvedValue(response([{ opportunityId:'one', title:'Exemplo' }], 'next-page'))
  render(view())
  fireEvent.click(await screen.findByRole('button', {name:'Página seguinte'}))
  await screen.findByText('Página 2')
  fireEvent.change(screen.getByLabelText('Ordenar resultados'), {target:{value:'amount_desc'}})
  await waitFor(() => expect(api.list.mock.lastCall[0]).toEqual({sort:'amount_desc'}))
  await screen.findByText('Página 1')
})
