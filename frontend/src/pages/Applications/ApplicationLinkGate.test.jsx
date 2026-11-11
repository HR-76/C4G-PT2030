import {useEffect} from 'react'
import {render,screen,fireEvent,waitFor,cleanup} from '@testing-library/react'
import {MemoryRouter,Routes,Route} from 'react-router-dom'
import {beforeEach,afterEach,it,expect,vi} from 'vitest'
const auth=vi.hoisted(()=>({user:{id:'user'},organization:null,loading:false,selectOrganization:vi.fn()}))
const api=vi.hoisted(()=>({organizations:vi.fn()}))
vi.mock('../../contexts/AuthContext',()=>({useAuth:()=>auth}))
vi.mock('../../api/api',()=>({authApi:api}))
import Gate from './ApplicationLinkGate'
const org='00000000-0000-4000-8000-000000000001',app='00000000-0000-4000-8000-000000000002',loaded=vi.fn()
function Detail(){useEffect(()=>{loaded()},[]);return <p>Private detail</p>}
function Tree({query=`organizacao=${org}`}){return <MemoryRouter initialEntries={[`/candidaturas/${app}?${query}`]}><Routes><Route path="/candidaturas/:id" element={<Gate><Detail/></Gate>}/></Routes></MemoryRouter>}
beforeEach(()=>{vi.clearAllMocks();auth.user={id:'user'};auth.organization=null;api.organizations.mockResolvedValue({data:{organizations:[{id:org,displayName:'Cliente'}]}});auth.selectOrganization.mockResolvedValue(undefined)})
afterEach(cleanup)
it('same context mounts detail directly',()=>{auth.organization={id:org};render(<Tree/>);expect(loaded).toHaveBeenCalledTimes(1);expect(api.organizations).not.toHaveBeenCalled()})
it('confirmation waits for authoritative context, not just POST resolution',async()=>{const v=render(<Tree/>);fireEvent.click(await screen.findByRole('button',{name:'Confirmar organização'}));await waitFor(()=>expect(auth.selectOrganization).toHaveBeenCalledWith(org));expect(loaded).not.toHaveBeenCalled();auth.organization={id:org};v.rerender(<Tree/>);expect(loaded).toHaveBeenCalledTimes(1)})
it('unavailable organization is generic and cannot load detail',async()=>{api.organizations.mockResolvedValue({data:{organizations:[]}});render(<Tree/>);await screen.findByText('Link indisponível');expect(loaded).not.toHaveBeenCalled();expect(auth.selectOrganization).not.toHaveBeenCalled()})
it.each(['organizacao=//evil.invalid',`organizacao=${org}&organizacao=${org}`,'organizacao='])('invalid context rejected %s',query=>{render(<Tree query={query}/>);expect(screen.getByText('Link indisponível')).toBeTruthy();expect(loaded).not.toHaveBeenCalled();expect(api.organizations).not.toHaveBeenCalled()})
it('403 selecting context never mounts private content',async()=>{auth.selectOrganization.mockRejectedValue(Error('403'));render(<Tree/>);fireEvent.click(await screen.findByRole('button',{name:'Confirmar organização'}));await screen.findByRole('alert');expect(loaded).not.toHaveBeenCalled()})
it('old user list response is discarded',async()=>{let complete;api.organizations.mockImplementationOnce(()=>new Promise(r=>{complete=r})).mockResolvedValue({data:{organizations:[]}});const v=render(<Tree/>);auth.user={id:'other'};v.rerender(<Tree/>);await screen.findByText('Link indisponível');complete({data:{organizations:[{id:org,displayName:'Old secret'}]}});await Promise.resolve();expect(screen.queryByText('Old secret')).toBeNull();expect(loaded).not.toHaveBeenCalled()})
it('ordinary application navigation is preserved',()=>{render(<Tree query=""/>);expect(loaded).toHaveBeenCalledTimes(1)})
it('double click cannot send another selection',async()=>{auth.selectOrganization.mockImplementation(()=>new Promise(()=>{}));render(<Tree/>);const b=await screen.findByRole('button',{name:'Confirmar organização'});fireEvent.click(b);fireEvent.click(b);expect(auth.selectOrganization).toHaveBeenCalledTimes(1)})
