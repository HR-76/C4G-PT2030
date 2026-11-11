import {afterEach,expect,it} from 'vitest'
import {cleanup,render,screen} from '@testing-library/react'
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

