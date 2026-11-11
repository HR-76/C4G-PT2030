import {beforeEach,afterEach,describe,it,expect,vi} from 'vitest'
import {render,screen,fireEvent,waitFor,cleanup,within} from '@testing-library/react'
import {MemoryRouter} from 'react-router-dom'
const api=vi.hoisted(()=>Object.fromEntries(['session','context','preview','activate','active','snapshot','history','lookup','criteria','evaluate','result','decisions','stepUp'].map(k=>[k,vi.fn()])))
vi.mock('../../api/api',()=>({prequalificationApi:api,clearCsrfToken:vi.fn()}))
import {Workspace} from './Prequalification'
import {saveIntention} from './intentions'
const id=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0')
const auth={user:{id:id(1)},organization:{id:id(2)},refreshSession:vi.fn()}
function mount(search=''){return render(<MemoryRouter><Workspace auth={auth} search={search}/></MemoryRouter>)}
async function preview(){await screen.findByRole('combobox',{name:'Publicação'});fireEvent.change(screen.getByLabelText('Publicação'),{target:{value:id(3)}});fireEvent.change(screen.getByLabelText('Motivo'),{target:{value:'Motivo explícito'}});fireEvent.click(screen.getByText('Pré-validar publicação'));await screen.findByText('Pré-validação concluída');fireEvent.click(screen.getByLabelText('Confirmo esta publicação, geração e motivo'))}
beforeEach(()=>{vi.clearAllMocks();sessionStorage.clear();api.session.mockImplementation(work=>work());auth.refreshSession.mockResolvedValue({user:auth.user,organization:auth.organization});api.context.mockResolvedValue({data:{items:[{versionId:id(3),publishedAt:'2030-01-01'}],nextCursor:null,mfa:{category:'recent-mfa'}}});api.active.mockResolvedValue({data:{active:null}});api.history.mockResolvedValue({data:{items:[],nextCursor:null}});api.preview.mockResolvedValue({data:{versionId:id(3),origin:{revision:2},coverage:{},expectedActivationId:null,expectedGeneration:0,concurrencyToken:'opaque',expiresAt:'2030-01-01',capability:{allowed:true}}})})
afterEach(cleanup)

it('keeps the result and reason visible with evidence grouped separately for each criterion',async()=>{
 api.decisions.mockResolvedValue({data:{items:[],canDecide:false}})
 const evidence={excerpt:'Excerto do aviso',justification:'Justificação editorial'}
 const references={verificationIds:[id(7)],assertionVersionIds:[],itemVersionIds:[]}
 api.result.mockResolvedValue({data:{evaluationId:id(5),freshness:'CURRENT',result:{
  evaluatedAt:'2030-01-01',identity:{opportunityId:id(8)},lines:[
   {criterionId:id(9),interpretationText:'Competência técnica',result:'SATISFIED',reason:'VERIFIED_AT_EVALUATION',criteriaEvidence:evidence,source:{label:'Aviso',reference:'Secção 2',versionLabel:'Versão 1'},...references},
   {criterionId:id(10),interpretationText:'Experiência anterior',result:'UNKNOWN',reason:'NO_VERIFICATION',criteriaEvidence:{...evidence,excerpt:'Outro excerto'},...references},
  ],
 }}})
 mount('?evaluationId='+id(5))
 const title=await screen.findByRole('heading',{name:'Competência técnica'})
 const criterion=within(title.closest('li'))
 expect(criterion.getByText('Demonstrado pela evidência')).toBeTruthy()
 expect(criterion.getByText('Verificação válida no instante avaliado')).toBeTruthy()
 const disclosure=criterion.getByText('Ver evidência',{selector:'summary'}).parentElement
 expect(disclosure.open).toBe(false)
 const detail=within(disclosure)
 for(const value of ['Excerto do aviso','Aviso · Secção 2 · Versão 1','Justificação editorial',id(7)]){
  expect(detail.getByText(value)).toBeTruthy()
 }
 const second=within(screen.getByRole('heading',{name:'Experiência anterior'}).closest('li'))
 expect(second.getByText('Informação insuficiente')).toBeTruthy()
 expect(second.getByText('Sem verificação')).toBeTruthy()
 expect(second.getByText('Ver evidência',{selector:'summary'}).parentElement.open).toBe(false)
})
describe('activation confirmation and uncertain outcomes (mocked API)',()=>{
 it('requires explicit confirmation and invalidates it when reason changes',async()=>{mount();await preview();expect(screen.getByText('Ativar para análise parcial').disabled).toBe(false);fireEvent.change(screen.getByLabelText('Motivo'),{target:{value:'Alterado'}});expect(screen.getByLabelText('Confirmo esta publicação, geração e motivo').checked).toBe(false);expect(screen.getByText('Ativar para análise parcial').disabled).toBe(true)})
 it('new selection discards the preview and confirmation',async()=>{mount();await preview();fireEvent.change(screen.getByLabelText('Publicação'),{target:{value:''}});expect(screen.queryByText('Pré-validação concluída')).toBeNull();expect(api.activate).not.toHaveBeenCalled()})
 it('503 preserves only the intention and prevents a second activation',async()=>{api.activate.mockRejectedValue({response:{status:503}});mount();await preview();fireEvent.click(screen.getByText('Ativar para análise parcial'));await screen.findByText('Resultado por confirmar. A falha de comunicação não demonstra rollback.');expect(screen.getByText('Pré-validar publicação').disabled).toBe(true);expect(api.activate).toHaveBeenCalledTimes(1);const stored=JSON.parse(sessionStorage.getItem(sessionStorage.key(0)));expect(Object.keys(stored).sort()).toEqual(['idempotencyKey','operation','organizationId','resourceId','userId']);expect(stored.operation).toBe('PQ1_ACTIVATE')})
 it('409 clears that refused intention and requires another preview',async()=>{api.activate.mockRejectedValue({response:{status:409}});mount();await preview();fireEvent.click(screen.getByText('Ativar para análise parcial'));await screen.findByRole('alert');await waitFor(()=>expect(sessionStorage.length).toBe(0));expect(screen.queryByText('Pré-validação concluída')).toBeNull()})
 it('UNKNOWN lookup stays pending with support guidance, without replay',async()=>{saveIntention({userId:id(1),organizationId:id(2),resourceId:id(2),operation:'PQ1_ACTIVATE',idempotencyKey:id(4)});api.lookup.mockResolvedValue({data:{status:'UNKNOWN',correlationId:id(5)}});mount();const button=await screen.findByText('Consultar resultado da intenção');await waitFor(()=>expect(button.disabled).toBe(false));fireEvent.click(button);await screen.findByText(/Contacte o suporte com a intenção/);expect(sessionStorage.length).toBe(1);expect(api.activate).not.toHaveBeenCalled()})
 it('an unrelated evaluation intention does not block activation',async()=>{saveIntention({userId:id(1),organizationId:id(2),resourceId:id(9),operation:'PQ1_EVALUATE',idempotencyKey:id(4)});mount();await preview();expect(screen.getByText('Ativar para análise parcial').disabled).toBe(false)})
 it('session change prevents preview from reaching the API',async()=>{mount();await screen.findByText('Pré-validar publicação');auth.refreshSession.mockResolvedValue({user:auth.user,organization:{id:id(9)}});fireEvent.change(screen.getByLabelText('Publicação'),{target:{value:id(3)}});fireEvent.click(screen.getByText('Pré-validar publicação'));await screen.findByRole('alert');expect(api.preview).not.toHaveBeenCalled()})
 it('historical positive evidence does not become a current global approval',async()=>{api.result.mockResolvedValue({data:{freshness:'UNAVAILABLE',result:{evaluatedAt:'2030-01-01',identity:{opportunityId:id(8)},lines:[{criterionId:id(9),interpretationText:'Competência exigida',result:'SATISFIED',reason:'VERIFIED_AT_EVALUATION',criteriaEvidence:{excerpt:'Trecho',justification:'Ligação editorial'},verificationIds:[id(7)],assertionVersionIds:[id(6)],itemVersionIds:[]}]}}});mount('?evaluationId='+id(5));await screen.findByText('Indisponível para utilização atual');expect(screen.getByText('Demonstrado pela evidência')).toBeTruthy();expect(screen.getByText('Análise parcial — informação global indeterminada')).toBeTruthy();expect(api.evaluate).not.toHaveBeenCalled()})

})
