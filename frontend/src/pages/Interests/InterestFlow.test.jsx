import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
const api = vi.hoisted(() => Object.fromEntries(['context','summaries','units','get','list','history','create','edit','archive'].map(name => [name,vi.fn()])))
const auth = vi.hoisted(() => ({user:{id:'user'},organization:{id:'org'}}))
const central = vi.hoisted(()=>({get:vi.fn()}))
vi.mock('../../api/api',()=>({opportunityInterestsApi:api,centralOpportunitiesApi:central,privateApplicationsApi:{list:vi.fn(async()=>({data:{items:[]}}))}}))
vi.mock('../../contexts/AuthContext',()=>({useAuth:()=>auth}))
import Interests from './Interests'
import useInterestCommand from './useInterestCommand'
import CatalogInterests from './CatalogInterests'
import CatalogInterestButton from '../Opportunities/CatalogInterestButton'
import { OpportunityTable } from '../Opportunities/OpportunityPresentation'
import { interestIntentionKey, safeInterestReturn, readInterestIntention, saveInterestIntention, clearInterestIntentions } from './intentions'
import UnitSelector from './UnitSelector'
import eu from '../../../../context/references/opportunity-v2/examples/eu-11145.json'
const opportunity={opportunityId:'opportunity',title:'Aviso de ensaio',lifecycleState:'ACTIVE'}
const record={interestId:'interest',opportunityId:'opportunity',centralRevisionId:'revision',title:opportunity.title,snapshot:{title:opportunity.title,callReference:'CALL-1',closingDate:'2027-01-01'},revision:1,status:'ACTIVE',unitIds:[],units:[],notes:null,capabilities:{canManage:true,canCreateApplication:true}}
const catalogApi={get:vi.fn()}
const catalog=()=>render(<MemoryRouter><CatalogInterests organization={auth.organization} items={[opportunity]} catalogApi={catalogApi}><CatalogInterestButton item={opportunity}/></CatalogInterests></MemoryRouter>)
const Destination=()=>{const location=useLocation();return <p data-testid="destination">{location.search}</p>}
const page=path=>render(<MemoryRouter initialEntries={[path]}><Routes><Route path='/interesses' element={<Interests/>}/><Route path='/interesses/:id' element={<Interests/>}/><Route path='/candidaturas' element={<Destination/>}/></Routes></MemoryRouter>)
beforeEach(()=>{vi.resetAllMocks();sessionStorage.clear();auth.organization={id:'org'};auth.user={id:'user'};api.context.mockResolvedValue({data:{capabilities:{canRegister:true}}});api.summaries.mockImplementation(ids=>Promise.resolve({data:{items:ids.map(opportunityId=>({opportunityId,interestId:null,status:null,unitIds:[]}))}}));api.units.mockResolvedValue({data:{items:[{unitId:'unit',label:'Projetos',lifecycle:'ACTIVE'}]}});api.create.mockResolvedValue({data:record});api.get.mockResolvedValue({data:record});api.list.mockResolvedValue({data:{items:[record],nextCursor:null}});api.history.mockResolvedValue({data:{items:[],nextCursor:null}});api.edit.mockResolvedValue({data:{...record,revision:2}});catalogApi.get.mockResolvedValue({data:{opportunityId:'opportunity',revisionId:'revision',snapshot:{title:opportunity.title,lifecycleState:'ACTIVE'}}});central.get.mockResolvedValue({data:{opportunityId:'opportunity',revisionId:'current-revision',snapshot:{lifecycleState:'ACTIVE'}}})})
afterEach(cleanup)
it('interest detail consumes preserved v2 facts including budget and all seven cutoffs',async()=>{
 const {identity,sourceRecords,provenance,quality,schemaVersion,contractVersion,...projection}=eu
 api.get.mockResolvedValue({data:{...record,title:eu.description.title.value,snapshot:eu,readModel:{version:'opportunity-read-v2.0',sourceVersion:2,identity,sourceRecords,projection,
  temporal:{effectiveState:'OPEN',nextDeadline:eu.schedule.deadlines.value[0],finalDeadline:eu.schedule.deadlines.value.at(-1),nextDeadlineCandidates:[],reasonCodes:[]},quality:{verification:'NOT_CERTIFIED',issues:quality.issues,fieldStates:{PRESENT:8},totalFields:35},freshness:{observedAt:'2026-10-30T12:00:00.000Z'}}}})
 page('/interesses/interest');await screen.findByRole('heading',{level:1,name:'Gnomon Internships Offer'})
 expect(screen.getAllByRole('heading',{level:1})).toHaveLength(1)
 expect(screen.getByRole('region',{name:'Dotação da call'}).textContent).toContain('120\u00a0000 · moeda não indicada')
 const deadlines=screen.getByText('Ver 7 prazos publicados').closest('details')
 fireEvent.click(deadlines.querySelector('summary'))
 expect([...deadlines.querySelectorAll('li time')].map(time=>time.getAttribute('datetime'))).toEqual(eu.schedule.deadlines.value.map(deadline=>deadline.at.value))
 expect(screen.getAllByRole('link').filter(link=>link.getAttribute('href')===eu.links.official.value)).toHaveLength(1)
 expect(screen.queryByRole('region',{name:'Qualidade da informação'})).toBeNull()
})
it('catalog interest refuses an archived lifecycle from the v2 central envelope',async()=>{
 catalogApi.get.mockResolvedValue({data:{opportunityId:'opportunity',revisionId:'revision',lifecycleState:'ARCHIVED',snapshot:eu}})
 catalog();fireEvent.click(await screen.findByRole('button',{name:'Registar interesse em Aviso de ensaio'}))
 await screen.findByText('Não foi possível preparar o interesse. Tente novamente.')
 expect(screen.queryByRole('dialog')).toBeNull();expect(api.create).not.toHaveBeenCalled()
})
it('registers an organizational interest with optional units without creating or navigating to an application',async()=>{
 catalog();fireEvent.click(await screen.findByRole('button',{name:'Registar interesse em Aviso de ensaio'}));await screen.findByRole('dialog');fireEvent.click(await screen.findByLabelText('Projetos'));fireEvent.click(screen.getByRole('button',{name:'Guardar interesse'}));await screen.findByRole('link',{name:'Consultar na lista de interesses'});expect(api.create).toHaveBeenCalledWith(expect.objectContaining({opportunityId:'opportunity',centralRevisionId:'revision',unitIds:['unit']}),'org');expect(api.create.mock.calls[0][0]).not.toHaveProperty('title');expect(screen.queryByText('Nova candidatura')).toBeNull()
})
it('uses server capabilities for readers and displays an existing archived interest',async()=>{
 api.context.mockResolvedValue({data:{capabilities:{canRegister:false}}});api.summaries.mockResolvedValue({data:{items:[{opportunityId:'opportunity',interestId:'old',status:'ARCHIVED',unitIds:[]}]}});catalog();expect(await screen.findByText('Interesse arquivado')).toBeTruthy();expect(screen.queryByRole('button',{name:/Registar interesse/})).toBeNull();expect(screen.getByRole('link',{name:'Consultar na lista de interesses'}).getAttribute('href')).toContain('destaque=old')
 const status=screen.getByText('Interesse arquivado');expect(status.classList.contains('catalog-interest-status-neutral')).toBe(true);expect(status.querySelector('svg')).toBeNull();expect(screen.queryByText('Interesse registado')).toBeNull()
})
it('distinguishes a confirmed interest with a success label and keeps its catalog return link',async()=>{
 api.summaries.mockResolvedValue({data:{items:[record]}})
 render(<MemoryRouter initialEntries={['/catalogo?search=energia&page=2']}><CatalogInterests organization={auth.organization} items={[opportunity]} catalogApi={catalogApi}><CatalogInterestButton item={opportunity}/></CatalogInterests></MemoryRouter>)
 const status=await screen.findByText('Interesse registado')
 expect(status.classList.contains('catalog-interest-status-success')).toBe(true)
 expect(status.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true')
 const link=screen.getByRole('link',{name:'Consultar na lista de interesses'}),target=new URL(link.getAttribute('href'),'https://example.invalid')
 expect(target.pathname).toBe('/candidaturas');expect(target.searchParams.get('destaque')).toBe('interest')
 expect(screen.queryByRole('button',{name:/Registar interesse/})).toBeNull();expect(api.create).not.toHaveBeenCalled()
})
it('shows success only after the save response and prevents duplicate submissions while saving',async()=>{
 let finish;api.create.mockImplementation(()=>new Promise(resolve=>{finish=resolve}));catalog()
 const register=await screen.findByRole('button',{name:/Registar interesse em/});fireEvent.click(register)
 await screen.findByRole('dialog');expect(screen.queryByText('Interesse registado')).toBeNull()
 fireEvent.click(await screen.findByLabelText('Interesse transversal à C4G'));fireEvent.click(screen.getByRole('button',{name:'Guardar interesse'}))
 const saving=await screen.findByRole('button',{name:'A guardar…'})
 expect(saving.disabled).toBe(true);expect(register.disabled).toBe(true)
 expect(screen.queryByText('Interesse registado')).toBeNull();expect(screen.queryByRole('link',{name:'Consultar na lista de interesses'})).toBeNull()
 fireEvent.click(saving);expect(api.create).toHaveBeenCalledTimes(1)
 await act(async()=>finish({data:record}))
 expect((await screen.findByText('Interesse registado')).classList.contains('catalog-interest-status-success')).toBe(true)
 expect(screen.queryByRole('dialog')).toBeNull();expect(screen.getByRole('link',{name:'Consultar na lista de interesses'})).toBeTruthy()
})
it.each([null,'UNKNOWN'])('does not label an unknown interest status %s as successful or archived',async status=>{
 api.summaries.mockResolvedValue({data:{items:[{...record,status}]}});catalog()
 expect(await screen.findByRole('link',{name:'Consultar na lista de interesses'})).toBeTruthy()
 expect(screen.queryByText('Interesse registado')).toBeNull();expect(screen.queryByText('Interesse arquivado')).toBeNull()
 expect(screen.queryByRole('button',{name:/Registar interesse/})).toBeNull()
})
it('does not display a success label after an uncertain save failure',async()=>{
 api.create.mockRejectedValue({response:{status:503}});catalog()
 fireEvent.click(await screen.findByRole('button',{name:/Registar interesse em/}));fireEvent.click(await screen.findByLabelText('Interesse transversal à C4G'));fireEvent.click(await screen.findByRole('button',{name:'Guardar interesse'}))
 await screen.findByRole('button',{name:'Confirmar envio pendente'})
 expect(screen.queryByText('Interesse registado')).toBeNull();expect(screen.queryByRole('link',{name:'Consultar na lista de interesses'})).toBeNull()
 expect(screen.getByRole('button',{name:'Guardar interesse'}).disabled).toBe(true)
})
it('does not present incomplete or failed summaries as absence',async()=>{
 api.summaries.mockResolvedValue({data:{items:[]}});catalog();await screen.findByRole('button',{name:'Repetir consulta de interesses'});expect(screen.queryByRole('button',{name:/Registar interesse/})).toBeNull()
})
it('blocks transmission with a visible error when storage fails',async()=>{
 catalog();fireEvent.click(await screen.findByRole('button',{name:/Registar interesse em/}));await screen.findByRole('dialog');const blocked=vi.spyOn(Storage.prototype,'setItem').mockImplementation(()=>{throw Error('blocked')});try{fireEvent.click(await screen.findByLabelText('Interesse transversal à C4G'));fireEvent.click(await screen.findByRole('button',{name:'Guardar interesse'}));await screen.findByText(/Não foi possível guardar o pedido neste navegador/);expect(api.create).not.toHaveBeenCalled();expect(screen.getByRole('button',{name:'Guardar interesse'}).disabled).toBe(false)}finally{blocked.mockRestore()}
})
it('retains the same uncertain command across remount and never retries automatically',async()=>{
 api.create.mockRejectedValue({response:{status:503}});const first=catalog();fireEvent.click(await screen.findByRole('button',{name:/Registar interesse em/}));fireEvent.click(await screen.findByLabelText('Interesse transversal à C4G'));fireEvent.click(await screen.findByRole('button',{name:'Guardar interesse'}));await screen.findByRole('button',{name:'Confirmar envio pendente'});const command=api.create.mock.calls[0][0];first.unmount();catalog();await screen.findByRole('button',{name:'Confirmar envio pendente'});expect(api.create).toHaveBeenCalledTimes(1);fireEvent.click(screen.getByRole('button',{name:'Confirmar envio pendente'}));await waitFor(()=>expect(api.create).toHaveBeenCalledTimes(2));expect(api.create.mock.calls[1][0]).toEqual(command)
})
it('loads reading facets for a viewer and applies direct unit and unassigned filters',async()=>{
 api.list.mockResolvedValue({data:{items:[],nextCursor:null,capabilities:{canRegister:false}}});page('/interesses');await screen.findByRole('option',{name:'Projetos'});expect(api.units.mock.calls[0][0]).toEqual({purpose:'FILTER'});fireEvent.change(screen.getByLabelText('Departamento / Unidade'),{target:{value:'NONE'}});fireEvent.click(screen.getByRole('button',{name:'Aplicar filtros'}));await waitFor(()=>expect(api.list.mock.lastCall[0].unitId).toBe('NONE'));expect(api.units.mock.calls.every(call=>call[0].purpose==='FILTER')).toBe(true)
})
it('preserves interest revision and return context when opening a candidature',async()=>{
 page('/interesses/interest?retorno=%2Finteresses%3FunitId%3Dunit');const open=await screen.findByRole('button',{name:'Preparar candidatura'});expect(screen.getByRole('link',{name:'Voltar'}).getAttribute('href')).toBe('/interesses?unitId=unit');fireEvent.click(open);const params=new URLSearchParams((await screen.findByTestId('destination')).textContent);expect(params.get('interesse')).toBe('interest');expect(params.get('interesseRevisao')).toBe('1');expect(params.get('revisao')).toBe('current-revision');expect(params.get('retorno')).toContain('/interesses/interest')
})
it('does not expose management or conversion to a reader',async()=>{
 api.get.mockResolvedValue({data:{...record,capabilities:{canManage:false,canCreateApplication:false}}});page('/interesses/interest');await screen.findByRole('heading',{name:'Aviso de ensaio'});expect(screen.queryByRole('button',{name:'Guardar análise'})).toBeNull();expect(screen.queryByRole('button',{name:'Preparar candidatura'})).toBeNull();expect(api.units).not.toHaveBeenCalled()
})
it('batches summaries in groups of at most 25 instead of reading each opportunity',async()=>{
 const items=Array.from({length:51},(_,index)=>({...opportunity,opportunityId:`opportunity-${index}`}));render(<MemoryRouter><CatalogInterests organization={auth.organization} items={items} catalogApi={catalogApi}><p>Catálogo</p></CatalogInterests></MemoryRouter>);await waitFor(()=>expect(api.summaries).toHaveBeenCalledTimes(3));expect(api.summaries.mock.calls.map(call=>call[0].length)).toEqual([25,25,1]);expect(api.context).toHaveBeenCalledTimes(1)
})
it('starts all summary batches without waiting for the first response',async()=>{
 api.summaries.mockImplementation(()=>new Promise(()=>{}))
 const items=Array.from({length:51},(_,index)=>({...opportunity,opportunityId:`opportunity-${index}`}))
 render(<MemoryRouter><CatalogInterests organization={auth.organization} items={items} catalogApi={catalogApi}><p>Catálogo</p></CatalogInterests></MemoryRouter>)
 await waitFor(()=>expect(api.summaries).toHaveBeenCalledTimes(3))
})
it('shows the catalog rows at once and fills in each interest when the response arrives',async()=>{
 let finish
 api.summaries.mockImplementation(()=>new Promise(resolve=>{finish=resolve}))
 render(<MemoryRouter><CatalogInterests organization={auth.organization} items={[opportunity]} catalogApi={catalogApi}><OpportunityTable central interestOnly items={[opportunity]} renderApplicationAction={item=><CatalogInterestButton compact item={item}/>}/></CatalogInterests></MemoryRouter>)
 expect(screen.getByRole('link',{name:opportunity.title})).toBeTruthy()
 expect(screen.getByText('A consultar interesse…')).toBeTruthy()
 await act(async()=>finish({data:{capabilities:{canRegister:true},items:[{opportunityId:'opportunity',interestId:'interest',status:'ACTIVE'}]}}))
 expect(screen.getByRole('link',{name:opportunity.title})).toBeTruthy()
 expect(screen.getByRole('link',{name:`Consultar na lista de interesses: ${opportunity.title}`})).toBeTruthy()
})
it('opens registration with the permission from summaries without a second context request',async()=>{
 api.summaries.mockResolvedValue({data:{capabilities:{canRegister:true},items:[{opportunityId:'opportunity',interestId:null}]}})
 catalog()
 fireEvent.click(await screen.findByRole('button',{name:/Registar interesse em/}))
 await screen.findByRole('dialog')
 expect(api.context).not.toHaveBeenCalled()
})
it('keeps recovery after an abandoned in-flight creation resolves',async()=>{
 let finish;api.create.mockImplementation(()=>new Promise(resolve=>{finish=resolve}));const first=catalog();fireEvent.click(await screen.findByRole('button',{name:/Registar interesse em/}));fireEvent.click(await screen.findByLabelText('Interesse transversal à C4G'));fireEvent.click(await screen.findByRole('button',{name:'Guardar interesse'}));await waitFor(()=>expect(api.create).toHaveBeenCalledTimes(1));const saved=sessionStorage.getItem(interestIntentionKey('user','org'));first.unmount();await act(async()=>finish({data:record}));expect(sessionStorage.getItem(interestIntentionKey('user','org'))).toBe(saved)
})
it('does not treat unavailable assignment units as an empty selection',async()=>{
 api.units.mockRejectedValue(Error('forbidden'));catalog();fireEvent.click(await screen.findByRole('button',{name:/Registar interesse em/}));await screen.findByText(/Não foi possível preparar o interesse/);expect(screen.queryByRole('dialog')).toBeNull();expect(api.create).not.toHaveBeenCalled()
})
it('blocks new sends when a saved command is malformed',async()=>{
 sessionStorage.setItem(interestIntentionKey('user','org'),'not json');catalog();await screen.findByText(/Não foi possível recuperar o envio/);expect((await screen.findByRole('button',{name:/Registar interesse em/})).disabled).toBe(true);expect(api.create).not.toHaveBeenCalled()
})
it('saves notes and explicit units using the observed interest revision',async()=>{
 page('/interesses/interest');fireEvent.change(await screen.findByLabelText('Notas'),{target:{value:'Análise humana'}});fireEvent.click(await screen.findByLabelText('Projetos'));fireEvent.click(screen.getByRole('button',{name:'Guardar análise'}));await waitFor(()=>expect(api.edit).toHaveBeenCalledTimes(1));expect(api.edit.mock.calls[0]).toEqual(['interest',expect.objectContaining({notes:'Análise humana',unitIds:['unit'],expectedRevision:1}),'org'])
})
it('archives explicitly with a reason and never exposes opening on archived records',async()=>{
 api.archive.mockResolvedValue({data:{...record,status:'ARCHIVED',revision:2}});const first=page('/interesses/interest');fireEvent.click(await screen.findByRole('button',{name:'Arquivar interesse'}));expect(screen.getByRole('button',{name:'Confirmar arquivo'}).disabled).toBe(true);fireEvent.change(screen.getByLabelText('Motivo'),{target:{value:'Não avançar nesta edição'}});fireEvent.click(screen.getByRole('button',{name:'Confirmar arquivo'}));await waitFor(()=>expect(api.archive).toHaveBeenCalledWith('interest',expect.objectContaining({reason:'Não avançar nesta edição',expectedRevision:1}),'org'));first.unmount();api.get.mockResolvedValue({data:{...record,status:'ARCHIVED'}});page('/interesses/interest');await screen.findByRole('heading',{name:record.title});expect(screen.queryByRole('button',{name:'Preparar candidatura'})).toBeNull();expect(screen.queryByRole('button',{name:'Guardar análise'})).toBeNull()
})
it('preserves historical units while preventing a new archived selection',()=>{
 const onChange=vi.fn();render(<UnitSelector units={[{unitId:'parent',label:'Direção',lifecycle:'ACTIVE'},{unitId:'old',parentUnitId:'parent',label:'Projetos',lifecycle:'ARCHIVED'}]} selectedIds={['old']} onChange={onChange}/>);const old=screen.getByLabelText('Direção › Projetos (arquivada)');expect(old.checked).toBe(true);expect(old.disabled).toBe(false);fireEvent.click(old);expect(onChange).toHaveBeenCalledWith([])
})
it('allows only known local return paths',()=>{
 expect(safeInterestReturn('https://example.invalid')).toBe('/interesses');expect(safeInterestReturn('//example.invalid')).toBe('/interesses');expect(safeInterestReturn('/catalogo\\example.invalid')).toBe('/interesses');expect(safeInterestReturn('/interesses?unitId=NONE')).toBe('/interesses?unitId=NONE')
})
it('stores only the functional envelope and rejects unknown authority or token fields on write and recovery',()=>{
 const intent={userId:'user',organizationId:'org',method:'create',id:null,payload:{opportunityId:'opp',centralRevisionId:'rev',unitIds:[]},idempotencyKey:'key'}
 saveInterestIntention(intent);expect(readInterestIntention('user','org')).toEqual(intent)
 for(const invalid of [{...intent,token:'secret'},{...intent,payload:{...intent.payload,role:'ADMIN'}},{...intent,payload:{...intent.payload,unitIds:[{unitId:'u',grants:['write']}]}}]){
  expect(()=>saveInterestIntention(invalid)).toThrow();sessionStorage.setItem(interestIntentionKey('user','org'),JSON.stringify(invalid));expect(()=>readInterestIntention('user','org')).toThrow()
 }
 sessionStorage.setItem('unrelated','preserve');clearInterestIntentions();expect(sessionStorage.getItem(interestIntentionKey('user','org'))).toBeNull();expect(sessionStorage.getItem('unrelated')).toBe('preserve')
})
it('discards an opening response after the visible catalog page changes',async()=>{
 let finish;catalogApi.get.mockImplementation(()=>new Promise(resolve=>{finish=resolve}));const content=items=><MemoryRouter><CatalogInterests organization={auth.organization} items={items} catalogApi={catalogApi}>{items.map(item=><CatalogInterestButton key={item.opportunityId} item={item}/>)}</CatalogInterests></MemoryRouter>;const mounted=render(content([opportunity]));fireEvent.click(await screen.findByRole('button',{name:/Registar interesse em/}));await waitFor(()=>expect(finish).toBeTruthy());mounted.rerender(content([{...opportunity,opportunityId:'another',title:'Outra oportunidade'}]));await act(async()=>finish({data:{opportunityId:'opportunity',revisionId:'revision',snapshot:{lifecycleState:'ACTIVE'}}}));expect(screen.queryByRole('dialog')).toBeNull()
})
it('retries assignment units without discarding unsaved analysis notes',async()=>{
 api.units.mockRejectedValueOnce(Error('offline')).mockResolvedValue({data:{items:[]}});page('/interesses/interest');await screen.findByText(/As associações existentes foram preservadas/);fireEvent.change(screen.getByLabelText('Notas'),{target:{value:'Rascunho ainda não enviado'}});fireEvent.click(screen.getByRole('button',{name:'Consultar novamente'}));await waitFor(()=>expect(screen.getByRole('button',{name:'Guardar análise'}).disabled).toBe(false));expect(screen.getByLabelText('Notas').value).toBe('Rascunho ainda não enviado');expect(api.get).toHaveBeenCalledTimes(1)
})
it.each(['STALE_OPPORTUNITY_REVISION','STALE_REVISION','UNIT_UNAVAILABLE','STATE_CONFLICT'])('unlocks a definitively refused %s retry after an uncertain result',async code=>{
 api.create.mockRejectedValueOnce({response:{status:503}}).mockRejectedValueOnce({response:{status:409,data:{error:{code}}}}).mockResolvedValue({data:record});catalog();fireEvent.click(await screen.findByRole('button',{name:/Registar interesse em/}));fireEvent.click(await screen.findByLabelText('Interesse transversal à C4G'));fireEvent.click(await screen.findByRole('button',{name:'Guardar interesse'}));await screen.findByRole('button',{name:'Confirmar envio pendente'});const original=api.create.mock.calls[0][0];fireEvent.click(screen.getByRole('button',{name:'Confirmar envio pendente'}));await waitFor(()=>expect(screen.queryByRole('button',{name:'Confirmar envio pendente'})).toBeNull());expect(sessionStorage.getItem(interestIntentionKey('user','org'))).toBeNull();fireEvent.click(screen.getByRole('button',{name:'Cancelar',exact:true}));fireEvent.click(screen.getByRole('button',{name:/Registar interesse em/}));fireEvent.click(await screen.findByLabelText('Interesse transversal à C4G'));fireEvent.click(await screen.findByRole('button',{name:'Guardar interesse'}));await waitFor(()=>expect(api.create).toHaveBeenCalledTimes(3));expect(api.create.mock.calls[1][0]).toEqual(original);expect(api.create.mock.calls[2][0].idempotencyKey).not.toBe(original.idempotencyKey)
})
it.each([401,403,404])('keeps an uncertain command when a retry is refused with HTTP %s',async status=>{
 api.create.mockRejectedValueOnce({response:{status:503}}).mockRejectedValueOnce({response:{status}});catalog();fireEvent.click(await screen.findByRole('button',{name:/Registar interesse em/}));fireEvent.click(await screen.findByLabelText('Interesse transversal à C4G'));fireEvent.click(await screen.findByRole('button',{name:'Guardar interesse'}));await screen.findByRole('button',{name:'Confirmar envio pendente'});const saved=sessionStorage.getItem(interestIntentionKey('user','org'));fireEvent.click(screen.getByRole('button',{name:'Confirmar envio pendente'}));await waitFor(()=>expect(api.create).toHaveBeenCalledTimes(2));await waitFor(()=>expect(screen.getByRole('button',{name:'Confirmar envio pendente'}).disabled).toBe(false));expect(sessionStorage.getItem(interestIntentionKey('user','org'))).toBe(saved)
})
it('blocks opening with unsaved analysis and unlocks when notes and units match the saved record',async()=>{
 page('/interesses/interest');const open=await screen.findByRole('button',{name:'Preparar candidatura'})
 await screen.findByLabelText('Projetos')
 fireEvent.change(screen.getByLabelText('Notas'),{target:{value:'Rascunho'}})
 expect(open.disabled).toBe(true);expect(screen.getByText('Guarde a análise antes de abrir a candidatura.')).toBeTruthy()
 fireEvent.click(open);expect(central.get).not.toHaveBeenCalled()
 fireEvent.change(screen.getByLabelText('Notas'),{target:{value:''}})
 expect(open.disabled).toBe(false)
 fireEvent.click(screen.getByLabelText('Projetos'));expect(open.disabled).toBe(true)
 fireEvent.click(screen.getByLabelText('Projetos'));expect(open.disabled).toBe(false)
})

it('makes the interest-to-application path explicit without creating a record',async()=>{
 page('/interesses?unitId=unit')
 const open=await screen.findByRole('link',{name:'Rever análise de Aviso de ensaio'})
 const url=new URL(open.getAttribute('href'),'https://example.invalid')
 expect(url.pathname).toBe('/interesses/interest')
 expect(url.searchParams.get('retorno')).toBe('/interesses?unitId=unit')
 expect(screen.getByRole('button',{name:'Preparar candidatura para Aviso de ensaio'})).toBeTruthy()
 fireEvent.click(open)
 const prepare=await screen.findByRole('button',{name:'Preparar candidatura'})
 expect(prepare.compareDocumentPosition(screen.getByRole('heading',{name:'Análise da organização'})) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
 expect(screen.queryByRole('region',{name:'Preparar candidatura'})).toBeNull()
 expect(api.create).not.toHaveBeenCalled();expect(central.get).not.toHaveBeenCalled()
})
it.each([{canManage:false,canCreateApplication:false},{canManage:true,canCreateApplication:false},{canManage:false,canCreateApplication:true}])('explains unavailable preparation without granting capabilities %j',async capabilities=>{
 api.get.mockResolvedValue({data:{...record,capabilities}})
 page('/interesses/interest')
 await screen.findByRole('heading',{name:record.title})
 expect(screen.queryByRole('button',{name:'Preparar candidatura'})).toBeNull()
 expect(central.get).not.toHaveBeenCalled();expect(api.create).not.toHaveBeenCalled()
})
it('requires an explicit scope, switches exclusive choices and submits the initial analysis',async()=>{
 catalog();fireEvent.click(await screen.findByRole('button',{name:'Registar interesse em Aviso de ensaio'}))
 const save=await screen.findByRole('button',{name:'Guardar interesse'})
 expect(save.disabled).toBe(true)
 const transversal=screen.getByLabelText('Interesse transversal à C4G'),unit=screen.getByLabelText('Projetos')
 fireEvent.click(unit);fireEvent.click(transversal);expect(unit.checked).toBe(false)
 fireEvent.click(unit);expect(transversal.checked).toBe(false)
 fireEvent.change(screen.getByLabelText('Notas iniciais (opcional)'),{target:{value:'Rever calendário'}})
 fireEvent.click(save);await waitFor(()=>expect(api.create).toHaveBeenCalledWith(expect.objectContaining({unitIds:['unit'],transversal:false,notes:'Rever calendário'}),'org'))
})

it('does not overwrite another pending interest intention',()=>{
 const first={userId:'user',organizationId:'org',method:'edit',id:'interest',payload:{notes:null,unitIds:[],expectedRevision:1},idempotencyKey:'first'}
 saveInterestIntention(first)
 expect(()=>saveInterestIntention({...first,idempotencyKey:'second'})).toThrow()
 expect(readInterestIntention('user','org')).toEqual(first)
 saveInterestIntention(first)
})

it('two command instances cannot overwrite an in-flight intention', async()=>{
 let finish;api.edit.mockImplementation(()=>new Promise(resolve=>{finish=resolve}))
 const first=renderHook(()=>useInterestCommand('user','org')), second=renderHook(()=>useInterestCommand('user','org'))
 const payload={notes:null,unitIds:[],expectedRevision:1}
 let pending;act(()=>{pending=first.result.current.submit('edit','interest',payload);second.result.current.submit('edit','other',payload)})
 expect(api.edit).toHaveBeenCalledTimes(1)
 expect(second.result.current.pending.id).toBe('interest')
 expect(readInterestIntention('user','org').id).toBe('interest')
 await act(async()=>{finish({data:record});await pending})
})
