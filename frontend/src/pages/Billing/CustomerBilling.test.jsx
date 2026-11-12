import React from 'react'
import {describe,it,expect,vi,afterEach} from 'vitest'
import {render,screen,fireEvent,waitFor,cleanup} from '@testing-library/react'
import {MemoryRouter,Routes,Route} from 'react-router-dom'
import {CustomerBillingView} from './CustomerBilling'
vi.mock('./BillingPdf',()=>({default:()=> <p>PDF ainda não disponibilizado.</p>}))
afterEach(cleanup)
const response=data=>Promise.resolve({data})
const row={cycleId:'cycle',number:'FT 2026/1',serviceDescription:'Subscrição',periodStart:'2026-01-01',periodEnd:'2026-12-31',issueDate:'2026-10-01',dueDate:'2026-11-01',currency:'EUR',total:'1000',paidAmount:'700',balanceAmount:'300',paymentState:'PARTIALLY_PAID',documentState:'ISSUED',overdue:true}
function api(){return {invoices:vi.fn(()=>response({items:[row],total:1,page:1,pageSize:25})),summary:vi.fn(()=>response({currencies:[{currency:'EUR',billedAmount:'1000',paidAmount:'700',balanceAmount:'300',overdueAmount:'300'}]})),account:vi.fn(()=>response({account:null,origin:'MANUAL_C4G'}))}}
const noProfile={context:()=>response({})}
function mount(value,path='/faturacao'){return render(<MemoryRouter initialEntries={[path]}><Routes><Route path="/faturacao" element={<CustomerBillingView organizationId="org" api={value} directoryApi={noProfile}/>}/><Route path="/faturacao/historico" element={<CustomerBillingView organizationId="org" api={value} directoryApi={noProfile} history/>}/><Route path="/faturacao/:id" element={<CustomerBillingView organizationId="org" api={value} directoryApi={noProfile}/>}/></Routes></MemoryRouter>)}
describe('faturação do cliente',()=>{
  it('shows partial balance, overdue and no administrative commands',async()=>{mount(api());await screen.findByText('FT 2026/1');expect(screen.getByText('Parcialmente pago',{selector:'span'})).toBeTruthy();expect(screen.getAllByText('Em atraso').length).toBeGreaterThan(0);expect(screen.queryByText('Registar pagamento')).toBeNull();expect(screen.getAllByText('300,00 EUR').length).toBeGreaterThan(0)})
  it('opens history with filters and a link back to billing',async()=>{const a=api();mount(a,'/faturacao/historico');await screen.findByText('FT 2026/1');expect(screen.getByRole('heading',{name:'Histórico de faturação'})).toBeTruthy();expect(screen.getByRole('link',{name:'Faturação'}).getAttribute('href')).toBe('/faturacao');expect(screen.queryByLabelText('Resumo da conta')).toBeNull();fireEvent.change(screen.getByLabelText('Fatura ou serviço'),{target:{value:'Consultoria'}});fireEvent.click(screen.getByRole('button',{name:'Filtrar'}));await waitFor(()=>expect(a.invoices).toHaveBeenLastCalledWith({q:'Consultoria'},expect.anything()))})
  it('applies filters and resets pagination',async()=>{const a=api();mount(a,'/faturacao?page=2');await screen.findByText('FT 2026/1');fireEvent.change(screen.getByLabelText('Fatura ou serviço'),{target:{value:'Consultoria'}});fireEvent.click(screen.getByRole('button',{name:'Filtrar'}));await waitFor(()=>expect(a.invoices).toHaveBeenLastCalledWith({q:'Consultoria'},expect.anything()))})
  it('distinguishes empty results and forbidden responses',async()=>{const a=api();a.invoices=vi.fn(()=>Promise.reject({response:{status:403}}));mount(a);expect(await screen.findByRole('alert')).toHaveProperty('textContent',expect.stringContaining('Não tem permissão'));expect(screen.queryByText('FT 2026/1')).toBeNull()})
  const account={legalName:'Cliente, Lda.',taxCountry:'PT',taxIdentifier:'501234567',addressLine1:'Rua Um',addressLine2:null,postalCode:'1000-100',locality:'Lisboa',region:null,billingEmail:'financeiro@example.pt',contactName:'Ana Contacto',updatedAt:'2026-11-12T10:00:00.000Z'}
  const ficha={organization:{legalName:'Cliente, Lda.'},registration:{complete:true,fields:{nif:'501234567',address:'Rua Um',addressComplement:'',postalCode:'1000-100',locality:'Lisboa'}}}
  it('shows the billing account read-only on the billing page only',async()=>{
    const a=api();a.account=vi.fn(()=>response({account,origin:'MANUAL_C4G'}));const directory={context:vi.fn(()=>response(ficha))}
    render(<MemoryRouter initialEntries={['/faturacao']}><Routes><Route path="/faturacao" element={<CustomerBillingView organizationId="org" api={a} directoryApi={directory}/>}/><Route path="/faturacao/historico" element={<CustomerBillingView organizationId="org" api={a} directoryApi={directory} history/>}/></Routes></MemoryRouter>)
    const section=await screen.findByRole('region',{name:'Dados de faturação'})
    for(const text of ['Cliente, Lda.','501234567','Rua Um','1000-100','Lisboa','financeiro@example.pt','Ana Contacto'])expect(section.textContent).toContain(text)
    expect(section.querySelector('input,textarea,select,button')).toBeNull()
    expect(screen.queryByTestId('billing-profile-difference')).toBeNull()
    cleanup();a.account.mockClear()
    mount(a,'/faturacao/historico');await screen.findByText('FT 2026/1')
    expect(screen.queryByRole('region',{name:'Dados de faturação'})).toBeNull();expect(a.account).not.toHaveBeenCalled()
  })
  it('explains a missing billing account and keeps invoices when the account read fails',async()=>{
    const a=api();a.account=vi.fn(()=>response({account:null,origin:'MANUAL_C4G'}));mount(a)
    expect((await screen.findByRole('region',{name:'Dados de faturação'})).textContent).toContain('ainda não foram configurados')
    cleanup()
    const b=api();b.account=vi.fn(()=>Promise.reject({response:{status:503}}));mount(b)
    await screen.findByText('FT 2026/1')
    expect((await screen.findByRole('region',{name:'Dados de faturação'})).textContent).toContain('Não foi possível carregar os dados de faturação')
  })
  it('warns when the entity profile differs and stays silent when the profile is unavailable',async()=>{
    const a=api();a.account=vi.fn(()=>response({account,origin:'MANUAL_C4G'}))
    const changed={...ficha,registration:{...ficha.registration,fields:{...ficha.registration.fields,address:'Rua Nova, 5'}}}
    render(<MemoryRouter initialEntries={['/faturacao']}><Routes><Route path="/faturacao" element={<CustomerBillingView organizationId="org" api={a} directoryApi={{context:vi.fn(()=>response(changed))}}/>}/></Routes></MemoryRouter>)
    const warning=await screen.findByTestId('billing-profile-difference')
    expect(warning.textContent).toContain('Morada');expect(warning.textContent).toContain('Rua Nova, 5');expect(warning.querySelector('button')).toBeNull()
    cleanup()
    render(<MemoryRouter initialEntries={['/faturacao']}><Routes><Route path="/faturacao" element={<CustomerBillingView organizationId="org" api={a} directoryApi={{context:vi.fn(()=>Promise.reject({response:{status:403}}))}}/>}/></Routes></MemoryRouter>)
    expect((await screen.findByRole('region',{name:'Dados de faturação'})).textContent).toContain('Rua Um')
    expect(screen.queryByTestId('billing-profile-difference')).toBeNull();expect(screen.queryByRole('alert')).toBeNull()
  })
  it('shows effective dates separately from registration and never fakes PDF',async()=>{const a=api();a.invoice=vi.fn(()=>response({...row,adjustedTotal:'1000',account:{legalName:'Cliente',taxIdentifier:'123456789'},documents:[{id:'doc',type:'INVOICE',number:row.number,state:'ISSUED',total:'1000',currency:'EUR'}],payments:[{id:'payment',recordType:'PAYMENT',methodCode:'BANK_TRANSFER',effectiveOn:'2026-11-01',createdAt:'2026-11-02T10:00:00Z',amount:'700',currency:'EUR'},{id:'reversal',recordType:'REVERSAL',effectiveOn:'2026-11-03',createdAt:'2026-11-04T10:00:00Z',amount:'100',currency:'EUR'}]}));mount(a,'/faturacao/cycle');await screen.findByText('Data efetiva: 01/11/2026');expect(screen.getByText(/Registado pela C4G em 02\/11\/26/)).toBeTruthy();expect(screen.getByText('Estorno')).toBeTruthy();expect(screen.getByText('PDF ainda não disponibilizado.')).toBeTruthy();expect(screen.queryByRole('link',{name:/PDF/})).toBeNull()})
})
