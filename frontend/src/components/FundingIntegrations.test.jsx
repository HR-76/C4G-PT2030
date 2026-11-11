import {afterEach,beforeEach,expect,it,vi} from 'vitest'
import {cleanup,fireEvent,render,screen,waitFor,within} from '@testing-library/react'
const mocks=vi.hoisted(()=>({status:vi.fn(),update:vi.fn(),auth:{user:{id:'admin'}}}))
vi.mock('../api/api',()=>({fundingTendersApi:{status:mocks.status,update:mocks.update}}))
vi.mock('../contexts/AuthContext',()=>({useAuth:()=>mocks.auth}))
import FundingTenders from '../pages/FundingTenders'
const run={runId:'r1',status:'SUCCESS',createdAt:'2026-10-17T12:00:00Z',startedAt:'2026-10-17T12:00:00Z',finishedAt:'2026-10-17T12:00:08Z',received:5,created:2,updated:1,failed:0,unchanged:2,limited:true}
const value={sourceMode:'live-local',lastRun:run,runs:[run],runsLimited:false}
beforeEach(()=>{vi.clearAllMocks();mocks.auth.user={id:'admin'};mocks.status.mockResolvedValue({data:value});mocks.update.mockResolvedValue({data:run})})
afterEach(cleanup)
it('shows canonical review candidates separately without counting them as updates or failures',async()=>{
 const pending={...run,status:'PARTIAL',created:0,updated:0,unchanged:0,failed:0,reviewed:4,knownRefresh:{REVIEW:3,UPDATED:2}}
 mocks.status.mockResolvedValue({data:{...value,lastRun:pending,runs:[pending]}})
 render(<FundingTenders/>);await screen.findByText('4 aguardam revisão')
 expect(screen.getByText('+ 5 conhecidos consultados')).toBeTruthy()
 const row=screen.getByRole('region',{name:'Histórico de sincronizações'}).querySelector('tbody tr')
 expect(row.querySelector('[data-label="Atualizados"]').textContent).toBe('2')
 expect(row.querySelector('[data-label="Falhados"]').textContent).toBe('00 por rever')
})
it('paginates history in groups of ten and clamps the page when refreshed history shrinks',async()=>{
 const runs=Array.from({length:21},(_,index)=>({...run,runId:`page-${index}`,received:1000+index}))
 mocks.status.mockResolvedValue({data:{...value,runs}})
 render(<FundingTenders/>);await screen.findByText('1000')
 const history=within(screen.getByRole('region',{name:'Histórico de sincronizações'}))
 expect(history.getAllByRole('row')).toHaveLength(11)
 expect(history.queryByText('1010')).toBeNull()
 expect(history.getByRole('button',{name:'Anterior'}).disabled).toBe(true)
 fireEvent.click(history.getByRole('button',{name:'Seguinte'}))
 expect(history.getByText('Página 2 de 3')).toBeTruthy()
 expect(history.getByText('1010')).toBeTruthy();expect(history.queryByText('1000')).toBeNull()
 fireEvent.click(history.getByRole('button',{name:'Seguinte'}))
 expect(history.getAllByRole('row')).toHaveLength(2)
 expect(history.getByText('1020')).toBeTruthy()
 expect(history.getByRole('button',{name:'Seguinte'}).disabled).toBe(true)
 fireEvent.click(history.getByRole('button',{name:'Anterior'}))
 expect(history.getByText('Página 2 de 3')).toBeTruthy()
 mocks.status.mockResolvedValue({data:{...value,runs:runs.slice(0,3)}})
 fireEvent.click(screen.getByRole('button',{name:'Consultar estado'}))
 await waitFor(()=>expect(history.getAllByRole('row')).toHaveLength(4))
 expect(history.getByText('1000')).toBeTruthy()
})
it('shows compact source cards with dates and action while retaining status in history',async()=>{
 const cycle={...run,status:'PARTIAL',received:1200,coverage:{pages:48,unique:1198,duplicates:1,excluded:1,invalid:0,remoteTotal:1200},errorCode:'SOURCE_COVERAGE_INCONSISTENT'};
 mocks.status.mockResolvedValue({data:{...value,lastRun:cycle,runs:[cycle],lastCompleteRuns:[],collection:{sources:['EU_FUNDING_TENDERS'],coverage:'durable-v1',limits:{pageSize:25}}}});
 render(<FundingTenders/>);await screen.findByText('1200');
 const card=screen.getByRole('region',{name:'EU Funding & Tenders'}),content=within(card)
 expect(content.getByText('Última execução')).toBeTruthy();expect(content.getByText('Última recolha completa')).toBeTruthy()
 expect(card.querySelectorAll('dt')).toHaveLength(2)
 expect(card.querySelector('details')).toBeNull();expect(content.getByText('Oportunidades abertas e previstas de vários programas europeus.')).toBeTruthy();expect(content.getByText('Disponível')).toBeTruthy() 
 expect(content.queryByText('Cobertura parcial')).toBeNull()
 expect(content.getAllByRole('button')).toHaveLength(1)
 expect(screen.getByText('Cobertura parcial')).toBeTruthy()
});
it('exposes unavailable worker and blocks new collection without hiding history',async()=>{
 mocks.status.mockResolvedValue({data:{...value,worker:{state:'OFFLINE',ready:false,lastHeartbeatAt:'2026-10-26T01:18:58Z'}}});
 render(<FundingTenders/>);await screen.findByText(/Serviço de recolha indisponível/);
 expect(screen.getByRole('button',{name:'Atualizar agora'}).disabled).toBe(true);expect(screen.getByText('8s')).toBeTruthy();
})
it('enables official sources only when the server advertises them and preserves their own history',async()=>{
 mocks.status.mockResolvedValue({data:{...value,collection:{sources:['EU_FUNDING_TENDERS','CORDIS','ERASMUS','INTERREG_EUROPE','POCTEP'],limits:{results:100,pages:4}},runs:[{...run,source:'INTERREG_EUROPE',received:3,created:0,unchanged:0,updated:0,limited:false}]}})
 render(<FundingTenders/>);await screen.findByText('8s')
 expect(screen.getAllByRole('button',{name:'Atualizar agora'})).toHaveLength(5)
 const interreg=within(screen.getByRole('region',{name:'Interreg Europe'})),poctep=within(screen.getByRole('region',{name:'Interreg POCTEP'}))
 expect(screen.getAllByText('Última execução')).toHaveLength(5)
 expect(interreg.queryByText(/Zero chamadas atuais/)).toBeNull();expect(interreg.queryByText(/API real/)).toBeNull()
 expect(interreg.getByText(/Não inclui chamadas restritas/)).toBeTruthy()
 fireEvent.click(poctep.getByRole('button',{name:'Atualizar agora'}));await waitFor(()=>expect(mocks.update).toHaveBeenCalledTimes(1));expect(mocks.update.mock.calls[0][1]).toBe('POCTEP')
})
it('offers three central selections, source-specific history and prevents changing an uncertain intention',async()=>{
 mocks.status.mockResolvedValue({data:{...value,collection:{sources:['EU_FUNDING_TENDERS','CORDIS','ERASMUS'],limits:{results:100,pages:4}},runs:[{...run,source:'CORDIS'}]}})
 mocks.update.mockRejectedValueOnce({response:{status:503}})
 render(<FundingTenders/>);await screen.findByText('8s')
 expect(screen.getAllByRole('button',{name:'Atualizar agora'})).toHaveLength(3)
 expect(screen.getAllByRole('button',{name:'Atualização indisponível'})).toHaveLength(2)
 const cordis=within(screen.getByRole('region',{name:'CORDIS — Horizon Europe'}));fireEvent.click(cordis.getByRole('button',{name:'Atualizar agora'}))
 await cordis.findByRole('button',{name:'Confirmar pedido anterior'})
 expect(mocks.update.mock.calls[0][1]).toBe('CORDIS')
 expect(within(screen.getByRole('region',{name:'Erasmus+'})).getByRole('button',{name:'Atualizar agora'}).disabled).toBe(true)
 fireEvent.click(cordis.getByRole('button',{name:'Confirmar pedido anterior'}));await waitFor(()=>expect(mocks.update).toHaveBeenCalledTimes(2));expect(mocks.update.mock.calls[1]).toEqual(mocks.update.mock.calls[0])
})
it('recovers five source sections and real history without declaring pending sources operational',async()=>{
 render(<FundingTenders/>);await screen.findByText('8s')
 for(const label of ['EU Funding & Tenders','CORDIS — Horizon Europe','Erasmus+','Interreg Europe','Interreg POCTEP'])expect(screen.getByRole('region',{name:label})).toBeTruthy()
 expect(screen.getAllByRole('button',{name:'Atualização indisponível'}).every(button=>button.disabled)).toBe(true)
 const history=screen.getByRole('region',{name:'Histórico de sincronizações'});expect(within(history).getAllByRole('columnheader')).toHaveLength(9);expect(within(history).getByText('8s')).toBeTruthy()
 expect(screen.getByRole('button',{name:'Atualizar agora'}).disabled).toBe(false);expect(mocks.update).not.toHaveBeenCalled();expect(screen.queryByRole('button',{name:'Informação sobre o histórico'})).toBeNull()
})
it('does not enable updates for an unconfigured source or misrepresent fixture records',async()=>{
 mocks.status.mockResolvedValue({data:{...value,sourceMode:'unconfigured'}});const view=render(<FundingTenders/>);await screen.findByText('8s');expect(screen.getByRole('button',{name:'Atualizar agora'}).disabled).toBe(true)
 view.unmount();mocks.status.mockResolvedValue({data:{...value,sourceMode:'fixture'}});render(<FundingTenders/>);await screen.findByText(/Modo de teste: dados sintéticos/);expect(screen.queryByText(/API real/)).toBeNull()
})
it('retains the same intention after an uncertain response and prevents double submission',async()=>{
 mocks.update.mockRejectedValueOnce({response:{status:503}});render(<FundingTenders/>);await screen.findByText('8s')
 const button=screen.getByRole('button',{name:'Atualizar agora'});fireEvent.click(button);fireEvent.click(button);await screen.findByRole('button',{name:'Confirmar pedido anterior'});expect(mocks.update).toHaveBeenCalledTimes(1)
 const key=mocks.update.mock.calls[0][0];fireEvent.click(screen.getByRole('button',{name:'Confirmar pedido anterior'}));await waitFor(()=>expect(mocks.update).toHaveBeenCalledTimes(2));expect(mocks.update.mock.calls[1][0]).toBe(key)
})
it('shows failed refresh and disables updates without replacing known history with an empty success',async()=>{
 render(<FundingTenders/>);await screen.findByText('8s');mocks.status.mockRejectedValue({response:{status:503}});fireEvent.click(screen.getByRole('button',{name:'Consultar estado'}));await screen.findByRole('alert')
 expect(screen.getByText('8s')).toBeTruthy();expect(screen.queryByText('Sem atualizações registadas.')).toBeNull();expect(screen.getByRole('button',{name:'Atualizar agora'}).disabled).toBe(true)
})
it('discards responses belonging to a previous account',async()=>{
 let resolve;mocks.status.mockImplementationOnce(()=>new Promise(r=>{resolve=r}));const view=render(<FundingTenders/>);await waitFor(()=>expect(mocks.status).toHaveBeenCalledTimes(1))
 mocks.auth.user={id:'other'};mocks.status.mockResolvedValue({data:{...value,lastRun:null,runs:[]}});view.rerender(<FundingTenders/>);await screen.findByText('Sem atualizações registadas.')
 resolve({data:value});await waitFor(()=>expect(mocks.status).toHaveBeenCalledTimes(2));expect(screen.queryByText('8s')).toBeNull()
})
