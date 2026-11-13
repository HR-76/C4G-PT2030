import {afterEach,expect,it,vi} from 'vitest'
import {act,cleanup,fireEvent,render,screen,waitFor,within} from '@testing-library/react'
import {StrictMode} from 'react'
import {MemoryRouter} from 'react-router-dom'
import {MatchingTable} from './MatchingWorkspace'
afterEach(cleanup)
it('renders compact v2 suggestions with planned precision and explicit state rather than claiming they are open',async()=>{
 const api={matching:vi.fn(async()=>({data:{state:'READY',items:[{opportunityId:'plan',origin:'CENTRAL',href:'/catalogo/plan',title:'Education plan',programmeName:'Programme A · Programme B',sourceVersion:2,deadline:{precision:'DATE',value:'2027-04-30'},deadlineKind:'PLANNED',temporalState:'PLANNED',matchedAreas:[]}]}})),people:vi.fn(async()=>({data:{items:[]}}))}
 render(<MemoryRouter><MatchingTable organizationId="org" api={api}/></MemoryRouter>)
 await screen.findByRole('link',{name:'Education plan'})
 expect(screen.getByText('Planeada')).toBeTruthy();expect(screen.getByText(/Prazo previsto:/)).toBeTruthy()
 expect(screen.queryByText('Ativa no catálogo')).toBeNull();expect(screen.getByText(/Programme A · Programme B/)).toBeTruthy();expect(screen.getByText('30/04/2027 · hora não indicada')).toBeTruthy()
})
const ready=title=>({data:{state:'READY',items:[{opportunityId:'one',origin:'CENTRAL',href:'/catalogo/one',title,matchedAreas:[]}]}})
it('cancels superseded matching requests and the directory pagination on unmount',async()=>{
 let finishFirst,finishPeople
 const api={matching:vi.fn().mockImplementationOnce(()=>new Promise(resolve=>{finishFirst=resolve})).mockResolvedValue(ready('Resultado atual')),
  people:vi.fn().mockResolvedValueOnce({data:{items:[{personId:'pessoa-a',name:'Pessoa A'}],nextCursor:'page-2'}}).mockImplementationOnce(()=>new Promise(resolve=>{finishPeople=resolve}))}
 const view=render(<MemoryRouter><MatchingTable organizationId="org" api={api}/></MemoryRouter>)
 await waitFor(()=>expect(api.people).toHaveBeenCalledTimes(2))
 const matchingSignal=api.matching.mock.calls[0][1],peopleSignal=api.people.mock.calls[0][1]
 expect(matchingSignal).toBeInstanceOf(AbortSignal);expect(peopleSignal).toBeInstanceOf(AbortSignal)
 expect(api.people.mock.calls[1][1]).toBe(peopleSignal)
 await act(async()=>finishPeople({data:{items:[],nextCursor:null}}))
 fireEvent.change(screen.getByRole('combobox',{name:'Pessoa'}),{target:{value:'pessoa-a'}})
 await screen.findByRole('link',{name:'Resultado atual'})
 expect(matchingSignal.aborted).toBe(true)
 await act(async()=>finishFirst(ready('Resultado antigo')));expect(screen.queryByRole('link',{name:'Resultado antigo'})).toBeNull()
 view.unmount();expect(api.matching.mock.calls[1][1].aborted).toBe(true);expect(peopleSignal.aborted).toBe(true)
})
it('aborts an in-flight selector page without requesting subsequent pages',async()=>{
 let finishPeople;const api={matching:vi.fn(async()=>ready('Resultado')),people:vi.fn(()=>new Promise(resolve=>{finishPeople=resolve}))}
 const view=render(<MemoryRouter><MatchingTable organizationId="org" api={api}/></MemoryRouter>)
 await waitFor(()=>expect(api.people).toHaveBeenCalledTimes(1));const signal=api.people.mock.calls[0][1]
 expect(signal).toBeInstanceOf(AbortSignal);view.unmount();expect(signal.aborted).toBe(true)
 await act(async()=>finishPeople({data:{items:[],nextCursor:'next'}}));expect(api.people).toHaveBeenCalledTimes(1)
})
it('starts one organization matching request before one people request under StrictMode',async()=>{
 const calls=[],api={matching:vi.fn(async()=>{calls.push('matching');return ready('Resultado')}),people:vi.fn(async()=>{calls.push('people');return {data:{items:[]}}})}
 render(<StrictMode><MemoryRouter><MatchingTable organizationId="org" api={api}/></MemoryRouter></StrictMode>)
 await screen.findByRole('link',{name:'Resultado'});expect(calls).toEqual(['matching','people'])
})
it('does not issue requests for an effect unmounted before it starts',async()=>{
 const api={matching:vi.fn(async()=>ready('Resultado')),people:vi.fn(async()=>({data:{items:[]}}))};const view=render(<MemoryRouter><MatchingTable organizationId="org" api={api}/></MemoryRouter>)
 view.unmount();await act(async()=>{});expect(api.matching).not.toHaveBeenCalled();expect(api.people).not.toHaveBeenCalled()
})
it('does not load the unused person selector in opportunity mode',async()=>{
 const api={matching:vi.fn(async()=>({data:{state:'READY',items:[]}})),people:vi.fn()}
 render(<MemoryRouter initialEntries={['/matching?oportunidade=opp&origem=CENTRAL']}><MatchingTable organizationId="org" api={api}/></MemoryRouter>)
 await screen.findByText('Sem correspondências');expect(api.matching).toHaveBeenCalledWith({opportunityId:'opp',origin:'CENTRAL'},expect.any(AbortSignal));expect(api.people).not.toHaveBeenCalled()
})
it('discards an old organization response and does not reuse it for the new organization',async()=>{
 let resolve;const old={matching:vi.fn(()=>new Promise(r=>{resolve=r})),people:async()=>({data:{items:[]}})},next={matching:vi.fn(async()=>ready('Entidade B')),people:async()=>({data:{items:[]}})}
 const view=render(<MemoryRouter><MatchingTable key="a" organizationId="a" api={old}/></MemoryRouter>);await waitFor(()=>expect(old.matching).toHaveBeenCalledTimes(1))
 view.rerender(<MemoryRouter><MatchingTable key="b" organizationId="b" api={next}/></MemoryRouter>);await screen.findByRole('link',{name:'Entidade B'})
 await act(async()=>resolve(ready('Entidade A')));expect(screen.queryByText('Entidade A')).toBeNull();expect(next.matching).toHaveBeenCalledTimes(1)
})
it('retries a failed request without caching the error',async()=>{
 const api={matching:vi.fn().mockRejectedValueOnce(Error('denied')).mockResolvedValueOnce(ready('Recuperado')),people:async()=>({data:{items:[]}})}
 render(<MemoryRouter><MatchingTable organizationId="org" api={api}/></MemoryRouter>);await screen.findByRole('alert');fireEvent.click(screen.getByRole('button',{name:'Tentar novamente'}))
 await screen.findByRole('link',{name:'Recuperado'});expect(api.matching).toHaveBeenCalledTimes(2)
})
const mount=result=>render(<MemoryRouter><MatchingTable organizationId="org" api={{people:async()=>({data:{items:[]}}),matching:()=>result}}/></MemoryRouter>)
it('shows a source failure as an error, never as no matches',async()=>{mount(Promise.reject(Error('source failed')));await screen.findByRole('alert');expect(screen.queryByText('Sem correspondências')).toBeNull()})
it('explains the matching capacity limit without suggesting a retry or showing partial results',async()=>{
 mount(Promise.reject({response:{status:409,data:{error:{code:'LIMIT_EXCEEDED'}}}}))
 const alert=await screen.findByRole('alert');expect(alert.textContent).toMatch(/excede a capacidade atual/i);expect(alert.textContent).toMatch(/não foram apresentados resultados/i)
 expect(screen.queryByRole('button',{name:'Tentar novamente'})).toBeNull();expect(screen.queryByText('Sem correspondências')).toBeNull()
})
const matchedAreas = [
 {id:'education',name:'Educação',keywords:['training']},
 {id:'climate',name:'Clima',keywords:['adaptation']},
]

it('shows all common areas before opening one grouped explanation',async()=>{
 mount(Promise.resolve({data:{state:'READY',items:[
  {opportunityId:'one',origin:'CENTRAL',href:'/catalogo/one',title:'Formação',programmeName:'Digital',matchedAreas},
  {opportunityId:'two',origin:'CENTRAL',href:'/catalogo/two',title:'Competências',matchedAreas:[matchedAreas[0]]},
 ]}}))
 expect((await screen.findByRole('link',{name:'Formação'})).getAttribute('href')).toBe('/catalogo/one')
 const results=screen.getAllByRole('heading',{level:3}).map(heading=>heading.closest('li'))
 const first=within(results[0])
 const areas=within(first.getByRole('list',{name:'Áreas em comum'}))
 expect(areas.getByText('Educação')).toBeTruthy()
 expect(areas.getByText('Clima')).toBeTruthy()
 const summary=first.getByText('Porque aparece?',{selector:'summary'})
 expect(first.getAllByText('Porque aparece?',{selector:'summary'})).toHaveLength(1)
 expect(summary.parentElement.open).toBe(false)
 const evidence=within(summary.parentElement)
 expect(evidence.getByText('Educação').nextElementSibling.textContent).toContain('training')
 expect(evidence.getByText('Clima').nextElementSibling.textContent).toContain('adaptation')
 expect(within(results[1]).queryByText(/adaptation/)).toBeNull()
 expect(first.getByText('Não indicado')).toBeTruthy()
 expect(screen.getByText(/não determinam elegibilidade/)).toBeTruthy()
})

it('uses the same area list and explanation when matching people to an opportunity',async()=>{
 const api={people:vi.fn(),matching:vi.fn(async()=>({data:{state:'READY',items:[{personId:'p1',name:'Pessoa de teste',matchedAreas}]}}))}
 render(<MemoryRouter initialEntries={['/matching?oportunidade=opp&origem=CENTRAL']}><MatchingTable organizationId="org" api={api}/></MemoryRouter>)
 expect((await screen.findByRole('link',{name:'Pessoa de teste'})).getAttribute('href')).toBe('/perfil-organizacao/pessoas/p1')
 expect(within(screen.getByRole('list',{name:'Áreas em comum'})).getByText('Clima')).toBeTruthy()
 expect(screen.getAllByText('Porque aparece?',{selector:'summary'})).toHaveLength(1)
 expect(screen.queryByText('Não indicado')).toBeNull()
})

it('oferece consulta direta do catálogo quando o matching excede a capacidade',async()=>{
 mount(Promise.reject({response:{status:409,data:{error:{code:'LIMIT_EXCEEDED'}}}}));const alert=await screen.findByRole('alert');const link=screen.getByRole('link',{name:'consultar o catálogo diretamente'});expect(link.getAttribute('href')).toBe('/catalogo');expect(alert.textContent).toMatch(/não apresenta correspondências calculadas/)
})

it('does not label catalog results with an origin name and keeps the programme; private ones stay marked',async()=>{
 const rows=[{opportunityId:'c',origin:'CENTRAL',href:'/catalogo/c',title:'Central call',programmeName:'HORIZON',matchedAreas:[]},
  {opportunityId:'n',origin:'CENTRAL',href:'/catalogo/n',title:'Central without programme',matchedAreas:[]},
  {opportunityId:'p',origin:'PRIVATE',href:'/oportunidades/p',title:'Private call',programmeName:'Interno',matchedAreas:[]}]
 const api={matching:vi.fn(async()=>({data:{state:'READY',privateIncluded:true,items:rows}})),people:vi.fn(async()=>({data:{items:[],nextCursor:null}}))}
 render(<MemoryRouter><MatchingTable organizationId="org" api={api}/></MemoryRouter>)
 await screen.findByRole('link',{name:'Central call'})
 expect(screen.queryByText(/Catálogo C4G/)).toBeNull()
 expect(screen.getByText('HORIZON')).toBeTruthy()
 expect(screen.getByText('Privada · Interno')).toBeTruthy()
})
