import {afterEach,beforeEach,expect,it,vi} from 'vitest'
import {act,cleanup,fireEvent,render,screen} from '@testing-library/react'
import {MemoryRouter} from 'react-router-dom'
vi.mock('../api/api',()=>({organizationNotificationsApi:{refreshList:vi.fn(),noticeContext:vi.fn(),list:vi.fn(),refresh:vi.fn(),markRead:vi.fn(),markAllRead:vi.fn()}}))
let session
vi.mock('../contexts/AuthContext',()=>({useAuth:()=>session}))
vi.mock('../components/ToastProvider',()=>({useToast:()=>({success:vi.fn(),error:vi.fn()})}))
import Notifications from './Notifications'
import {AlertBell} from '../components/Layout/Header'
import {organizationNotificationsApi as api} from '../api/api'
const row={id:'alert-a',type:'APPLICATION_STATUS_CHANGED',title:'Candidatura em preparação',message:'Mensagem privada A',related_application_id:'application-a',application_title:'Candidatura A',created_at:'2026-10-18T09:00:00Z',is_read:false}
const deferred=()=>{let resolve,reject;const promise=new Promise((r,j)=>{resolve=r;reject=j});return{promise,resolve,reject}}
const ui=(url='/notificacoes')=><MemoryRouter initialEntries={[url]}><Notifications/></MemoryRouter>
beforeEach(()=>{vi.resetAllMocks();session={user:{id:'a'},organization:{id:'org-a'}};api.noticeContext.mockResolvedValue({data:{canManage:false,recipients:[]}});api.refreshList.mockResolvedValue({data:{notifications:[row],unread_count:6,total:6}});api.list.mockResolvedValue({data:{notifications:[row],unread_count:6,total:6}});api.markRead.mockResolvedValue({data:{success:true}});api.markAllRead.mockResolvedValue({data:{success:true}})})
afterEach(cleanup)
it('keeps stored alerts available when deadline refresh fails transiently and retries the refresh',async()=>{
 api.refreshList.mockRejectedValueOnce({response:{status:503}});render(ui());await screen.findByText(row.message)
 expect(screen.queryByText('Acompanhe os prazos, as alterações nas candidaturas e os avisos da sua entidade.')).toBeNull()
 fireEvent.click(screen.getByRole('button',{name:'Atualizar prazos novamente'}));await act(async()=>{})
 expect(api.refreshList).toHaveBeenCalledTimes(2);expect(screen.queryByText(/A atualização de prazos não foi concluída/)).toBeNull()
})
it('does not continue to read after refresh denies access',async()=>{
 api.refreshList.mockRejectedValue({response:{status:403}});render(ui());await screen.findByRole('alert');expect(api.list).not.toHaveBeenCalled()
})
it('can count stored unread alerts after a network failure in deadline refresh',async()=>{
 api.refreshList.mockRejectedValue(new Error('offline'));render(<MemoryRouter><AlertBell modern organizationId="org-a"/></MemoryRouter>)
 await screen.findByRole('link',{name:'Alertas · 6 não lidos'})
})
it('keeps the communication heading concise',async()=>{session.organization.displayName='C4G';api.noticeContext.mockResolvedValue({data:{canManage:true,recipients:[]}});render(ui());fireEvent.click(screen.getByRole('tab',{name:'Comunicação'}));await screen.findByRole('heading',{name:'Comunicação da organização'});expect(screen.queryByText(/Avisos internos para os membros/)).toBeNull();expect(screen.queryByText('org-a')).toBeNull()})
it('requires an associated entity before any request',()=>{session.organization=null;render(ui());expect(screen.getByRole('status').textContent).toContain('não tem uma entidade associada');expect(api.list).not.toHaveBeenCalled();expect(api.refreshList).not.toHaveBeenCalled()})
it('shows errors with retry instead of empty inbox',async()=>{api.refreshList.mockRejectedValueOnce(new Error('offline'));api.list.mockRejectedValueOnce(new Error('offline'));render(ui());await screen.findByRole('alert');expect(screen.queryByText(/Nenhuma notificação/)).toBeNull();fireEvent.click(screen.getByRole('button',{name:'Tentar novamente'}));await screen.findByText(row.message)})
it('links to application and removes read rows from unread selection',async()=>{render(ui('/notificacoes?unread=1'));await screen.findByText(row.message);expect(screen.getByRole('link',{name:'Candidatura A'}).getAttribute('href')).toBe('/candidaturas/application-a');fireEvent.click(screen.getByTitle('Marcar como lida'));await screen.findByText(/Nenhuma notificação/);expect(api.markRead).toHaveBeenCalledWith('alert-a','org-a')})
it('keeps failed acknowledgments visible for retry',async()=>{api.markRead.mockRejectedValueOnce(new Error('offline'));render(ui());await screen.findByText(row.message);fireEvent.click(screen.getByTitle('Marcar como lida'));await screen.findByRole('alert');expect(screen.getByText(row.message)).toBeTruthy();fireEvent.click(screen.getByTitle('Marcar como lida'));await act(async()=>{});expect(api.markRead).toHaveBeenCalledTimes(2)})
it('blocks duplicate read-all actions',async()=>{const pending=deferred();api.markAllRead.mockReturnValue(pending.promise);render(ui());const button=await screen.findByRole('button',{name:'Marcar todas como lidas'});fireEvent.click(button);fireEvent.click(button);expect(api.markAllRead).toHaveBeenCalledTimes(1);await act(async()=>pending.resolve({data:{success:true}}));expect(screen.queryByRole('button',{name:'Marcar todas como lidas'})).toBeNull()})
it('discards late reads from previous organization',async()=>{const pending=deferred();api.refreshList.mockReturnValueOnce(pending.promise);const view=render(ui());await act(async()=>{});session={...session,organization:{id:'org-b'}};api.refreshList.mockResolvedValue({data:{notifications:[],unread_count:0,total:0}});view.rerender(ui());await screen.findByText(/Nenhuma notificação/);await act(async()=>pending.resolve({data:{notifications:[row]}}));expect(screen.queryByText(row.message)).toBeNull()})
it('does not chain refresh into new session',async()=>{const pending=deferred();api.refreshList.mockReturnValueOnce(pending.promise);const view=render(ui());session={...session,user:{id:'b'},organization:null};view.rerender(ui());await act(async()=>pending.resolve({data:{success:true}}));expect(api.list).not.toHaveBeenCalled()})
it('filters deadlines and team using organization alert codes',async()=>{api.refreshList.mockResolvedValue({data:{notifications:[row,{...row,id:'team',type:'APPLICATION_TEAM_ADDED',message:'Equipa A'},{...row,id:'deadline',type:'DEADLINE_7_DAYS',message:'Prazo A'}]}});render(ui());fireEvent.click(await screen.findByRole('button',{name:'Prazo · 7 dias (1)'}));expect(screen.getByText('Prazo A')).toBeTruthy();expect(screen.queryByText('Equipa A')).toBeNull();fireEvent.click(screen.getByRole('button',{name:'Equipa (1)'}));expect(screen.getByText('Equipa A')).toBeTruthy();expect(screen.queryByText('Prazo A')).toBeNull()})
it('uses server unread count even for one item page',async()=>{render(<MemoryRouter><AlertBell modern organizationId="org-a"/></MemoryRouter>);await screen.findByRole('link',{name:'Alertas · 6 não lidos'});expect(api.refreshList).toHaveBeenCalledWith({unread:true,limit:1},'org-a')})
it('never presents failed count as zero',async()=>{api.refreshList.mockRejectedValue(new Error('offline'));api.list.mockRejectedValue(new Error('offline'));render(<MemoryRouter><AlertBell modern organizationId="org-a"/></MemoryRouter>);await act(async()=>{});expect(screen.getByRole('link',{name:'Alertas'})).toBeTruthy();expect(screen.queryByText('0')).toBeNull()})
it('aborts superseded and unmounted bell reads while leaving refresh writes unchanged',async()=>{
 api.refreshList.mockRejectedValueOnce(new Error('offline'))
 const first=deferred(),second=deferred();api.list.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)
 const view=render(<MemoryRouter><AlertBell organizationId="org-a"/></MemoryRouter>);await act(async()=>{})
 const signal=api.list.mock.calls[0][2];expect(signal).toBeInstanceOf(AbortSignal);expect(signal.aborted).toBe(false)
 fireEvent.focus(window);await act(async()=>{})
 expect(signal.aborted).toBe(true);expect(api.list.mock.calls[1][2].aborted).toBe(false)
 await act(async()=>first.resolve({data:{unread_count:99}}));expect(screen.queryByText('99')).toBeNull()
 view.unmount();expect(api.list.mock.calls[1][2].aborted).toBe(true)
 expect(api.refreshList.mock.calls).toEqual([[{unread:true,limit:1},'org-a']])
})
it('does not chain a bell refresh into a read after unmount',async()=>{
 const pending=deferred();api.refreshList.mockReturnValue(pending.promise)
 const view=render(<MemoryRouter><AlertBell organizationId="org-a"/></MemoryRouter>);view.unmount()
 await act(async()=>pending.resolve({data:{success:true}}));expect(api.list).not.toHaveBeenCalled();expect(api.refreshList.mock.calls).toEqual([[{unread:true,limit:1},'org-a']])
})
it('opens an explicitly linked candidature from a general notice and leaves external destinations as text',async()=>{
 const path='/candidaturas/f6ac3476-d391-43f8-acd7-e3732764f3e1'
 const notice={...row,type:'BROADCAST',related_application_id:null,title:'Aviso interno'}
 api.refreshList.mockResolvedValue({data:{notifications:[{...notice,message:'Consultar a ficha.\n[Formação Avançada]('+path+')'},{...notice,id:'other',message:'[Outro](https://example.org)'}]}})
 render(ui())
 expect((await screen.findByRole('link',{name:'Formação Avançada'})).getAttribute('href')).toBe(path)
 expect(screen.queryByRole('link',{name:'Outro'})).toBeNull()
})

it('opens the bell with one combined request and no separate generation or list',async()=>{
 api.refreshList.mockResolvedValue({data:{notifications:[],unread_count:3,total:3}})
 render(<MemoryRouter><AlertBell organizationId="org-a"/></MemoryRouter>)
 await screen.findByRole('link',{name:'Alertas · 3 não lidos'})
 expect(api.refreshList).toHaveBeenCalledWith({unread:true,limit:1},'org-a')
 expect(api.refresh).not.toHaveBeenCalled();expect(api.list).not.toHaveBeenCalled()
})

import { notificationGroups } from './notificationGroups'
it('groups using Lisbon civil days across the autumn DST change and sorts newest first',()=>{
 const now=new Date('2026-10-26T00:30:00Z')
 const rows=[{id:'old',created_at:'2026-10-23T12:00:00Z'},{id:'yesterday',created_at:'2026-10-24T23:30:00Z'},{id:'today1',created_at:'2026-10-26T00:01:00Z'},{id:'today2',created_at:'2026-10-26T00:10:00Z'}]
 expect(notificationGroups(rows,now).map(g=>[g.label,g.rows.map(r=>r.id)])).toEqual([['Hoje',['today2','today1']],['Ontem',['yesterday']],['Anteriores',['old']]])
})
it('does not mislabel invalid or future dates as older notifications',()=>{
 const groups=notificationGroups([{created_at:'invalid'},{created_at:'2027-01-01T00:00:00Z'}],new Date('2026-11-11T12:00:00Z'))
 expect(groups.map(g=>g.label)).toEqual(['Outras datas'])
})
