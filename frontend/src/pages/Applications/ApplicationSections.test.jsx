import { afterEach, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import ApplicationSections from './ApplicationSections'
afterEach(() => { cleanup(); window.history.replaceState(null, '', '/') })
it('keeps draft inputs mounted while changing visible panels and reveals summary targets', () => {
  render(<ApplicationSections sections={[
    { id: 'overview', label: 'Resumo', content: <a href="#tarefa-1">Rever tarefa</a> },
    { id: 'team', label: 'Equipa', content: <div id="tarefa-1"><input aria-label="Rascunho" defaultValue="" /></div> }
  ]} />)
  expect(screen.queryByRole('textbox')).toBeNull()
  fireEvent.click(screen.getByRole('link', { name: 'Rever tarefa' }))
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Em preparação' } })
  fireEvent.click(screen.getByRole('tab', { name: 'Resumo' }))
  expect(screen.queryByRole('textbox')).toBeNull()
  fireEvent.keyDown(screen.getByRole('tab', { name: 'Resumo' }), { key: 'ArrowRight' })
  expect(screen.getByRole('textbox').value).toBe('Em preparação')
  expect(document.activeElement).toBe(screen.getByRole('tab', { name: 'Equipa' }))
})
it('opens the document panel for a direct document link', () => {
  window.history.replaceState(null, '', '/#documento-1')
  render(<ApplicationSections sections={[{ id:'overview',label:'Resumo',content:'Resumo' },{ id:'documents',label:'Documentos',content:<p id="documento-1">Budget.xlsx</p> }]} />)
  expect(screen.getByRole('tabpanel').textContent).toBe('Budget.xlsx')
})
