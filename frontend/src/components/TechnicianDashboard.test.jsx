import {afterEach,expect,it,vi} from 'vitest'
import {cleanup,fireEvent,render,screen} from '@testing-library/react'
import {MemoryRouter} from 'react-router-dom'
import TechnicianDashboard from '../pages/TechnicianDashboard'
import {organizationNotificationsApi,privateApplicationsApi} from '../api/api'
vi.mock('../api/api',()=>({privateApplicationsApi:{myWork:vi.fn(),assignedReviews:vi.fn()},organizationNotificationsApi:{list:vi.fn()}}))
afterEach(()=>{cleanup();vi.resetAllMocks()})
const show=()=>{privateApplicationsApi.assignedReviews.mockResolvedValue({data:{items:[]}});organizationNotificationsApi.list.mockResolvedValue({data:{notifications:[]}});return render(<MemoryRouter><TechnicianDashboard organization={{id:'org',name:'Entidade'}}/></MemoryRouter>)}
it('apresenta tarefas atribuídas e liga à equipa da candidatura',async()=>{
 privateApplicationsApi.myWork.mockResolvedValue({data:{total:1,items:[{taskId:'t',applicationId:'a',title:'Rever plano',applicationTitle:'Projeto',group:'overdue',deadline:'2026-11-10'}]}})
 show();const link=await screen.findByRole('link',{name:/Rever plano/});expect(link.getAttribute('href')).toBe('/candidaturas/a#equipa-tarefas');expect(screen.getByText(/Em atraso/)).toBeTruthy();expect(privateApplicationsApi.myWork).toHaveBeenCalledWith(expect.objectContaining({status:'OPEN'}),'org',expect.any(AbortSignal))
})
it('distingue falha de consulta de ausência de tarefas',async()=>{
 privateApplicationsApi.myWork.mockRejectedValue(new Error('unavailable'));show();expect((await screen.findByRole('alert')).textContent).toContain('Não foi possível carregar as tarefas.');expect(screen.queryByText(/Não tem tarefas/)).toBeNull()
})
it('apresenta alertas e revisões autorizadas com âmbito explícito',async()=>{
 privateApplicationsApi.myWork.mockResolvedValue({data:{total:0,items:[]}})
 privateApplicationsApi.assignedReviews
  .mockResolvedValueOnce({data:{items:[{requestId:'r',applicationId:'a',title:'Projeto',requestedAt:'2026-11-10T12:00:00Z'}],nextCursor:'next'}})
  .mockResolvedValueOnce({data:{items:[{requestId:'s',applicationId:'b',title:'Segunda candidatura',requestedAt:'2026-11-11T12:00:00Z'}]}})
 organizationNotificationsApi.list.mockResolvedValue({data:{notifications:[{id:'n',title:'Novo alerta',is_read:false,created_at:'2026-11-10T12:00:00Z'}]}})
 render(<MemoryRouter><TechnicianDashboard organization={{id:'org',name:'Entidade'}}/></MemoryRouter>)
 expect((await screen.findByRole('link',{name:/Projeto/})).getAttribute('href')).toBe('/candidaturas/a#documentos-revisao')
 expect(await screen.findByText('Novo alerta')).toBeTruthy()
 fireEvent.click(screen.getByRole('button',{name:'Mais revisões'}))
 expect(await screen.findByRole('link',{name:/Segunda candidatura/})).toBeTruthy()
 expect(privateApplicationsApi.assignedReviews).toHaveBeenLastCalledWith({cursor:'next'},'org',expect.any(AbortSignal))
})

it('mostra um erro quando a resposta de tarefas nao contem uma lista',async()=>{
 privateApplicationsApi.myWork.mockResolvedValue({data:{items:{length:1}}})
 show()
 expect((await screen.findByRole('alert')).textContent).toContain('Não foi possível carregar as tarefas.')
})

it('pede apenas os cinco alertas que apresenta',async()=>{
 privateApplicationsApi.myWork.mockResolvedValue({data:{total:0,items:[]}})
 show();await screen.findByText('Não existem alertas disponíveis.')
 expect(organizationNotificationsApi.list).toHaveBeenCalledWith({limit:5},'org',expect.any(AbortSignal))
})

it('reabre com os dados já confirmados e volta a lê-los',async()=>{
 const {clearConfirmedReads,readScope}=await import('../api/confirmedReads')
 clearConfirmedReads()
 const scope=readScope('user','org'),mount=()=>render(<MemoryRouter><TechnicianDashboard organization={{id:'org',name:'Entidade'}} scope={scope}/></MemoryRouter>)
 privateApplicationsApi.myWork.mockResolvedValue({data:{total:1,items:[{taskId:'t',applicationId:'a',title:'Rever plano',applicationTitle:'Projeto',group:'today',deadline:'2026-11-10'}]}})
 privateApplicationsApi.assignedReviews.mockResolvedValue({data:{items:[{requestId:'r',applicationId:'a',title:'Revisão pendente',requestedAt:'2026-11-10T12:00:00Z'}]}})
 organizationNotificationsApi.list.mockResolvedValue({data:{notifications:[{id:'n',title:'Novo alerta',is_read:false,created_at:'2026-11-10T12:00:00Z'}]}})
 mount();await screen.findByRole('link',{name:/Rever plano/});await screen.findByText('Novo alerta');await screen.findByRole('link',{name:/Revisão pendente/});cleanup()
 // Second entry: the answers never arrive, yet the confirmed data is on screen and all three are read again.
 const never=new Promise(()=>{})
 privateApplicationsApi.myWork.mockReturnValue(never);privateApplicationsApi.assignedReviews.mockReturnValue(never);organizationNotificationsApi.list.mockReturnValue(never)
 mount()
 expect(screen.getByRole('link',{name:/Rever plano/})).toBeTruthy();expect(screen.getByText('Novo alerta')).toBeTruthy();expect(screen.getByRole('link',{name:/Revisão pendente/})).toBeTruthy()
 expect(screen.queryByRole('status')).toBeNull()
 expect(privateApplicationsApi.myWork).toHaveBeenCalledTimes(2);expect(privateApplicationsApi.assignedReviews).toHaveBeenCalledTimes(2);expect(organizationNotificationsApi.list).toHaveBeenCalledTimes(2)
 cleanup()
 // Another user of the same organization never sees them.
 render(<MemoryRouter><TechnicianDashboard organization={{id:'org',name:'Entidade'}} scope={readScope('other','org')}/></MemoryRouter>)
 expect(screen.queryByText('Novo alerta')).toBeNull();expect(screen.queryByRole('link',{name:/Rever plano/})).toBeNull()
 clearConfirmedReads()
})

it('retira os dados confirmados quando a nova leitura é recusada',async()=>{
 const {clearConfirmedReads,readScope}=await import('../api/confirmedReads')
 clearConfirmedReads()
 const scope=readScope('user','org'),mount=()=>render(<MemoryRouter><TechnicianDashboard organization={{id:'org',name:'Entidade'}} scope={scope}/></MemoryRouter>)
 privateApplicationsApi.myWork.mockResolvedValue({data:{total:1,items:[{taskId:'t',applicationId:'a',title:'Rever plano',applicationTitle:'Projeto',group:'today',deadline:'2026-11-10'}]}})
 privateApplicationsApi.assignedReviews.mockResolvedValue({data:{items:[]}});organizationNotificationsApi.list.mockResolvedValue({data:{notifications:[]}})
 mount();await screen.findByRole('link',{name:/Rever plano/});cleanup()
 privateApplicationsApi.myWork.mockRejectedValue(new Error('refused'))
 mount();expect((await screen.findByRole('alert')).textContent).toContain('Não foi possível carregar as tarefas.');expect(screen.queryByRole('link',{name:/Rever plano/})).toBeNull();cleanup()
 privateApplicationsApi.myWork.mockReturnValue(new Promise(()=>{}))
 mount();expect(screen.queryByRole('link',{name:/Rever plano/})).toBeNull()
 clearConfirmedReads()
})
