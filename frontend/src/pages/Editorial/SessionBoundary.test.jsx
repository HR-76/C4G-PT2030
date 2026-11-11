import React from 'react'
import { it, expect, vi, afterEach } from 'vitest'
import { render, screen, act, cleanup, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
const api = vi.hoisted(() => ({ me: vi.fn(), selectOrganization: vi.fn(), logout: vi.fn() }))
const applications = vi.hoisted(() => ({responsibles:vi.fn(),create:vi.fn(),list:vi.fn(),get:vi.fn(),history:vi.fn()}))
const opportunityApi = vi.hoisted(() => ({get:vi.fn()}))
vi.mock('../../api/api', () => ({ authApi: api, clearCsrfToken: vi.fn(), privateApplicationsApi:applications,
  privateOpportunitiesApi:opportunityApi,opportunityInterestsApi:{units:()=>Promise.resolve({data:{items:[]}})},pq1Api:{session:work=>work()} }))
import { AuthProvider, useAuth } from '../../contexts/AuthContext'
import PrivateApplications from '../Applications/PrivateApplications'
import {applicationIntentKey} from '../Applications/intentions'
let current
function Probe() { current = useAuth(); return <p>{current.organization?.name || 'none'}</p> }
function ApplicationPage(){const auth=useAuth();return <PrivateApplications key={`${auth.user?.id}:${auth.organization?.id}`}/>}
afterEach(() => { cleanup(); vi.resetAllMocks(); sessionStorage.clear() })
it('late session refresh cannot restore A after a completed selection of B', async () => {
  const session = name => ({ data: { user: { id: 'human' }, organization: { id: name, name } } })
  api.me.mockResolvedValueOnce(session('A'))
  render(<AuthProvider><Probe /></AuthProvider>); await screen.findByText('A')
  let resolveOld
  api.me.mockImplementationOnce(() => new Promise(resolve => { resolveOld = resolve })).mockResolvedValueOnce(session('B'))
  api.selectOrganization.mockResolvedValue(session('B'))
  const old = current.refreshSession({ timeout: 10000 }); old.catch(() => {})
  await act(() => current.selectOrganization('B'))
  await screen.findByText('B')
  await act(async () => { resolveOld(session('A')); await expect(old).rejects.toThrow() })
  expect(screen.queryByText('A')).toBeNull(); expect(screen.getByText('B')).toBeTruthy()
})
it('a confirmed organization POST applies its session without a dependent GET', async () => {
  api.me.mockResolvedValueOnce({data:{user:{id:'human'},organization:{id:'A',name:'A'}}}).mockRejectedValue(new Error('GET unavailable'))
  render(<AuthProvider><Probe /></AuthProvider>); await screen.findByText('A')
  api.selectOrganization.mockResolvedValue({data:{user:{id:'human'},organization:{id:'B',name:'B'},csrfToken:'rotated'}})
  await act(() => current.selectOrganization('B'))
  expect(screen.getByText('B')).toBeTruthy(); expect(api.me).toHaveBeenCalledOnce()
})
it('failed logout invalidates an in-flight session refresh and preserves application envelopes', async () => {
  api.me.mockResolvedValueOnce({ data: { user: { id: 'human' }, organization: { id: 'A', name: 'A' } } })
  render(<AuthProvider><Probe /></AuthProvider>); await screen.findByText('A')
  let resolveOld
  api.me.mockImplementationOnce(() => new Promise(resolve => { resolveOld = resolve }))
  const old = current.refreshSession(); old.catch(() => {})
  sessionStorage.setItem('c4g.editorial.intention.v1:synthetic', '{}')
  sessionStorage.setItem('c4g.application.intention.v1:human:A', '{}')
  sessionStorage.setItem('c4g.application.work.intention.v1:human:A', '{}')
  sessionStorage.setItem('application-intention:A', '{}')
  for(const kind of ['work','partners','documents'])sessionStorage.setItem(`c4g.application.${kind}.intention.v1:human:A:app`,'{}')
  sessionStorage.setItem('c4g.application.documents.intention.v1:human:A:app:upload','{}')
  api.logout.mockRejectedValue(new Error('local network failure'))
  await expect(current.logout()).rejects.toThrow('local network failure')
  expect(sessionStorage.getItem('c4g.editorial.intention.v1:synthetic')).toBeNull()
  expect(sessionStorage.getItem('c4g.application.intention.v1:human:A')).toBe('{}')
  expect(sessionStorage.getItem('c4g.application.work.intention.v1:human:A')).toBe('{}')
  expect(sessionStorage.getItem('application-intention:A')).toBe('{}')
  for(const kind of ['work','partners','documents']) expect(sessionStorage.getItem(`c4g.application.${kind}.intention.v1:human:A:app`)).toBe('{}')
  expect(sessionStorage.getItem('c4g.application.documents.intention.v1:human:A:app:upload')).toBe('{}')
  await act(async () => { resolveOld({ data: { user: { id: 'other' }, organization: { id: 'B', name: 'B' } } }); await expect(old).rejects.toThrow() })
  expect(screen.queryByText('B')).toBeNull()
})
it('503, logout and another user in the same organization cannot repeat the first user’s application',async()=>{
 const userA='00000000-0000-4000-8000-000000000004',userB='00000000-0000-4000-8000-000000000005'
 const org='00000000-0000-4000-8000-000000000001',opportunity='00000000-0000-4000-8000-000000000002'
 const session=user=>({data:{user:{id:user},organization:{id:org,name:'Organização'}}})
 api.me.mockResolvedValueOnce(session(userA)).mockResolvedValueOnce(session(userB))
 api.logout.mockResolvedValue({data:{redirectUrl:'/login'}})
 opportunityApi.get.mockResolvedValue({data:{title:'Oportunidade'}})
 applications.responsibles.mockResolvedValue({data:{items:[{membershipId:userA,name:'Responsável'}],nextCursor:null}})
 applications.create.mockRejectedValue({response:{status:503}})
 render(<AuthProvider><MemoryRouter initialEntries={[`/candidaturas?nova=1&oportunidade=${opportunity}`]}><Probe/><Routes><Route path="/candidaturas" element={<ApplicationPage/>}/></Routes></MemoryRouter></AuthProvider>)
 await screen.findByRole('option',{name:'Responsável'})
 fireEvent.change(screen.getByLabelText('Título'),{target:{value:'Envio incerto de A'}})
 fireEvent.change(screen.getByLabelText('Responsável da organização'),{target:{value:userA}})
 fireEvent.change(screen.getByLabelText('Prazo interno'),{target:{value:'2026-12-31'}})
 fireEvent.click(screen.getByRole('button',{name:'Criar candidatura'}))
 await screen.findByRole('button',{name:'Repetir o mesmo envio'})
 expect(applications.create).toHaveBeenCalledTimes(1)
 expect(sessionStorage.getItem(applicationIntentKey(userA,org))).toBeTruthy()
 await act(async()=>current.logout())
 expect(sessionStorage.getItem(applicationIntentKey(userA,org))).toBeNull()
 await act(async()=>current.refreshSession())
 await waitFor(()=>expect(screen.queryByRole('button',{name:'Repetir o mesmo envio'})).toBeNull())
 expect(applications.create).toHaveBeenCalledTimes(1)
})

it('recupera a candidatura incerta com a mesma chave depois de falhar o logout',async()=>{
 const user='00000000-0000-4000-8000-000000000004',org='00000000-0000-4000-8000-000000000001',opportunity='00000000-0000-4000-8000-000000000002'
 api.me.mockResolvedValue({data:{user:{id:user},organization:{id:org,name:'Organização'}}});api.logout.mockRejectedValue(new Error('rede indisponível'))
 opportunityApi.get.mockResolvedValue({data:{title:'Oportunidade'}});applications.responsibles.mockResolvedValue({data:{items:[{membershipId:user,name:'Responsável'}],nextCursor:null}})
 applications.create.mockRejectedValueOnce({response:{status:503}}).mockResolvedValueOnce({data:{applicationId:'00000000-0000-4000-8000-000000000010'}})
 render(<AuthProvider><MemoryRouter initialEntries={[`/candidaturas?nova=1&oportunidade=${opportunity}`]}><Probe/><Routes><Route path="/candidaturas" element={<ApplicationPage/>}/></Routes></MemoryRouter></AuthProvider>)
 await screen.findByRole('option',{name:'Responsável'});fireEvent.change(screen.getByLabelText('Título'),{target:{value:'Envio incerto'}});fireEvent.change(screen.getByLabelText('Responsável da organização'),{target:{value:user}});fireEvent.change(screen.getByLabelText('Prazo interno'),{target:{value:'2026-12-31'}});fireEvent.click(screen.getByRole('button',{name:'Criar candidatura'}))
 await screen.findByRole('button',{name:'Repetir o mesmo envio'});const saved=JSON.parse(sessionStorage.getItem(applicationIntentKey(user,org)));expect(saved.idempotencyKey).toBeTruthy()
 await act(async()=>{await expect(current.logout()).rejects.toThrow('rede indisponível')});expect(JSON.parse(sessionStorage.getItem(applicationIntentKey(user,org))).idempotencyKey).toBe(saved.idempotencyKey)
 fireEvent.click(await screen.findByRole('button',{name:'Repetir o mesmo envio'}));await waitFor(()=>expect(applications.create).toHaveBeenCalledTimes(2));expect(applications.create.mock.calls[1][0].idempotencyKey).toBe(saved.idempotencyKey)
})

it('limpa intenções de candidatura quando a saída local termina mesmo com logout incompleto',async()=>{
 api.me.mockResolvedValue({data:{user:{id:'human'},organization:{id:'A',name:'A'}}});api.logout.mockRejectedValue({response:{status:503,data:{code:'LOGOUT_INCOMPLETE',redirectUrl:'/login?logout=incomplete'}}})
 render(<AuthProvider><Probe/></AuthProvider>);await screen.findByText('A');sessionStorage.setItem(applicationIntentKey('human','A'),'pendente')
 await act(async()=>current.logout());expect(sessionStorage.getItem(applicationIntentKey('human','A'))).toBeNull();expect(current.user).toBeNull()
})
