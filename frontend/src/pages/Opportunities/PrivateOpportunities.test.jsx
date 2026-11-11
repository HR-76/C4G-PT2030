import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { ToastProvider } from '../../components/ToastProvider'
import { PrivateOpportunityDetail, PrivateOpportunityList, money } from './PrivateOpportunities'
import { privateOpportunitiesApi as opportunitiesApi } from '../../api/api'
vi.mock('../OpportunityCriteria/CriteriaPanel', () => ({ default: () => <div data-testid="criteria-panel" /> }))
vi.mock('../../api/api', () => ({ pq1Api: {session: work => work()}, privateOpportunitiesApi: {list:vi.fn(),get:vi.fn(),update:vi.fn(),create:vi.fn(),archive:vi.fn()}, privateApplicationsApi: {list:vi.fn(async()=>({data:{items:[],nextCursor:null}})),opportunitySummaries:vi.fn(async ids=>({data:{items:ids.map(opportunityId=>({opportunityId,count:0,statuses:{},applicationId:null}))}}))} }))
const org = {id:'71300000-0000-4000-8000-000000000001'}
const id = '71300000-0000-4000-8000-000000000002'
const record = {opportunityId:id,revisionNumber:1,rowVersion:1,snapshot:{title:'Synthetic opportunity',funderName:'Synthetic funder',summary:'Synthetic evidence',fundingAmountMin:'0',fundingAmountMax:'21.5',currencyCode:'USD'},permissions:{edit:true}}
const view = component => render(<MemoryRouter><ToastProvider>{component}</ToastProvider></MemoryRouter>)
afterEach(cleanup)
beforeEach(() => {vi.resetAllMocks();opportunitiesApi.get.mockResolvedValue({data:record});opportunitiesApi.list.mockResolvedValue({data:{items:[],nextCursor:null}})})
describe('private opportunity vertical UI', () => {
  it('mounts criteria only when the server advertises the configured capability', async () => {
    const first=view(<PrivateOpportunityDetail id={id} organization={org} />)
    await screen.findByRole('heading',{name:'Synthetic opportunity'})
    expect(screen.queryByTestId('criteria-panel')).toBeNull()
    first.unmount()
    opportunitiesApi.get.mockResolvedValue({data:{...record,capabilities:{evidencedCriteria:true}}})
    view(<PrivateOpportunityDetail id={id} organization={org} />)
    expect(await screen.findByTestId('criteria-panel')).toBeTruthy()
  })
  it('requires organization before any functional request', () => {
    view(<PrivateOpportunityList organization={null} />)
    expect(screen.getByText(/não tem uma entidade associada/)).toBeTruthy()
    expect(opportunitiesApi.list).not.toHaveBeenCalled()
  })
  it('loads UUID links, cursor pagination and resets cursor with filters', async () => {
    opportunitiesApi.list.mockResolvedValueOnce({data:{items:[{...record,title:record.snapshot.title}],nextCursor:'synthetic-cursor'}})
      .mockResolvedValue({data:{items:[],nextCursor:null}})
    view(<PrivateOpportunityList organization={org} />)
    expect(screen.getByRole('status').textContent).toContain('A carregar')
    expect((await screen.findByRole('link',{name:'Synthetic opportunity'})).getAttribute('href')).toBe(`/oportunidades/${id}`)
    expect(screen.queryByText(/Organização ativa:/)).toBeNull()
    fireEvent.click(screen.getByText('Seguinte'))
    await waitFor(() => expect(opportunitiesApi.list.mock.calls[1][0].cursor).toBe('synthetic-cursor'))
    fireEvent.change(screen.getByLabelText('Programa'),{target:{value:'Synthetic programme'}})
    await waitFor(() => expect(opportunitiesApi.list.mock.calls.at(-1)[0]).not.toHaveProperty('cursor'))
    expect(await screen.findByText('Sem oportunidades privadas')).toBeTruthy()
  })
  it('does not offer edit without server-side permission', async () => {
    opportunitiesApi.get.mockResolvedValue({data:{...record,permissions:{edit:false}}})
    view(<PrivateOpportunityDetail id={id} organization={org} />)
    await screen.findByText(record.snapshot.title)
    expect(screen.queryByText('Editar')).toBeNull()
  })
  it.each([401,403,404,503])('renders a controlled read error %s', async status => {
    opportunitiesApi.get.mockRejectedValue({response:{status}})
    view(<PrivateOpportunityDetail id={id} organization={org} />)
    expect((await screen.findByRole('alert')).textContent).not.toBe('')
    expect(screen.queryByText('Editar')).toBeNull()
  })
  it('requires explicit retry after a refused list admission', async () => {
    opportunitiesApi.list.mockRejectedValueOnce({response:{status:503}}).mockResolvedValue({data:{items:[],nextCursor:null}})
    view(<PrivateOpportunityList organization={org} />)
    await screen.findByRole('alert')
    expect(opportunitiesApi.list).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByText('Repetir consulta'))
    expect(await screen.findByText('Sem oportunidades privadas')).toBeTruthy()
    expect(opportunitiesApi.list).toHaveBeenCalledTimes(2)
  })
  it('formats exact amounts without inventing a currency', () => {
    expect(money({fundingAmountMin:'100000000000000000.123456',fundingAmountMax:'100000000000000000.123456',currencyCode:'USD'})).toContain('.123456 USD')
    expect(money({fundingAmountMin:'0'})).toBe('Não indicado')
  })
  it('never exposes authoring even if an older response still advertises grants',async()=>{
    opportunitiesApi.list.mockResolvedValue({data:{items:[],permissions:{create:true}}})
    const first=view(<PrivateOpportunityList organization={org} />)
    await screen.findByText('Sem oportunidades privadas')
    expect(screen.queryByText('Criar oportunidade privada')).toBeNull()
    expect(opportunitiesApi.list.mock.calls[0][0].lifecycleState).toBe('ACTIVE')
    first.unmount();opportunitiesApi.get.mockResolvedValue({data:{...record,permissions:{edit:true,archive:true}}})
    view(<PrivateOpportunityDetail id={id} organization={org} />);await screen.findByText(record.snapshot.title)
    expect(screen.queryByText('Editar')).toBeNull();expect(screen.queryByText('Arquivar oportunidade')).toBeNull()
    expect(opportunitiesApi.create).not.toHaveBeenCalled();expect(opportunitiesApi.update).not.toHaveBeenCalled();expect(opportunitiesApi.archive).not.toHaveBeenCalled()
  })

})

it('coalesces private text filters, cancels the old request and clears to active records', async () => {
  const mounted = view(<PrivateOpportunityList organization={org} />)
  await waitFor(() => expect(opportunitiesApi.list).toHaveBeenCalledTimes(1))
  const signal = opportunitiesApi.list.mock.calls[0][1]
  fireEvent.change(screen.getByLabelText('Programa'), { target: { value: 'H' } })
  fireEvent.change(screen.getByLabelText('Programa'), { target: { value: 'Horizon' } })
  expect(signal.aborted).toBe(true)
  expect(opportunitiesApi.list).toHaveBeenCalledTimes(1)
  await waitFor(() => expect(opportunitiesApi.list).toHaveBeenCalledTimes(2))
  expect(opportunitiesApi.list.mock.lastCall[0].programmeName).toBe('Horizon')
  fireEvent.click(screen.getByRole('button', { name: 'Limpar filtros' }))
  await waitFor(() => expect(opportunitiesApi.list.mock.lastCall[0]).toEqual({ lifecycleState: 'ACTIVE', pageSize: 20, sort: 'UPDATED_DESC' }))
  const lastSignal = opportunitiesApi.list.mock.lastCall[1]
  mounted.unmount(); expect(lastSignal.aborted).toBe(true)
})
