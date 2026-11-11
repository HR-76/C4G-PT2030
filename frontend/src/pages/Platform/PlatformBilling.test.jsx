import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { BillingView } from './PlatformBilling'
import { formatMoney } from './billingPresentation'

afterEach(cleanup)

const cycle = { cycleId: '22222222-2222-4222-8222-222222222222', organizationId: '11111111-1111-4111-8111-111111111111', organizationName: 'Município Exemplo', organizationLegalName: 'Município de Exemplo', periodStart: '2026-01-01', periodEnd: '2026-12-31', serviceDescription: 'Subscrição anual', currency: 'EUR', cycleAmount: '12345678901234.123456', plannedIssueDate: '2026-01-05', dueDate: '2026-02-04', cycleState: 'ISSUED', document: { id: '33333333-3333-4333-8333-333333333333', type: 'INVOICE', number: 'FT 2026/1', issueDate: '2026-01-05', dueDate: '2026-02-04', state: 'ISSUED', revision: 1 }, adjustedTotal: '12345678901234.123456', paidAmount: '400', balanceAmount: '12345678900834.123456', paymentState: 'PARTIALLY_PAID', overdue: true }
const summary = { currencies: [{ currency: 'EUR', billedAmount: cycle.adjustedTotal, receivedAmount: '400', outstandingAmount: cycle.balanceAmount, overdueAmount: cycle.balanceAmount, documentCount: 1, organizationsWithBalance: 1 }, { currency: 'USD', billedAmount: '10', receivedAmount: '0', outstandingAmount: '10', overdueAmount: '0', documentCount: 1, organizationsWithBalance: 1 }] }
const list = { items: [cycle], total: 1, page: 1, pageSize: 25 }
const response = data => Promise.resolve({ data })
function Location(){const location=useLocation();return <output data-testid="location">{location.pathname+location.search}</output>}
function NavigableBilling({api}){const navigate=useNavigate();return <><button onClick={()=>navigate('/administracao/faturacao?q=Nova')}>Mudar pesquisa</button><BillingView api={api}/></>}
function deferred(){let resolve;const promise=new Promise(done=>{resolve=done});return {promise,resolve}}
function mount(api, directoryApi={entities:vi.fn(()=>response({items:[]}))},path='/administracao/faturacao'){
 return render(<MemoryRouter initialEntries={[path]}><Routes><Route path="/administracao/faturacao" element={<><BillingView api={api} directoryApi={directoryApi}/><Location/></>}/><Route path="/administracao/faturacao/:id" element={<p>Detalhe aberto</p>}/></Routes></MemoryRouter>)
}

describe('faturação administrativa',()=>{
 it('formata decimais grandes sem os converter para Number e separa moedas',async()=>{
  expect(formatMoney('12345678901234.123456','EUR')).toBe('12 345 678 901 234,123456 EUR')
  const api={summary:vi.fn(()=>response(summary)),cycles:vi.fn(()=>response(list))};mount(api)
  await waitFor(()=>expect(screen.getAllByText((_,element)=>element.textContent==='12 345 678 901 234,123456 EUR').length).toBeGreaterThan(0))
  expect(screen.getByText('USD')).toBeTruthy();expect(screen.getByText('Município Exemplo')).toBeTruthy()
  expect(screen.getAllByText('Vencido').length).toBeGreaterThan(0)
 })

 it('reflete filtros no URL, reinicia a página e distingue ausência de resultados',async()=>{
  const api={summary:vi.fn(()=>response({currencies:[]})),cycles:vi.fn(()=>response({items:[],total:0,page:3,pageSize:25}))};mount(api,undefined,'/administracao/faturacao?q=Anterior&page=3')
  await screen.findByText('Nenhum ciclo corresponde aos filtros')
  fireEvent.change(screen.getByLabelText('Entidade ou documento'),{target:{value:'Município'}})
  fireEvent.change(screen.getByLabelText('Estado do ciclo'),{target:{value:'ISSUED'}})
  fireEvent.click(screen.getByRole('button',{name:'Aplicar filtros'}))
  await waitFor(()=>expect(screen.getByTestId('location').textContent).toBe('/administracao/faturacao?q=Munic%C3%ADpio&cycleStatus=ISSUED'))
  await waitFor(()=>expect(api.cycles).toHaveBeenLastCalledWith({q:'Município',cycleStatus:'ISSUED'},expect.any(AbortSignal)))
 })

 it('ignora respostas antigas quando os filtros mudam durante o carregamento',async()=>{
  const oldSummary=deferred(),newSummary=deferred(),oldCycles=deferred(),newCycles=deferred()
  const newerCycle={...cycle,cycleId:'44444444-4444-4444-8444-444444444444',organizationName:'Entidade Nova'}
  const api={summary:vi.fn().mockReturnValueOnce(oldSummary.promise).mockReturnValueOnce(newSummary.promise),cycles:vi.fn().mockReturnValueOnce(oldCycles.promise).mockReturnValueOnce(newCycles.promise)}
  render(<MemoryRouter initialEntries={['/administracao/faturacao?q=Antiga']}><Routes><Route path="/administracao/faturacao" element={<NavigableBilling api={api}/>}/></Routes></MemoryRouter>)
  await waitFor(()=>expect(api.cycles).toHaveBeenCalledTimes(1))
  fireEvent.click(screen.getByRole('button',{name:'Mudar pesquisa'}))
  await waitFor(()=>expect(api.cycles).toHaveBeenCalledTimes(2))
  await act(async()=>{newSummary.resolve({data:summary});newCycles.resolve({data:{...list,items:[newerCycle]}})})
  expect(await screen.findByText('Entidade Nova')).toBeTruthy()
  await act(async()=>{oldSummary.resolve({data:summary});oldCycles.resolve({data:list})})
  expect(screen.queryByText('Município Exemplo')).toBeNull()
 })

 it('mostra erro com retry e um vazio orientado quando ainda não há ciclos',async()=>{
  const api={summary:vi.fn().mockRejectedValueOnce({response:{status:503}}).mockReturnValue(response({currencies:[]})),cycles:vi.fn(()=>response({items:[],total:0,page:1,pageSize:25}))};mount(api)
  expect((await screen.findByRole('alert')).textContent).toContain('Não foi possível concluir')
  fireEvent.click(screen.getByRole('button',{name:'Tentar novamente'}))
  expect(await screen.findByText('Ainda não existem ciclos de faturação')).toBeTruthy()
 })

 it('configura a conta e cria o ciclo sem expor ações fiscais ou de comunicação',async()=>{
  const organization={id:'11111111-1111-4111-8111-111111111111',name:'Empresa Norte',legalName:'Empresa Norte, Lda.'}
  const accountEmpty={organizationId:organization.id,organizationName:organization.name,organizationLegalName:organization.legalName,organizationStatus:'ACTIVE',account:null}
  const accountReady={...accountEmpty,account:{id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',revision:1,currentVersion:1,version:{id:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',legalName:organization.legalName,taxCountry:'PT',taxIdentifier:'501234567',addressLine1:'Rua Um',addressLine2:null,postalCode:'1000-100',locality:'Lisboa',region:null,billingEmail:'financeiro@example.pt',contactName:null,externalSource:null,externalCustomerRef:null,paymentTermsDays:30,notes:null}}}
  const api={summary:vi.fn(()=>response({currencies:[]})),cycles:vi.fn(()=>response({items:[],total:0,page:1,pageSize:25})),account:vi.fn().mockReturnValueOnce(response(accountEmpty)).mockReturnValueOnce(response(accountReady)),accountWrite:vi.fn(()=>response({revision:1})),cycleCreate:vi.fn(()=>response({cycleId:cycle.cycleId}))}
  const directoryApi={entities:vi.fn(()=>response({items:[organization]}))};mount(api,directoryApi)
  fireEvent.click(await screen.findByRole('button',{name:'Preparar faturação'}));fireEvent.change(await screen.findByLabelText('Entidade'),{target:{value:organization.id}})
  await screen.findByRole('group',{name:'Configurar conta de faturação'})
  const values={ 'NIF / identificação fiscal':'501234567','Morada':'Rua Um','Código postal':'1000-100','Localidade':'Lisboa','Email de faturação':'financeiro@example.pt' }
  for(const [label,value] of Object.entries(values))fireEvent.change(screen.getByLabelText(label),{target:{value}})
  fireEvent.click(screen.getByRole('button',{name:'Guardar dados de faturação'}))
  await waitFor(()=>expect(api.accountWrite).toHaveBeenCalledOnce());expect(api.accountWrite.mock.calls[0][1]).toMatchObject({expectedRevision:0,addressLine2:null,externalSource:null,idempotencyKey:expect.any(String)})
  const cycleForm=await screen.findByRole('group',{name:'Novo ciclo'})
  fireEvent.change(within(cycleForm).getByLabelText('Início do período'),{target:{value:'2026-01-01'}});fireEvent.change(within(cycleForm).getByLabelText('Fim do período'),{target:{value:'2026-12-31'}});fireEvent.change(within(cycleForm).getByLabelText('Valor'),{target:{value:'12000.00'}});fireEvent.change(within(cycleForm).getByLabelText('Vencimento'),{target:{value:'2026-02-04'}})
  fireEvent.click(screen.getByRole('button',{name:'Criar ciclo'}));await waitFor(()=>expect(api.cycleCreate).toHaveBeenCalledOnce());expect(await screen.findByText('Detalhe aberto')).toBeTruthy()
  expect(screen.queryByRole('button',{name:/emitir fatura/i})).toBeNull();expect(screen.queryByRole('button',{name:/enviar email/i})).toBeNull();expect(screen.queryByRole('button',{name:/pdf/i})).toBeNull()
 })
})

