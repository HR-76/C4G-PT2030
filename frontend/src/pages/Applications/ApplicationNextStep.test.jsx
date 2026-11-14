import {afterEach,expect,it,vi} from 'vitest'
import {cleanup,fireEvent,render,screen} from '@testing-library/react'
import ApplicationNextStep,{NEXT_STEP} from './ApplicationNextStep'
afterEach(cleanup)
it.each([
 ['APPROVED','Acompanhar a aceitação e manter os registos de execução atualizados.'],
 ['REJECTED','Rever o feedback do financiador para futuras candidaturas.'],
 ['CANCELLED','Consultar os motivos do cancelamento e preservar o histórico.'],
 ['ARCHIVED','Consultar o histórico e os documentos da candidatura arquivada.'],
])('adapts UBI guidance to %s without inventing state transitions', (status,text)=>{
 render(<ApplicationNextStep status={status}/>);
 expect(screen.getByText(text)).toBeTruthy();expect(screen.queryByRole('button')).toBeNull();expect(screen.getAllByRole('link')).toHaveLength(5)
})
it('turns the IDENTIFIED guidance into the actions the user may perform', ()=>{
 const edit=vi.fn(),startPreparation=vi.fn()
 const {container}=render(<ApplicationNextStep status="IDENTIFIED" showNavigation={false} actions={{edit,startPreparation}}/>)
 expect(container.querySelector('p').textContent).toBe('Decidir o responsável e o prazo e iniciar a preparação.')
 fireEvent.click(screen.getByRole('button',{name:'responsável e o prazo'}));expect(edit).toHaveBeenCalledTimes(1)
 fireEvent.click(screen.getByRole('button',{name:'iniciar a preparação'}));expect(startPreparation).toHaveBeenCalledTimes(1)
})
it.each([
 ['INTENTION',['coordenação interna']],
 ['PREPARATION',['equipa','parceiros','documentação','registar a submissão']],
 ['SUBMITTED',['documentos da submissão']],
 ['CANCELLED',['motivos do cancelamento']],
 ['ARCHIVED',['histórico','documentos']],
])('links the %s guidance to its sections without changing the text', (status,names)=>{
 const actions={edit:vi.fn(),startPreparation:vi.fn(),registerSubmission:vi.fn(),team:vi.fn(),partners:vi.fn(),documents:vi.fn(),history:vi.fn()}
 const {container}=render(<ApplicationNextStep status={status} showNavigation={false} actions={actions}/>)
 expect(container.querySelector('p').textContent).toBe(NEXT_STEP[status])
 expect(screen.getAllByRole('button').map(button=>button.textContent)).toEqual(names)
 screen.getAllByRole('button').forEach(button=>fireEvent.click(button))
 expect(Object.values(actions).filter(action=>action.mock.calls.length===1)).toHaveLength(names.length)
})
it('keeps the IDENTIFIED guidance as plain text for actions the user may not perform', ()=>{
 render(<ApplicationNextStep status="IDENTIFIED" showNavigation={false} actions={{edit:null,startPreparation:vi.fn()}}/>)
 expect(screen.getAllByRole('button')).toHaveLength(1);expect(screen.getByRole('button',{name:'iniciar a preparação'})).toBeTruthy()
})

