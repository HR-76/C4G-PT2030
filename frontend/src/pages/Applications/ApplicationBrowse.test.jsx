import {afterEach,beforeEach,expect,it,vi} from 'vitest'
import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react'
import {MemoryRouter} from 'react-router-dom'
const api=vi.hoisted(()=>({browsePage:vi.fn(),browse:vi.fn(),transition:vi.fn(),unitOptions:vi.fn()}))
const auth=vi.hoisted(()=>({user:{id:'user-a'},organization:{id:'org-a'}}))
vi.mock('../../api/api',()=>({privateApplicationsApi:api}))
vi.mock('../../contexts/AuthContext',()=>({useAuth:()=>auth}))
import ApplicationBrowse from './ApplicationBrowse'
import {applicationIntentKey} from './intentions'
const row={applicationId:'app-a',opportunityId:'opp-a',origin:'PRIVATE',title:'Dossier solar',opportunityTitle:'Aviso Solar',responsibleName:'Ana',status:'IDENTIFIED',revision:2,allowedTransitions:['PREPARATION'],totalBudget:'0',organizationBudget:'1234.56',opportunityClosingDate:'2027-01-01'}
const page={units:[],items:[row],total:51,countsByStatus:{IDENTIFIED:51},page:1,pageSize:25,nextCursor:'next',previousCursor:null}
const mount=()=>render(<MemoryRouter><ApplicationBrowse/></MemoryRouter>)
beforeEach(()=>{vi.clearAllMocks();sessionStorage.clear();api.browsePage.mockResolvedValue({data:page});api.unitOptions.mockResolvedValue({data:{items:[]}});auth.organization={id:'org-a'}})
afterEach(cleanup)
it('does not show page zero for an empty first page and preserves navigation from an empty later page',async()=>{
 api.browsePage.mockResolvedValue({data:{...page,items:[],total:0,nextCursor:null}})
 const view=mount();await screen.findByText('Ainda não existem candidaturas registadas.')
 expect(screen.queryByRole('navigation',{name:'Paginação de candidaturas'})).toBeNull()
 view.unmount();api.browsePage.mockResolvedValue({data:{...page,items:[],total:0,nextCursor:null,previousCursor:'previous'}})
 mount();await screen.findByText('Sem resultados nesta página')
 fireEvent.click(screen.getByRole('button',{name:'Anterior'}))
 await waitFor(()=>expect(api.browsePage.mock.calls.at(-1)[0].cursor).toBe('previous'))
})
it('preserves eight sortable data columns plus the final opening action and asks the server for filters, sort and next page',async()=>{
 mount();await screen.findByRole('link',{name:'Dossier solar'});expect(screen.getAllByRole('columnheader')).toHaveLength(9)
 expect(screen.getAllByRole('columnheader').at(-1).textContent).toBe('Ações')
 expect(screen.getByRole('link',{name:'Abrir candidatura Dossier solar'}).getAttribute('href')).toBe(screen.getByRole('link',{name:'Dossier solar'}).getAttribute('href'))
 expect(screen.getByRole('button',{name:'Informação sobre as contagens'})).toBeTruthy();expect(screen.queryByText(/Para criar, abra uma oportunidade/)).toBeNull()
 expect(screen.getByText('0,00 €')).toBeTruthy();expect(screen.getByText('Ana')).toBeTruthy()
 fireEvent.click(screen.getByRole('button',{name:'Seguinte'}));await waitFor(()=>expect(api.browsePage.mock.calls.at(-1)[0].cursor).toBe('next'))
 fireEvent.change(screen.getByRole('searchbox',{name:'Pesquisar candidaturas'}),{target:{value:'solar'}})
 await waitFor(()=>expect(api.browsePage.mock.calls.at(-1)[0]).toMatchObject({q:'solar',cursor:undefined}))
 fireEvent.click(screen.getByRole('button',{name:'Orç. total'}));await waitFor(()=>expect(api.browsePage.mock.calls.at(-1)[0].sort).toBe('totalBudget'))
})
it('presents the five main states with readable labels and keeps other states available',async()=>{
 const statuses=['IDENTIFIED','PREPARATION','SUBMITTED','APPROVED','REJECTED']
 api.browsePage.mockResolvedValue({data:{...page,items:statuses.map((status,index)=>({...row,applicationId:`state-${index}`,title:`Candidatura ${index}`,status,allowedTransitions:[]})),countsByStatus:Object.fromEntries(statuses.map(status=>[status,1]))}})
 mount();await screen.findByRole('link',{name:'Candidatura 0'})
 const rows=screen.getAllByRole('row').slice(1)
 expect(rows.map(item=>item.getAttribute('data-status'))).toEqual(statuses)
 for(const label of ['Identificada','Em preparação','Submetida','Aprovada','Reprovada'])expect(screen.getByRole('button',{name:`${label} 1`})).toBeTruthy()
 expect(screen.queryByText('Rejeitada')).toBeNull()
 const other=screen.getByText('Outros estados').closest('details')
 expect(other).toBeTruthy()
 fireEvent.click(screen.getByText('Outros estados'))
 fireEvent.click(screen.getByRole('button',{name:'Arquivada 0'}))
 await waitFor(()=>expect(api.browsePage.mock.calls.at(-1)[0].status).toBe('ARCHIVED'))
})
it('does not turn a request failure into zero counts or an empty list',async()=>{
 api.browsePage.mockRejectedValue({response:{status:503}});mount();await screen.findByRole('alert')
 expect(screen.queryByText('Ainda não existem candidaturas registadas.')).toBeNull();expect(screen.queryByText('0 candidaturas')).toBeNull()
 expect(screen.queryByRole('link',{name:'Dossier solar'})).toBeNull()
})
it('discards an old search result after filters change',async()=>{
 let resolve;api.browsePage.mockImplementationOnce(()=>new Promise(r=>{resolve=r}));mount();await waitFor(()=>expect(api.browsePage).toHaveBeenCalledTimes(1))
 fireEvent.change(screen.getByRole('searchbox',{name:'Pesquisar candidaturas'}),{target:{value:'novo'}})
 api.browsePage.mockResolvedValue({data:{...page,items:[{...row,title:'Novo dossier'}]}});await screen.findByRole('link',{name:'Novo dossier'})
 resolve({data:page});await waitFor(()=>expect(screen.queryByRole('link',{name:'Dossier solar'})).toBeNull())
})
it('aborts stale filter requests and the active request on unmount',async()=>{
 let firstSignal,secondSignal
 api.browsePage.mockImplementationOnce((_,__,signal)=>{firstSignal=signal;return new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(Object.assign(new Error('Canceled'),{code:'ERR_CANCELED'})),{once:true}))})
  .mockImplementationOnce((_,__,signal)=>{secondSignal=signal;return Promise.resolve({data:{...page,items:[{...row,title:'Resultado atual'}]}})})
 const view=mount();await waitFor(()=>expect(firstSignal).toBeInstanceOf(AbortSignal))
 fireEvent.change(screen.getByRole('searchbox',{name:'Pesquisar candidaturas'}),{target:{value:'atual'}})
 await waitFor(()=>expect(firstSignal.aborted).toBe(true))
 await screen.findByRole('link',{name:'Resultado atual'})
 expect(screen.queryByRole('alert')).toBeNull()
 view.unmount();expect(secondSignal.aborted).toBe(true)
})
it('confirms with a reason and replays the same stored transition after a lost response and reload',async()=>{
 api.transition.mockRejectedValueOnce({response:{status:503}}).mockResolvedValueOnce({data:{...row,status:'PREPARATION'}})
 let view=mount();await screen.findByLabelText('Estado de Dossier solar')
 fireEvent.click(screen.getByLabelText('Estado de Dossier solar'))
 expect(screen.getByRole('dialog')).toBeTruthy()
 fireEvent.change(screen.getByLabelText('Novo estado'),{target:{value:'PREPARATION'}})
 expect(screen.getByRole('button',{name:'Confirmar alteração'}).disabled).toBe(true)
 fireEvent.change(screen.getByLabelText('Motivo'),{target:{value:'Preparar com a equipa'}});fireEvent.click(screen.getByRole('button',{name:'Confirmar alteração'}))
 await screen.findByRole('alert');const sent=api.transition.mock.calls[0];expect(sent[1]).toMatchObject({status:'PREPARATION',reason:'Preparar com a equipa',expectedRevision:2})
 view.unmount();view=mount();fireEvent.click(await screen.findByRole('button',{name:'Repetir o mesmo envio'}))
 await waitFor(()=>expect(api.transition).toHaveBeenCalledTimes(2));expect(api.transition.mock.calls[1]).toEqual(sent)
 await waitFor(()=>expect(sessionStorage.getItem(applicationIntentKey('user-a','org-a'))).toBeNull())
})
it('hides transition controls without permission',async()=>{
 api.browsePage.mockResolvedValue({data:{...page,items:[{...row,allowedTransitions:[]}]}});mount();await screen.findByRole('link',{name:'Dossier solar'})
 expect(screen.queryByLabelText('Estado de Dossier solar')).toBeNull()
})
it('filters by explicit unit and no unit, preserving filters when opening a record',async()=>{
 const unit='00000000-0000-4000-8000-000000000061'
 api.browsePage.mockResolvedValue({data:{...page,units:[{unitId:unit,label:'Investigação',lifecycle:'ACTIVE'}]}})
 mount();await screen.findByRole('link',{name:'Dossier solar'})
 expect(api.browsePage.mock.calls[0][1]).toBe('org-a')
 fireEvent.change(screen.getByLabelText('Departamento / Unidade'),{target:{value:unit}})
 await waitFor(()=>expect(api.browsePage.mock.calls.at(-1)[0]).toMatchObject({unitId:unit,cursor:undefined}))
 await screen.findByRole('link',{name:'Dossier solar'})
 expect(screen.getByRole('link',{name:'Dossier solar'}).getAttribute('href')).toContain(encodeURIComponent(`unitId=${unit}`))
 fireEvent.change(screen.getByLabelText('Departamento / Unidade'),{target:{value:'NONE'}})
 await waitFor(()=>expect(api.browsePage.mock.calls.at(-1)[0].unitId).toBe('NONE'))
 fireEvent.click(screen.getByRole('button',{name:'Limpar filtros'}))
 await waitFor(()=>expect(api.browsePage.mock.calls.at(-1)[0].unitId).toBeUndefined())
})
it('refuses an incomplete combined response and permits a complete retry',async()=>{
 api.browsePage.mockResolvedValueOnce({data:{...page,units:null}})
 mount();await screen.findByRole('alert')
 expect(screen.queryByRole('link',{name:'Dossier solar'})).toBeNull()
 fireEvent.click(screen.getByRole('button',{name:'Recarregar primeira página'}))
 await screen.findByRole('link',{name:'Dossier solar'})
 expect(api.browsePage).toHaveBeenCalledTimes(2)
})
it('loads the complete page and unit options in one request',async()=>{
 api.browsePage.mockResolvedValue({data:{...page,units:[]}})
 mount();await screen.findByRole('link',{name:'Dossier solar'})
 expect(api.browsePage).toHaveBeenCalledTimes(1)
 expect(api.browse).not.toHaveBeenCalled();expect(api.unitOptions).not.toHaveBeenCalled()
})

it('permite remover a pesquisa ativa sem alterar a ordenação',async()=>{
 mount();await screen.findByRole('link',{name:'Dossier solar'});fireEvent.click(screen.getByRole('button',{name:'Orç. total'}));fireEvent.change(screen.getByRole('searchbox',{name:'Pesquisar candidaturas'}),{target:{value:'solar'}})
 expect(screen.getByRole('button',{name:'Remover filtro de pesquisa'}).textContent).toContain('solar');fireEvent.click(screen.getByRole('button',{name:'Remover filtro de pesquisa'}));await waitFor(()=>expect(api.browsePage.mock.calls.at(-1)[0]).toMatchObject({q:'',sort:'totalBudget'}))
})

