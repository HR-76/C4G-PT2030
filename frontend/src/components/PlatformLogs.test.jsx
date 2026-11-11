import {afterEach,expect,it,vi} from 'vitest'
import {cleanup,render,screen,fireEvent,waitFor} from '@testing-library/react'
import {LogsView} from '../pages/Platform/PlatformLogs'
vi.mock('../api/api',()=>({platformDirectoryApi:{}}))
afterEach(cleanup)
const entry={id:'a',name:'Ana',email:'ana@example.invalid',occurredAt:'2026-10-18T10:00:00Z',type:'LOGIN',description:'Entrada na plataforma'}
const result=(items=[entry])=>({data:{items,total:items.length,page:1,pageSize:15,activatedAt:'2026-10-18T09:00:00Z',collection:{failedEvents:0}}})
it('shows identity and keeps collection limits in an accessible information tooltip',async()=>{
 const api={logs:vi.fn().mockResolvedValue(result())};render(<LogsView api={api}/>);await screen.findByText('Ana');expect(screen.getByText('ana@example.invalid')).toBeTruthy();expect(screen.getByText(/11:00:00/)).toBeTruthy();expect(screen.queryByText('Entradas na plataforma e erros da aplicação.')).toBeNull();const info=screen.getByRole('button',{name:'Informação sobre os logs'}),tooltip=document.getElementById(info.getAttribute('aria-describedby'));expect(tooltip?.getAttribute('role')).toBe('tooltip');expect(tooltip?.textContent).toContain('Registos desde 18/10/26, 10:00:00');expect(tooltip?.textContent).toContain('Não inclui erros do serviço de autenticação');
})
it('filters, clears and refreshes without leaving stale data after denial',async()=>{
 const api={logs:vi.fn().mockResolvedValue(result())};render(<LogsView api={api}/>);await screen.findByText('Ana');fireEvent.change(screen.getByRole('searchbox'),{target:{value:'Ana'}});fireEvent.change(screen.getByLabelText('Tipo'),{target:{value:'ERROR'}});fireEvent.click(screen.getByRole('button',{name:'Aplicar filtros'}));await waitFor(()=>expect(api.logs).toHaveBeenLastCalledWith({q:'Ana',type:'ERROR',page:'1'},expect.any(AbortSignal)));
 await screen.findByText('Ana');api.logs.mockRejectedValue({response:{status:403}});fireEvent.click(screen.getByRole('button',{name:'Atualizar'}));await screen.findByRole('alert');expect(screen.queryByText('ana@example.invalid')).toBeNull();
})
it('shows empty result and warns when collection has gaps',async()=>{
 const response=result([]);response.data.collection.failedEvents=1;render(<LogsView api={{logs:vi.fn().mockResolvedValue(response)}}/>);await screen.findByRole('heading',{name:'Sem registos'});expect(screen.getByRole('alert').textContent).toContain('Podem faltar registos');
})
it('shows unknown identity and retains filter when paging',async()=>{
 const response=result([{...entry,name:null,email:null,type:'ERROR',description:'Erro',httpStatus:503}]);response.data.total=16;const api={logs:vi.fn().mockResolvedValue(response)};render(<LogsView api={api}/>);await screen.findByText('Não identificado');expect(screen.getByText('HTTP 503')).toBeTruthy();expect(screen.getByText('Página 1 de 2')).toBeTruthy();fireEvent.click(screen.getByRole('button',{name:'Seguinte'}));await waitFor(()=>expect(api.logs).toHaveBeenLastCalledWith({page:'2'},expect.any(AbortSignal)));
})
