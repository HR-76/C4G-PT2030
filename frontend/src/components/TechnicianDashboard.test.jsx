import {afterEach,beforeEach,expect,it,vi} from 'vitest'
import {cleanup,fireEvent,render,screen,within} from '@testing-library/react'
import {MemoryRouter} from 'react-router-dom'
import TechnicianDashboard from '../pages/TechnicianDashboard'
import {privateApplicationsApi} from '../api/api'
import {clearConfirmedReads,readScope} from '../api/confirmedReads'
const self=vi.hoisted(()=>vi.fn())
vi.mock('../api/api',()=>({privateApplicationsApi:{technicianDashboard:vi.fn(),assignedReviews:vi.fn()},organizationDirectoryApi:()=>({self})}))
beforeEach(()=>{clearConfirmedReads();self.mockRejectedValue(new Error('no profile'))})
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

it('mostra os três gráficos com as candidaturas por estado, as tarefas por prazo e a carga por candidatura',async()=>{
 privateApplicationsApi.technicianDashboard.mockResolvedValue(answer({applications:{total:3,countsByStatus:{PREPARATION:2,SUBMITTED:1,APPROVED:0}},
  tasks:{total:5,items:[task],counts:{overdue:2,upcoming:3},byApplication:{total:9,items:[{applicationId:'a',title:'Projeto Alfa',total:4,overdue:2},{applicationId:'b',title:'Projeto Beta',total:1,overdue:0}]}}}))
 show()
 const states=(await screen.findByRole('heading',{name:'As minhas candidaturas por estado'})).closest('section')
 expect(states.querySelector('.chart-ring strong').textContent).toBe('3')
 expect(within(states).getByRole('link',{name:/Em preparação/}).getAttribute('href')).toBe('/candidaturas?status=PREPARATION')
 expect(within(states).queryByText('Aprovada')).toBeNull()
 const periods=screen.getByRole('heading',{name:'Tarefas por prazo'}).closest('section')
 expect(within(periods).getByText('5 tarefas por concluir.')).toBeTruthy()
 expect([...periods.querySelectorAll('.chart-budget')].map(row=>row.textContent)).toEqual(['Em atraso2','Hoje0','Próximas3'])
 const workload=screen.getByRole('heading',{name:'Carga por candidatura'}).closest('section')
 expect(within(workload).getByRole('link',{name:'Projeto Alfa'}).getAttribute('href')).toBe('/candidaturas/a#equipa-tarefas')
 expect(within(workload).getByText('2 em atraso')).toBeTruthy()
 expect(within(workload).getByText('A mostrar 2 de 9 candidaturas com tarefas.')).toBeTruthy()
})

it('distingue a ausência de dados da falha de cada gráfico e mantém as listas',async()=>{
 privateApplicationsApi.technicianDashboard.mockResolvedValue(answer({applications:failed,tasks:{total:0,items:[],counts:{},byApplication:{total:0,items:[]}},alerts:{notifications:[alert]}}))
 show()
 const states=(await screen.findByRole('heading',{name:'As minhas candidaturas por estado'})).closest('section')
 expect(within(states).getByRole('alert').textContent).toBe('Não foi possível carregar estes dados.')
 expect(screen.getAllByText('Sem tarefas por concluir.')).toHaveLength(2)
 expect(document.querySelectorAll('.technician-charts .chart-track')).toHaveLength(0)
 expect(screen.getByText('Novo alerta')).toBeTruthy()
 cleanup()
 privateApplicationsApi.technicianDashboard.mockResolvedValue(answer({applications:{total:0,countsByStatus:{}}}))
 show()
 expect(await screen.findByText('Sem candidaturas acessíveis.')).toBeTruthy()
 expect(screen.queryByRole('heading',{name:'Carga por candidatura'})).toBeNull()
})

it('mostra os objetivos dos departamentos do técnico e fica oculto sem perfil ou em falha',async()=>{
 privateApplicationsApi.technicianDashboard.mockResolvedValue(answer())
 self.mockResolvedValue({data:{areas:[{id:'health',name:'Saúde Digital'}],departments:[
  {scopeId:'u',label:'Informática',isPrimary:true,areaIds:['health'],objectives:[{id:'o',title:'Integrar dados',target:'3 sistemas',deadline:'2027-06-30',areaIds:[],strategicObjectives:[{id:'g',title:'Lançar dois pilotos'}]},
   {id:'p',title:'Formar a equipa',target:'',deadline:null,areaIds:[],strategicObjectives:[]}]},
  {scopeId:'v',label:'Sem perfil',isPrimary:false,areaIds:[],objectives:[]}]}})
 show()
 const section=(await screen.findByRole('heading',{name:'Os objetivos dos meus departamentos'})).closest('section')
 expect(within(section).getByText('Informática · Principal')).toBeTruthy()
 expect(within(section).getByText('Áreas de interesse: Saúde Digital')).toBeTruthy()
 expect(within(section).getByText('Meta: 3 sistemas · Prazo: 30/06/2027 · Contribui para: Lançar dois pilotos')).toBeTruthy()
 expect(within(section).getByText('Sem ligação a objetivo estratégico')).toBeTruthy()
 expect(within(section).queryByText('Sem perfil')).toBeNull()
 cleanup()
 self.mockResolvedValue({data:{person:null}})
 show()
 await screen.findByText('Não tem tarefas por concluir nas candidaturas acessíveis.')
 expect(screen.queryByRole('heading',{name:'Os objetivos dos meus departamentos'})).toBeNull()
})
