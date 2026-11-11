import {afterEach,beforeEach,expect,it,vi} from 'vitest'
import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react'
import {MemoryRouter} from 'react-router-dom'
const mocks=vi.hoisted(()=>({browse:vi.fn(),auth:{user:{id:'u'},organization:{id:'a'}}}))
vi.mock('../../api/api',()=>({privateApplicationsApi:{partnersBrowse:mocks.browse}}))
vi.mock('../../contexts/AuthContext',()=>({useAuth:()=>mocks.auth}))
import Partners from '../Partners'
const result={data:{items:[],countries:[],total:0,page:1,nextCursor:null,previousCursor:null}}
beforeEach(()=>{vi.clearAllMocks();mocks.auth.organization={id:'a'};mocks.browse.mockResolvedValue(result)})
afterEach(cleanup)
it('uses the organization-scoped current API, renders authorized metadata and handles failed refresh',async()=>{
 mocks.browse.mockResolvedValueOnce({...result,data:{...result.data,countries:['Portugal']}})
 render(<MemoryRouter><Partners/></MemoryRouter>);await screen.findByText('Ainda não há parceiros registados.');expect(screen.queryByText('Entidades e contactos associados às candidaturas a que tem acesso.')).toBeNull();expect(mocks.browse).toHaveBeenCalledWith({},'a',expect.any(AbortSignal));expect(screen.getByRole('option',{name:'Portugal'})).toBeTruthy()
 mocks.browse.mockRejectedValue({response:{status:503}});fireEvent.change(screen.getByLabelText('Pesquisar parceiros'),{target:{value:'Ana'}});await screen.findByRole('alert');expect(screen.queryByText('Sem parceiros para estes filtros.')).toBeNull();expect(screen.queryByRole('option',{name:'Portugal'})).toBeNull()
})
it('discards delayed results and countries from the previous organization',async()=>{
 let resolve,oldSignal;mocks.browse.mockImplementationOnce((_,__,signal)=>{oldSignal=signal;return new Promise(r=>{resolve=r})})
 const view=render(<MemoryRouter><Partners/></MemoryRouter>);await waitFor(()=>expect(mocks.browse).toHaveBeenCalledTimes(1));mocks.auth.organization={id:'b'};view.rerender(<MemoryRouter><Partners/></MemoryRouter>);await screen.findByText('Ainda não há parceiros registados.')
 expect(oldSignal.aborted).toBe(true);resolve({data:{...result.data,countries:['Segredo'],total:1,items:[]}});await waitFor(()=>expect(mocks.browse).toHaveBeenCalledWith({},'b',expect.any(AbortSignal)));expect(screen.queryByRole('option',{name:'Segredo'})).toBeNull()
})
it('opens the complete authorized partner card and restores focus without losing filters',async()=>{
 const partner={id:'p',entity_name:'Instituto Parceiro',country:'Portugal',research_area_interest:'Investigação aplicada',responsible_person:'Maria',contact:'210000000',email:'geral@example.org',people:[{id:'one',name:'Ana',role:'INVESTIGADOR',research_area:'Saúde',contact:'220000000',email:'ana@example.org'}],application_id:'app',application_title:'Projeto conjunto',application_status:'IDENTIFIED'}
 mocks.browse.mockResolvedValue({data:{...result.data,items:[partner],total:1}})
 const view=render(<MemoryRouter><Partners/></MemoryRouter>)
 const search=screen.getByRole('searchbox',{name:'Pesquisar parceiros'});fireEvent.change(search,{target:{value:'Instituto'}});await waitFor(()=>expect(mocks.browse).toHaveBeenLastCalledWith({q:'Instituto'},'a',expect.any(AbortSignal)))
 const trigger=await screen.findByRole('button',{name:'Ver ficha de Instituto Parceiro'});trigger.focus();fireEvent.click(trigger)
 const dialog=screen.getByRole('dialog',{name:'Ficha de parceiro'})
 expect(dialog.textContent).toContain('Investigação aplicada');expect(dialog.textContent).toContain('ana@example.org');expect(dialog.textContent).toContain('Saúde')
 expect(screen.getByRole('link',{name:'Abrir parceiros da candidatura'}).getAttribute('href')).toBe('/candidaturas/app#parceiros')
 fireEvent.keyDown(dialog,{key:'Escape'});expect(screen.queryByRole('dialog')).toBeNull();await waitFor(()=>expect(document.activeElement).toBe(trigger))
 expect(search.value).toBe('Instituto')
 fireEvent.click(trigger);mocks.auth.organization={id:'b'};view.rerender(<MemoryRouter><Partners/></MemoryRouter>);expect(screen.queryByRole('dialog')).toBeNull()
})
