import {afterEach,beforeEach,expect,it,vi} from 'vitest'
import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react'
import {MemoryRouter,Routes,Route} from 'react-router-dom'
const api=vi.hoisted(()=>Object.fromEntries(['context','summaries','units','create'].map(n=>[n,vi.fn()])))
const read=vi.hoisted(()=>vi.fn())
const central=vi.hoisted(()=>({get:vi.fn()}))
vi.mock('../../api/api',()=>({catalogReadApi:read,centralOpportunitiesApi:central,opportunityInterestsApi:api}))
vi.mock('../../contexts/AuthContext',()=>({useAuth:()=>({user:{id:'admin'}})}))
import CatalogReadWorkspace from './CatalogReadWorkspace'
import {clearCatalogSessions} from './catalogReadSession'
import {safeInterestReturn} from '../Interests/intentions'
const id='11111111-1111-4111-8111-111111111111',revisionId='22222222-2222-4222-8222-222222222222'
const item={id,revisionId,title:{state:'PRESENT',value:'Call de ensaio'},descriptionExcerpt:{state:'PRESENT',value:'Call de ensaio'},externalCode:{state:'PRESENT',value:'EU-1'},sources:[],programmes:{items:[]},deadline:{label:'Por confirmar'},status:{label:'Aberto'},quality:{flags:[]}}
const detail={summary:item,description:{state:'PRESENT',value:'Descrição completa com objetivos e condições.'},statusExplanation:'SOURCE_STATUS_ONLY',collections:{}}
const meta={snapshot:'test-only',generationId:'g',asOf:new Date().toISOString(),expiresAt:new Date(Date.now()+900000).toISOString()}
const mount=(path='/catalogo/consulta')=>render(<MemoryRouter initialEntries={[path]}><Routes><Route path='/catalogo/consulta' element={<CatalogReadWorkspace scope='test' isolated={false} basePath='/catalogo/consulta' interestOrganization={{id:'org'}}/>}/><Route path='/catalogo/consulta/:id' element={<CatalogReadWorkspace scope='test' isolated={false} basePath='/catalogo/consulta' interestOrganization={{id:'org'}}/>}/></Routes></MemoryRouter>)
beforeEach(()=>{
 vi.resetAllMocks();sessionStorage.clear();clearCatalogSessions()
 read.mockImplementation(path=>Promise.resolve(path==='/opportunities'?{data:[item],meta,page:{hasMore:false}}:path==='/opportunities/'+id?{data:detail,meta}:{data:[],meta,page:{hasMore:false}}))
 central.get.mockResolvedValue({data:{opportunityId:id,revisionId,title:item.title.value,lifecycleState:'ACTIVE'}})
 api.context.mockResolvedValue({data:{capabilities:{canRegister:true}}})
 api.summaries.mockImplementation(ids=>Promise.resolve({data:{items:ids.map(opportunityId=>({opportunityId,interestId:null}))}}))
 api.units.mockResolvedValue({data:{items:[]}})
 api.create.mockResolvedValue({data:{opportunityId:id,interestId:'interest',status:'ACTIVE'}})
})
afterEach(()=>{cleanup();clearCatalogSessions()})
it.each(['/catalogo/consulta','/catalogo/consulta/'+id])('registers through existing tenant API from %s with exact current revision',async path=>{
 mount(path);fireEvent.click(await screen.findByRole('button',{name:'Registar interesse em Call de ensaio'}));await screen.findByRole('dialog')
 fireEvent.click(await screen.findByLabelText('Interesse transversal à C4G'));fireEvent.click(screen.getByRole('button',{name:'Guardar interesse'}))
 await screen.findByText('Interesse registado')
 expect(api.create).toHaveBeenCalledWith({opportunityId:id,centralRevisionId:revisionId,unitIds:[],notes:null,transversal:true,idempotencyKey:expect.any(String)},'org')
 expect(read).toHaveBeenCalledWith('/opportunities/'+id,{snapshot:'test-only'})
 expect(screen.queryByRole('button',{name:'Registar interesse em Call de ensaio'})).toBeNull()
})
it('refuses a newer central revision instead of registering a different opportunity version',async()=>{
 central.get.mockResolvedValue({data:{opportunityId:id,revisionId:'new-revision'}})
 mount();fireEvent.click(await screen.findByRole('button',{name:'Registar interesse em Call de ensaio'}))
 await screen.findByText('Não foi possível preparar o interesse. Tente novamente.');expect(api.create).not.toHaveBeenCalled();expect(screen.queryByRole('dialog')).toBeNull()
})
it('denied fresh catalog access prevents opening the registration form',async()=>{
 mount();const button=await screen.findByRole('button',{name:'Registar interesse em Call de ensaio'})
 read.mockRejectedValue({response:{status:403}});fireEvent.click(button)
 await screen.findByText('Não foi possível preparar o interesse. Tente novamente.');expect(central.get).not.toHaveBeenCalled();expect(api.create).not.toHaveBeenCalled()
})
it('shows existing organizational interest and respects registration capability',async()=>{
 api.context.mockResolvedValue({data:{capabilities:{canRegister:false}}});api.summaries.mockResolvedValue({data:{items:[{opportunityId:id,interestId:'existing',status:'ACTIVE'}]}})
 mount('/catalogo/consulta/'+id);const link=await screen.findByRole('link',{name:'Consultar na lista de interesses'})
 expect(new URLSearchParams(link.getAttribute('href').split('?')[1]).get('destaque')).toBe('existing')
 expect(screen.queryByRole('button',{name:/Registar interesse em/})).toBeNull()
})
it('full description belongs to the detail and repeated title is omitted from table excerpt',async()=>{
 const view=mount();await screen.findByRole('link',{name:'Call de ensaio'});expect(document.querySelector('.cr-excerpt')).toBeNull();view.unmount();clearCatalogSessions()
 mount('/catalogo/consulta/'+id);await screen.findByText(detail.description.value)
 expect(screen.getByRole('heading',{name:'Descrição da call / aviso'})).toBeTruthy()
})
it('return navigation admits unified detail but never external or malformed paths',()=>{
 expect(safeInterestReturn('/catalogo/consulta/'+id+'?source=EU')).toBe('/catalogo/consulta/'+id+'?source=EU')
 for(const value of ['//evil.test','https://evil.test','/catalogo/consulta/../../admin','/catalogo/consulta/\\evil'])expect(safeInterestReturn(value)).toBe('/interesses')
})
it('does not offer registration to a member without the existing write capability',async()=>{
 api.context.mockResolvedValue({data:{capabilities:{canRegister:false}}});mount()
 await waitFor(()=>expect(api.summaries).toHaveBeenCalledWith([id],'org',expect.any(AbortSignal)))
 expect(screen.queryByRole('button',{name:/Registar interesse em/})).toBeNull();expect(api.create).not.toHaveBeenCalled()
})
it('missing full description is explicit rather than presenting the title as description',async()=>{
 read.mockImplementation(path=>Promise.resolve(path==='/opportunities/'+id?{data:{...detail,description:item.title},meta}:{data:[],meta,page:{hasMore:false}}))
 mount('/catalogo/consulta/'+id)
 await screen.findByText('A descrição detalhada não está disponível nos dados recolhidos.')
})
it('does not start private interest reads before catalog data is available',async()=>{
 read.mockImplementation(()=>new Promise(()=>{}));mount()
 await screen.findByText('A carregar a consulta…')
 expect(api.context).not.toHaveBeenCalled();expect(api.summaries).not.toHaveBeenCalled()
})


