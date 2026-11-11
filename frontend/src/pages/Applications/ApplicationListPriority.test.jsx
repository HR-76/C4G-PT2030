import {afterEach,expect,it} from 'vitest'
import {cleanup,render,screen} from '@testing-library/react'
import {MemoryRouter} from 'react-router-dom'
import ApplicationListPriority from './ApplicationListPriority'
afterEach(cleanup)
const show=priorities=>render(<MemoryRouter><ApplicationListPriority row={{priorities}} target="/candidaturas/a?retorno=x"/></MemoryRouter>)
it('prioritizes changes and links to the document section preserving return filters',()=>{
 show({tasks:{open:2,next:'2020-01-01'},documents:{pending:1,changes:2}})
 expect(screen.getByRole('link').getAttribute('href')).toBe('/candidaturas/a?retorno=x#documentos-revisao')
 expect(screen.getByText(/Em atraso/)).toBeTruthy()
})
it('does not claim empty when authority is absent',()=>{
 show({tasks:null,documents:null});expect(screen.getByText(/dados autorizados/)).toBeTruthy();expect(screen.queryByText(/Sem tarefas/)).toBeNull()
})
it('links tasks and accurately describes an empty authorized summary',()=>{
 const root=show({tasks:{open:1,next:'2030-01-01'},documents:{pending:0,changes:0}});expect(screen.getByRole('link').getAttribute('href')).toContain('#equipa-tarefas');root.unmount()
 show({tasks:{open:0,next:null},documents:{pending:0,changes:0,restricted:false}});expect(screen.getByText(/Sem tarefas abertas/)).toBeTruthy();expect(screen.queryByText('0 tarefas abertas')).toBeNull()
})
