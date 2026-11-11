import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { BillingDetailView } from './PlatformBillingDetail'

vi.mock('../Billing/BillingPdf',()=>({default:()=> <p>PDF privado</p>}))
afterEach(cleanup)

const document={id:'33333333-3333-4333-8333-333333333333',cycleId:'22222222-2222-4222-8222-222222222222',sourceCode:'TOCONLINE',issuerReference:'C4G-PT',type:'INVOICE',number:'FT 2026/1',externalDocumentId:'doc-1',issueDate:'2026-01-05',dueDate:'2026-02-04',currency:'EUR',subtotal:'1000',taxTotal:'230',total:'1230',correctsDocumentId:null,state:'ISSUED',revision:1,createdAt:'2026-01-05T10:00:00Z',updatedAt:'2026-01-05T10:00:00Z',allowedActions:{cancel:false,credit:false}}
const detail={cycleId:'22222222-2222-4222-8222-222222222222',organizationId:'11111111-1111-4111-8111-111111111111',organizationName:'Município Exemplo',organizationLegalName:'Município de Exemplo',accountVersionId:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',periodStart:'2026-01-01',periodEnd:'2026-12-31',serviceDescription:'Subscrição anual',currency:'EUR',cycleAmount:'1230',plannedIssueDate:'2026-01-05',dueDate:'2026-02-04',contractReference:null,cycleState:'ISSUED',cycleRevision:3,document,adjustedTotal:'1230',creditAmount:'0',debitAmount:'0',paidAmount:'400',balanceAmount:'830',paymentState:'PARTIALLY_PAID',overdue:true,cycleNotes:null,cycleCreatedAt:'2026-01-01T10:00:00Z',cycleUpdatedAt:'2026-01-05T10:00:00Z',accountSnapshot:{legalName:'Município de Exemplo',taxCountry:'PT',taxIdentifier:'501234567',addressLine1:'Praça Central, 1',addressLine2:null,postalCode:'1000-100',locality:'Lisboa',region:null,billingEmail:'financeiro@example.pt',contactName:'Equipa Financeira',externalSource:'TOCONLINE',externalCustomerRef:'CLIENT-1',paymentTermsDays:30,notes:null},documents:[document],payments:[],timeline:[]}
const response=data=>Promise.resolve({data})
const allowedActions={editCycle:false,readyCycle:false,cancelCycle:false,recordPrimaryDocument:false,recordCorrectiveDocument:true,recordPayment:true}
const apiFor=()=>({cycle:vi.fn(()=>response({...detail,allowedActions})),cycleEdit:vi.fn(()=>response({})),cycleTransition:vi.fn(()=>response({})),documentRecord:vi.fn(()=>response({})),documentTransition:vi.fn(()=>response({})),paymentRecord:vi.fn(()=>response({})),paymentReverse:vi.fn(()=>response({}))})
const mount=api=>render(<MemoryRouter><BillingDetailView cycleId={detail.cycleId} api={api}/></MemoryRouter>)

describe('detalhe de faturação',()=>{
 it('mostra saldo, snapshot e apenas ações válidas para um ciclo emitido',async()=>{
  mount(apiFor());expect(await screen.findByText('830,00 EUR')).toBeTruthy();expect(screen.getByText('501234567')).toBeTruthy();expect(screen.getByRole('button',{name:'Registar pagamento'})).toBeTruthy();expect(screen.queryByRole('button',{name:'Editar ciclo'})).toBeNull();expect(screen.queryByText(/Enviar email/i)).toBeNull();expect(screen.getByText("PDF privado")).toBeTruthy()
 })

 it('oculta pagamento e transições quando a projeção do servidor os recusa',async()=>{
  const api=apiFor();api.cycle.mockResolvedValue(response({...detail,balanceAmount:'0',paymentState:'PAID',allowedActions:{...allowedActions,recordPayment:false,recordCorrectiveDocument:false},documents:[{...document,allowedActions:{cancel:false,credit:false}}]}));mount(api);await screen.findByText('0,00 EUR');expect(screen.queryByRole('button',{name:'Registar pagamento'})).toBeNull();expect(screen.queryByRole('button',{name:'Documento retificativo'})).toBeNull();expect(screen.queryByRole('button',{name:'Cancelar'})).toBeNull();expect(screen.queryByRole('button',{name:'Marcar creditado'})).toBeNull()
 })

 it('exige revisão explícita antes do pagamento e envia uma única vez',async()=>{
  const api=apiFor();mount(api);fireEvent.click(await screen.findByRole('button',{name:'Registar pagamento'}));fireEvent.change(screen.getByLabelText('Valor'),{target:{value:'500.00'}});fireEvent.click(screen.getByRole('button',{name:'Rever'}));expect(api.paymentRecord).not.toHaveBeenCalled();expect(screen.getByText('500,00 EUR')).toBeTruthy();fireEvent.click(screen.getByRole('button',{name:'Confirmar pagamento'}));await waitFor(()=>expect(api.paymentRecord).toHaveBeenCalledOnce());expect(api.paymentRecord.mock.calls[0]).toEqual([document.id,expect.objectContaining({amount:'500.00',currency:'EUR',idempotencyKey:expect.any(String)})]);expect(await screen.findByText('Pagamento registado.')).toBeTruthy()
 })

 it('mantém o formulário num conflito e nunca repete o comando automaticamente',async()=>{
  const api=apiFor();api.paymentRecord.mockRejectedValue({response:{status:409,data:{error:{code:'STALE_REVISION'}}}});mount(api);fireEvent.click(await screen.findByRole('button',{name:'Registar pagamento'}));const amount=screen.getByLabelText('Valor');fireEvent.change(amount,{target:{value:'321.45'}});fireEvent.click(screen.getByRole('button',{name:'Rever'}));fireEvent.click(screen.getByRole('button',{name:'Confirmar pagamento'}));expect((await screen.findByRole('alert')).textContent).toContain('Os dados introduzidos foram mantidos');expect(screen.getByLabelText('Valor').value).toBe('321.45');expect(api.paymentRecord).toHaveBeenCalledTimes(1);await new Promise(resolve=>setTimeout(resolve,10));expect(api.paymentRecord).toHaveBeenCalledTimes(1);expect(screen.getByRole('button',{name:'Atualizar dados'})).toBeTruthy()
 })

 it.each(['document','cycle'])('reserva vermelho preenchido à confirmação de cancelamento de %s',async(kind)=>{
  const api=apiFor();api.cycle.mockResolvedValue({data:{...detail,allowedActions:{...allowedActions,cancelCycle:kind==='cycle'},documents:[{...document,allowedActions:{cancel:kind==='document',credit:false}}]}});
  mount(api);const trigger=await screen.findByRole('button',{name:kind==='document'?'Cancelar':'Cancelar ciclo',exact:true});
  expect(trigger.classList.contains('btn-danger')).toBe(true);fireEvent.click(trigger);
  const dialog=screen.getByRole('dialog');const review=within(dialog).getByRole('button',{name:'Rever'});
  expect(review.classList.contains('btn-danger')).toBe(true);expect(review.classList.contains('btn-danger-solid')).toBe(false);
  expect(within(dialog).getByRole('button',{name:'Cancelar',exact:true}).classList.contains('btn-secondary')).toBe(true);
  fireEvent.change(screen.getByLabelText('Motivo'),{target:{value:'Registo duplicado'}});fireEvent.click(review);
  const confirm=within(dialog).getByRole('button',{name:kind==='document'?'Confirmar alteração':'Confirmar cancelamento'});
  expect(confirm.classList.contains('btn-danger-solid')).toBe(true);expect(api.documentTransition).not.toHaveBeenCalled();expect(api.cycleTransition).not.toHaveBeenCalled();
  fireEvent.click(confirm);
  const method=kind==='document'?api.documentTransition:api.cycleTransition;
  await waitFor(()=>expect(method).toHaveBeenCalledExactlyOnceWith(kind==='document'?document.id:detail.cycleId,{toState:'CANCELLED',reason:'Registo duplicado',expectedRevision:kind==='document'?document.revision:detail.cycleRevision,idempotencyKey:expect.any(String)}));
 })
})

