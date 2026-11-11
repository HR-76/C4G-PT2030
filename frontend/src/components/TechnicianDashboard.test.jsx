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
