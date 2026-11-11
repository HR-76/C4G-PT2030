import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import ApplicationTimeline from './ApplicationTimeline'

afterEach(cleanup)
const initial = {revision:1,kind:'CREATE',toStatus:'IDENTIFIED',recordedAt:'2026-11-03T10:00:00Z',title:'Aviso',deadline:'2026-11-20',totalBudget:'100.00',organizationBudget:null,unitIds:[]}
const updated = {...initial,revision:2,kind:'EDIT',deadline:'2026-11-28',organizationBudget:'0.00'}
it('uses the name authorized with the revision without a general directory',()=>{
 render(<ApplicationTimeline record={{revision:1}} history={[{...initial,responsibleMembershipId:'member-id',responsibleName:'Gestor da revisão'}]} responsibles={[]}/>);
 expect(screen.getByText('Gestor da revisão')).toBeTruthy();
 expect(screen.queryByText('member-id')).toBeNull();
})

it('compares consecutive snapshots, including the change from missing to zero',()=>{
 render(<ApplicationTimeline record={{revision:2}} history={[updated,initial]} responsibles={[]}/>)
 const latest=screen.getByText('Mais recente').closest('article')
 const changes=latest.querySelector('.revision-changes')
 expect(within(changes).getByText('Prazo interno')).toBeTruthy()
 expect(changes.textContent).toContain('20/11/2026')
 expect(changes.textContent).toContain('28/11/2026')
 expect(within(changes).getByText('Orçamento da organização')).toBeTruthy()
 expect(changes.textContent).toContain('0,00 €')
 expect(within(changes).queryByText('Título')).toBeNull()
 expect(screen.getAllByText('Mais recente')).toHaveLength(1)
})

it('does not infer a change from a nonconsecutive snapshot',()=>{
 render(<ApplicationTimeline record={{revision:4}} history={[{...updated,revision:4},initial]} responsibles={[]}/>)
 expect(screen.getByText('A comparação requer a revisão anterior.')).toBeTruthy()
 expect(document.querySelector('.revision-changes')).toBeNull()
})

it('keeps the reason and revision data inside the disclosure for the corresponding event', () => {
  const transition = { ...initial, revision: 2, kind: 'TRANSITION', fromStatus: 'IDENTIFIED', toStatus: 'PREPARATION', reason: 'Equipa confirmada' }
  render(<ApplicationTimeline record={{ revision: 2 }} history={[transition, initial]} responsibles={[]} />)

  const event = screen.getByText('Estado alterado').closest('article')
  const details = event.querySelector('details')
  const reason = screen.getByText(/Equipa confirmada/)
  expect(details.contains(reason)).toBe(true)
  expect(details.open).toBe(false)

  fireEvent.click(details.querySelector('summary'))
  expect(details.open).toBe(true)
  expect(screen.getByText('Candidatura criada').closest('article').querySelector('details').open).toBe(false)
  fireEvent.click(details.querySelector('summary'))
  expect(details.open).toBe(false)
})
