import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within, waitFor } from '@testing-library/react'
import ApplicationTaskCalendar from './ApplicationTaskCalendar'
import { lisbonDay } from '../../api/organizationDashboard'
afterEach(cleanup)
const tasks=Array.from({length:6},(_,i)=>({taskId:String(i),title:`Tarefa ${i} com um título extenso para verificar o comportamento da grelha`,responsibleMembershipId:'member',deadline:lisbonDay(),status:i===1?'COMPLETED':'OPEN'}))
const props={tasks,memberName:()=> 'Pessoa responsável',labels:{OPEN:'Aberta',COMPLETED:'Concluída'},onClose:vi.fn()}
it('caps the grid at two events and opens every remaining task in a read-only day modal',async()=>{
 render(<ApplicationTaskCalendar {...props}/>);
 const grid=within(screen.getByRole('table'))
 expect(grid.getAllByRole('button',{name:/Ver tarefa /})).toHaveLength(2)
 const more=grid.getByRole('button',{name:/Ver as 6 tarefas/});more.focus();fireEvent.click(more)
 const modal=within(screen.getByRole('dialog'))
 for(const task of tasks)expect(modal.getByRole('heading',{name:task.title})).toBeTruthy()
 expect(modal.queryByRole('button',{name:'Editar tarefa'})).toBeNull()
 fireEvent.keyDown(document,{key:'Escape'});
 await waitFor(()=>expect(document.activeElement).toBe(more))
})
it('shows full details without editing a completed task and drops removed selection',()=>{
 const onEdit=vi.fn();const view=render(<ApplicationTaskCalendar {...props} onEdit={onEdit}/>);
 fireEvent.click(within(screen.getByRole('table')).getByRole('button',{name:`Ver tarefa ${tasks[1].title}`}))
 const modal=within(screen.getByRole('dialog',{name:'Detalhes da tarefa'}));expect(modal.getByText('Pessoa responsável')).toBeTruthy();expect(modal.getByText('Concluída')).toBeTruthy()
 expect(modal.queryByRole('button',{name:'Editar tarefa'})).toBeNull()
 view.rerender(<ApplicationTaskCalendar {...props} tasks={[]}/>);
 expect(screen.queryByRole('dialog',{name:'Detalhes da tarefa'})).toBeNull()
 expect(screen.getByRole('dialog',{name:'Calendário de tarefas'})).toBeTruthy();expect(onEdit).not.toHaveBeenCalled()
})
