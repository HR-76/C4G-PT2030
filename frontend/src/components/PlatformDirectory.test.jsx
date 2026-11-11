import {afterEach,expect,it,vi} from 'vitest'
import {cleanup,render,screen,fireEvent,waitFor,act} from '@testing-library/react'
import {MemoryRouter,Routes,Route} from 'react-router-dom'
import {DirectoryView} from '../pages/Platform/PlatformDirectory'
vi.mock('../api/api',()=>({platformDirectoryApi:{},admissionApi:{}}))
vi.mock('../pages/Platform/EntityUsers',()=>({default:({organizationName})=><h2>Utilizadores de {organizationName}</h2>}))
afterEach(cleanup)
const entity={id:'a',name:'Entidade A',legalName:'Entidade A',slug:'entidade-a',status:'ACTIVE',activeAccounts:1,administrators:[],typeCode:'COMPANY',currency:'EUR',createdAt:'2026-10-18'}
const user={id:'u',name:'Conta C4G',email:'admin@example.invalid',status:'ACTIVE',platformRoles:['C4G_ADMIN'],memberships:[],membershipCount:0}
const profile={fields:{},revision:0,updatedAt:null,source:'CENTRAL',sourceRevision:0,complete:false}
const response=items=>({data:{items,total:items.length,page:1,pageSize:50}})
const api=()=>({entities:vi.fn().mockResolvedValue(response([entity])),users:vi.fn().mockResolvedValue(response([user])),entity:vi.fn().mockResolvedValue({data:entity}),entityProfile:vi.fn().mockResolvedValue({data:{organization:entity,registration:profile}}),saveEntityProfile:vi.fn().mockResolvedValue({data:profile})})
function mount(client,path='/administracao/entidades'){return render(<MemoryRouter initialEntries={[path]}><Routes><Route path="/administracao/entidades" element={<DirectoryView api={client}/>}/><Route path="/administracao/entidades/utilizadores" element={<DirectoryView api={client}/>}/><Route path="/administracao/entidades/:entityId" element={<DirectoryView api={client}/>}/></Routes></MemoryRouter>)}
it('shows real entity data and opens its member list without selecting the organization',async()=>{
 const client=api();mount(client);await screen.findByText('Entidade A');fireEvent.click(screen.getByRole('link',{name:'Consultar Entidade A'}));await screen.findByRole('heading',{name:'Utilizadores de Entidade A'});
 expect(client.users).toHaveBeenCalledWith({organizationId:'a'},expect.any(AbortSignal));expect(client.entityProfile).toHaveBeenCalledWith('a',expect.any(AbortSignal));expect(screen.getAllByText('Empresa').length).toBeGreaterThan(0);expect(screen.getByText('Por completar')).toBeTruthy();expect(screen.queryByRole('button',{name:'Nova entidade'})).toBeNull();
});
it('shows a platform-only account without inventing an entity membership',async()=>{
 mount(api(),'/administracao/entidades/utilizadores');await screen.findByText('admin@example.invalid');expect(screen.getByText('Administrador C4G')).toBeTruthy();expect(screen.getByText('Sem vínculo a entidades')).toBeTruthy();
});
it('submits bounded filters and clears them with an explicit empty state',async()=>{
 const client=api();mount(client);await screen.findByText('Entidade A');client.entities.mockResolvedValue(response([]));fireEvent.change(screen.getByRole('searchbox'),{target:{value:'Não existe'}});fireEvent.click(screen.getByRole('button',{name:'Aplicar filtros'}));await screen.findByRole('heading',{name:'Sem resultados'});
 expect(client.entities).toHaveBeenLastCalledWith({q:'Não existe'},expect.any(AbortSignal));fireEvent.click(screen.getByRole('button',{name:'Limpar filtros'}));await waitFor(()=>expect(client.entities).toHaveBeenLastCalledWith({},expect.any(AbortSignal)));
});
it('removes stale data when authority is revoked and offers retry',async()=>{
 const client=api();mount(client);await screen.findByText('Entidade A');client.entities.mockRejectedValue({response:{data:{error:{code:'C4G_ADMIN_REQUIRED'}}}});fireEvent.click(screen.getByRole('button',{name:'Atualizar'}));await screen.findByRole('alert');expect(screen.queryByText('Entidade A')).toBeNull();expect(screen.getByRole('button',{name:'Tentar novamente'})).toBeTruthy();
});
it('discards a late entity response after switching to users',async()=>{
 const client=api();let resolve;client.entities.mockReturnValue(new Promise(r=>{resolve=r}));mount(client);fireEvent.click(screen.getByRole('link',{name:'Utilizadores'}));await screen.findByText('Conta C4G');await act(async()=>resolve(response([entity])));expect(screen.queryByText('Entidade A')).toBeNull();
});
it('keeps the current search when moving to the next page',async()=>{
 const client=api();client.users.mockResolvedValue({data:{items:[user],total:51,page:1,pageSize:50}});mount(client,'/administracao/entidades/utilizadores?q=Ana');await screen.findByText('Conta C4G');fireEvent.click(screen.getByRole('button',{name:'Seguinte'}));await waitFor(()=>expect(client.users).toHaveBeenLastCalledWith({q:'Ana',page:'2'},expect.any(AbortSignal)));
});

it('mostra a data de registo no fuso de Lisboa independentemente do navegador',async()=>{
 const client=api();client.entity.mockResolvedValue({data:{...entity,createdAt:'2026-06-01T23:30:00.000Z'}});mount(client,'/administracao/entidades/a');await screen.findByText('02/06/2026')
})
