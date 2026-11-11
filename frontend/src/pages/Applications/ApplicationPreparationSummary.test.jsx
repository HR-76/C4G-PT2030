import {afterEach,expect,it,vi} from 'vitest'
import {cleanup,render,screen,within} from '@testing-library/react'
import ApplicationPreparationSummary from './ApplicationPreparationSummary'
afterEach(()=>{cleanup();vi.useRealTimers()})
const work={state:'ready',data:{participants:[{membershipId:'a',active:true}],tasks:[{taskId:'t',title:'Orçamento',status:'OPEN',deadline:'2026-11-01'},{taskId:'done',title:'Terminada',status:'COMPLETED',deadline:'2026-10-01'}],participantNextCursor:'more',taskNextCursor:'next'}}
const documents={state:'ready',data:{documents:[{documentId:'d',filename:'Dossier.pdf',usable:false}],reviews:[{requestId:'r',stale:false,decision:'CHANGES_REQUESTED'},{requestId:'old',stale:true,decision:'APPROVED'},{requestId:'restricted',documentsRestricted:true,stale:false,decision:null}],reviewsNextCursor:'more'}}
it('summarizes loaded pending items without implying complete pages or approval',()=>{
 render(<ApplicationPreparationSummary work={work} documents={documents} today="2026-11-02"/>);
 const attention=within(screen.getByRole('region',{name:'A tratar'}))
 expect(attention.getByText('Prazo ultrapassado')).toBeTruthy()
 expect(screen.getByRole('link',{name:'Orçamento'}).getAttribute('href')).toBe('#tarefa-t')
 expect(screen.queryByText('Terminada')).toBeNull()
 expect(screen.getByRole('link',{name:'Dossier.pdf'}).getAttribute('href')).toBe('#documento-d')
 expect(attention.getByRole('link',{name:'Rever alterações solicitadas'}).getAttribute('href')).toBe('#revisao-r')
 expect(screen.getByText(/Há mais tarefas por carregar/)).toBeTruthy()
 expect(screen.getByText(/Há mais participantes por carregar/)).toBeTruthy()
 expect(screen.getByText(/Há mais pedidos de revisão por carregar/)).toBeTruthy()
 expect(screen.getByText(/1 pedido.*desatualizado/)).toBeTruthy()
 expect(screen.getByText(/1 pedido.*acesso limitado/)).toBeTruthy()
})
it.each(['loading','unavailable','pending','updating'])('does not expose stale counts or filenames while %s',state=>{
 render(<ApplicationPreparationSummary work={{...work,state}} documents={{...documents,state}} today="2026-11-02"/>);
 expect(screen.queryByText('Orçamento')).toBeNull();expect(screen.queryByText('Dossier.pdf')).toBeNull()
 expect(screen.getAllByText({loading:'A consultar…',unavailable:'Consulta indisponível. Consulte a secção para recuperar o acesso ou repetir.',pending:'Existe um envio por confirmar. Resolva-o na secção correspondente.',updating:'A atualizar os dados…'}[state]).length).toBe(3)
})
it('keeps due-today tasks open without marking them overdue or declaring readiness',()=>{
 render(<ApplicationPreparationSummary work={{state:'ready',data:{participants:[],tasks:[{taskId:'today',title:'Rever',status:'OPEN',deadline:'2026-11-02'}]}}} documents={{state:'ready',data:{documents:[],reviews:[]}}} today="2026-11-02"/>);
 expect(screen.queryByText('Prazo ultrapassado')).toBeNull();expect(screen.getByText('Sem documentos associados.')).toBeTruthy()
 expect(screen.getByText(/não confirma elegibilidade/)).toBeTruthy()
 expect(within(screen.getByRole('region',{name:'Resumo de preparação'})).getAllByRole('button').map(button=>button.getAttribute('aria-label'))).toEqual(['Sobre o resumo de preparação'])
})
it.each([
 [new Date(2026,2,28,23,59),false],
 [new Date(2026,2,29,0,1),false],
 [new Date(2026,2,30,0,1),true],
])('uses the device civil day around the spring clock change (%s)',(now,overdue)=>{
 vi.useFakeTimers();vi.setSystemTime(now)
 render(<ApplicationPreparationSummary work={{state:'ready',data:{participants:[],tasks:[{taskId:'t',title:'Rever',status:'OPEN',deadline:'2026-03-29'}]}}} documents={{state:'ready',data:{documents:[],reviews:[]}}}/>)
 expect(Boolean(screen.queryByText('Prazo ultrapassado'))).toBe(overdue)
})

it('only reports no pending items when both sources are ready and complete',()=>{
 const emptyWork={state:'ready',data:{participants:[],tasks:[]}}
 const emptyDocs={state:'ready',data:{documents:[],reviews:[]}}
 const attention=()=>within(screen.getByRole('region',{name:'A tratar'}))
 const {rerender}=render(<ApplicationPreparationSummary work={emptyWork} documents={emptyDocs}/>)
 expect(attention().getByText('Sem pendências de preparação a tratar.')).toBeTruthy()
 rerender(<ApplicationPreparationSummary work={emptyWork} documents={{state:'unavailable'}}/>)
 expect(attention().queryByText('Sem pendências de preparação a tratar.')).toBeNull()
 rerender(<ApplicationPreparationSummary work={{...emptyWork,data:{...emptyWork.data,taskNextCursor:'mais'}}} documents={emptyDocs}/>)
 expect(attention().queryByText('Sem pendências de preparação a tratar.')).toBeNull()
 rerender(<ApplicationPreparationSummary work={emptyWork} documents={{...emptyDocs,data:{...emptyDocs.data,reviews:[{requestId:'restricted',documentsRestricted:true,stale:false,decision:null}]}}}/>)
 expect(attention().queryByText('Sem pendências de preparação a tratar.')).toBeNull()
})
