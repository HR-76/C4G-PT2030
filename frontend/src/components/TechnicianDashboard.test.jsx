import {afterEach,beforeEach,expect,it,vi} from 'vitest'
import {cleanup,fireEvent,render,screen} from '@testing-library/react'
import {MemoryRouter} from 'react-router-dom'
import TechnicianDashboard from '../pages/TechnicianDashboard'
import {privateApplicationsApi} from '../api/api'
import {clearConfirmedReads,readScope} from '../api/confirmedReads'
vi.mock('../api/api',()=>({privateApplicationsApi:{technicianDashboard:vi.fn(),assignedReviews:vi.fn()}}))
beforeEach(()=>clearConfirmedReads())
afterEach(()=>{cleanup();vi.resetAllMocks()})
const task={taskId:'t',applicationId:'a',title:'Rever plano',applicationTitle:'Projeto',group:'overdue',deadline:'2026-11-10'}
const alert={id:'n',title:'Novo alerta',is_read:false,created_at:'2026-11-10T12:00:00Z'}
const review={requestId:'r',applicationId:'a',title:'Revisão pendente',requestedAt:'2026-11-10T12:00:00Z'}
const failed={error:{code:'SERVICE_UNAVAILABLE'}}
const answer=(parts={})=>({data:{tasks:{total:0,items:[]},alerts:{notifications:[]},reviews:{items:[]},...parts}})
const show=(scope=null)=>render(<MemoryRouter><TechnicianDashboard organization={{id:'org',name:'Entidade'}} scope={scope}/></MemoryRouter>)

it('pede tarefas, alertas e revisões num único pedido e liga à equipa da candidatura',async()=>{
 privateApplicationsApi.technicianDashboard.mockResolvedValue(answer({tasks:{total:1,items:[task]},alerts:{notifications:[alert]},reviews:{items:[review]}}))
 show()
 const link=await screen.findByRole('link',{name:/Rever plano/});expect(link.getAttribute('href')).toBe('/candidaturas/a#equipa-tarefas');expect(screen.getByText(/Em atraso/)).toBeTruthy()
 expect(screen.getByText('Novo alerta')).toBeTruthy()
 expect(screen.getByRole('link',{name:/Revisão pendente/}).getAttribute('href')).toBe('/candidaturas/a#documentos-revisao')
 expect(privateApplicationsApi.technicianDashboard).toHaveBeenCalledTimes(1)
 expect(privateApplicationsApi.technicianDashboard).toHaveBeenCalledWith('org',expect.any(AbortSignal))
 expect(privateApplicationsApi.assignedReviews).not.toHaveBeenCalled()
})

it('distingue falha de consulta de ausência de tarefas',async()=>{
 privateApplicationsApi.technicianDashboard.mockRejectedValue(new Error('unavailable'));show()
 expect((await screen.findAllByRole('alert')).map(node=>node.textContent).join(' ')).toContain('Não foi possível carregar as tarefas.')
 expect(screen.queryByText(/Não tem tarefas/)).toBeNull();expect(screen.queryByText('Não existem alertas disponíveis.')).toBeNull();expect(screen.queryByText(/Sem revisões pendentes/)).toBeNull()
})

it('uma parte indisponível só afeta o seu painel',async()=>{
 privateApplicationsApi.technicianDashboard.mockResolvedValue(answer({tasks:{total:1,items:[task]},alerts:{notifications:[alert]},reviews:failed}))
 show()
 expect(await screen.findByRole('link',{name:/Rever plano/})).toBeTruthy();expect(screen.getByText('Novo alerta')).toBeTruthy()
 const alerts=screen.getAllByRole('alert');expect(alerts).toHaveLength(1);expect(alerts[0].textContent).toContain('Não foi possível consultar as revisões.')
 expect(screen.queryByText(/Sem revisões pendentes/)).toBeNull()
 // Repeating reads the whole dashboard again.
 privateApplicationsApi.technicianDashboard.mockResolvedValue(answer({reviews:{items:[review]}}))
 fireEvent.click(screen.getByRole('button',{name:'Repetir consulta de revisões'}))
 expect(await screen.findByRole('link',{name:/Revisão pendente/})).toBeTruthy();expect(privateApplicationsApi.technicianDashboard).toHaveBeenCalledTimes(2)
})

it('pagina as revisões pela consulta própria',async()=>{
 privateApplicationsApi.technicianDashboard.mockResolvedValue(answer({reviews:{items:[review],nextCursor:'next'}}))
 privateApplicationsApi.assignedReviews
  .mockResolvedValueOnce({data:{items:[{requestId:'s',applicationId:'b',title:'Segunda candidatura',requestedAt:'2026-11-11T12:00:00Z'}]}})
  .mockResolvedValueOnce({data:{items:[review],nextCursor:'next'}})
 show()
 await screen.findByRole('link',{name:/Revisão pendente/})
 fireEvent.click(screen.getByRole('button',{name:'Mais revisões'}))
 expect(await screen.findByRole('link',{name:/Segunda candidatura/})).toBeTruthy()
 expect(privateApplicationsApi.assignedReviews).toHaveBeenLastCalledWith({cursor:'next'},'org',expect.any(AbortSignal))
 fireEvent.click(screen.getByRole('button',{name:'Primeira página'}))
 expect(await screen.findByRole('link',{name:/Revisão pendente/})).toBeTruthy()
 expect(privateApplicationsApi.assignedReviews).toHaveBeenLastCalledWith({},'org',expect.any(AbortSignal))
 expect(privateApplicationsApi.technicianDashboard).toHaveBeenCalledTimes(1)
})

it('mostra um erro quando a resposta de tarefas nao contem uma lista',async()=>{
 privateApplicationsApi.technicianDashboard.mockResolvedValue(answer({tasks:{items:{length:1}}}))
 show()
 expect((await screen.findByRole('alert')).textContent).toContain('Não foi possível carregar as tarefas.')
})

it('reabre com os dados já confirmados e volta a lê-los',async()=>{
 const scope=readScope('user','org')
 privateApplicationsApi.technicianDashboard.mockResolvedValue(answer({tasks:{total:1,items:[task]},alerts:{notifications:[alert]},reviews:{items:[review]}}))
 show(scope);await screen.findByRole('link',{name:/Rever plano/});cleanup()
 // Second entry: the answer never arrives, yet the confirmed data is on screen and it is read again.
 privateApplicationsApi.technicianDashboard.mockReturnValue(new Promise(()=>{}))
 show(scope)
 expect(screen.getByRole('link',{name:/Rever plano/})).toBeTruthy();expect(screen.getByText('Novo alerta')).toBeTruthy();expect(screen.getByRole('link',{name:/Revisão pendente/})).toBeTruthy()
 expect(screen.queryByRole('status')).toBeNull()
 expect(privateApplicationsApi.technicianDashboard).toHaveBeenCalledTimes(2)
 cleanup()
 // Another user of the same organization never sees them.
 show(readScope('other','org'))
 expect(screen.queryByText('Novo alerta')).toBeNull();expect(screen.queryByRole('link',{name:/Rever plano/})).toBeNull()
})

it('retira os dados confirmados da parte recusada e mantém os das restantes',async()=>{
 const scope=readScope('user','org')
 privateApplicationsApi.technicianDashboard.mockResolvedValue(answer({tasks:{total:1,items:[task]},alerts:{notifications:[alert]}}))
 show(scope);await screen.findByRole('link',{name:/Rever plano/});cleanup()
 privateApplicationsApi.technicianDashboard.mockResolvedValue(answer({tasks:failed,alerts:{notifications:[alert]}}))
 show(scope);expect((await screen.findByRole('alert')).textContent).toContain('Não foi possível carregar as tarefas.');expect(screen.queryByRole('link',{name:/Rever plano/})).toBeNull();cleanup()
 privateApplicationsApi.technicianDashboard.mockReturnValue(new Promise(()=>{}))
 show(scope);expect(screen.queryByRole('link',{name:/Rever plano/})).toBeNull();expect(screen.getByText('Novo alerta')).toBeTruthy()
})
