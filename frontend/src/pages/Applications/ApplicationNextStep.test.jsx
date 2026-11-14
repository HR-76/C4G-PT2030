import {afterEach,expect,it,vi} from 'vitest'
import {cleanup,fireEvent,render,screen} from '@testing-library/react'
import ApplicationNextStep from './ApplicationNextStep'
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
it('keeps the IDENTIFIED guidance as plain text for actions the user may not perform', ()=>{
 render(<ApplicationNextStep status="IDENTIFIED" showNavigation={false} actions={{edit:null,startPreparation:vi.fn()}}/>)
 expect(screen.getAllByRole('button')).toHaveLength(1);expect(screen.getByRole('button',{name:'iniciar a preparação'})).toBeTruthy()
})

