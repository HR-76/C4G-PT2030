import React from 'react'
import { afterEach, expect, it } from 'vitest'
import { render, screen, cleanup, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import DashboardDeadlines from './DashboardDeadlines'
afterEach(cleanup)
const rows = [{id:'a',title:'Atrasada',deadline:'2026-11-10',days_left:-1},{id:'b',title:'Hoje candidatura',deadline:'2026-11-11',days_left:0},{id:'c',title:'Futura',deadline:'2026-11-12',days_left:1}]
const mount = props => render(<MemoryRouter><DashboardDeadlines {...props}/></MemoryRouter>)
it('groups deadlines with civil dates and direct links',()=>{
 mount({deadlines:rows})
 for(const [index,label] of ['Em atraso','Hoje','Próximos'].entries()) {
  const group=screen.getByRole('heading',{name:new RegExp(label)}).parentElement
  expect(within(group).getByRole('link').getAttribute('href')).toBe('/candidaturas/'+rows[index].id)
 }
 expect(screen.getByText('10/11/2026').getAttribute('datetime')).toBe('2026-11-10')
 expect(screen.getByText('1 dia em atraso')).toBeTruthy()
 expect(screen.getByText('Termina hoje')).toBeTruthy()
 expect(screen.getByText('Falta 1 dia')).toBeTruthy()
})
it('labels partial counts and never claims missing groups have no deadlines globally',()=>{
 mount({deadlines:rows.slice(0,1),total:30})
 expect(screen.getByRole('status').textContent).toContain('1 de 30')
 expect(screen.getAllByText('Sem prazos deste grupo na seleção apresentada.')).toHaveLength(2)
})
it('describes the full empty range including overdue',()=>{
 mount({deadlines:[],total:0})
 expect(screen.getByText(/não há atrasos nem prazos/)).toBeTruthy()
})
it('does not claim an empty partial result is complete',()=>{
 mount({deadlines:[],total:30})
 expect(screen.getByText('Sem prazos apresentados nesta seleção.')).toBeTruthy()
 expect(screen.queryByText(/não há atrasos/)).toBeNull()
})
