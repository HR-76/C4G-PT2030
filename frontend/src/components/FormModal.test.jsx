import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import FormModal from './FormModal'
afterEach(cleanup)

it('contains keyboard focus, locks background scroll and restores background on unmount', () => {
  const close = vi.fn()
  const view = render(<FormModal title="Editar" onClose={close}><label>Nome<input /></label><button>Guardar</button></FormModal>)
  expect(view.container.hasAttribute('inert')).toBe(true)
  expect(document.body.style.overflow).toBe('hidden')
  const first = screen.getByRole('button', { name: 'Fechar' }), last = screen.getByRole('button', { name: 'Guardar' })
  last.focus(); fireEvent.keyDown(last, { key: 'Tab' }); expect(document.activeElement).toBe(first)
  fireEvent.keyDown(first, { key: 'Tab', shiftKey: true }); expect(document.activeElement).toBe(last)
  fireEvent.click(first); expect(close).toHaveBeenCalledTimes(1)
  view.unmount(); expect(view.container.hasAttribute('inert')).toBe(false)
  expect(document.body.style.overflow).toBe('')
})

it('uses the current lock state and keeps focus when switching to review', () => {
  const close = vi.fn()
  const view = render(<FormModal title="Editar" onClose={close} step={false}><input aria-label="Nome" /></FormModal>)
  view.rerender(<FormModal title="Editar" onClose={close} locked step><p>Rever</p></FormModal>)
  expect(document.activeElement).toBe(screen.getByRole('dialog'))
  fireEvent.keyDown(document.activeElement, { key: 'Escape' }); expect(close).not.toHaveBeenCalled()
  expect(screen.getByRole('button', { name: 'Fechar' }).disabled).toBe(true)
  view.rerender(<FormModal title="Editar" onClose={close} step><p>Rever</p></FormModal>)
  fireEvent.keyDown(document.activeElement, { key: 'Escape' }); expect(close).toHaveBeenCalledTimes(1)
})

// Found on 14/11/2026 in PrivateApplications.test.jsx: two active modals pulled the focus from each other until the
// call stack overflowed. Only the modal opened last may contain the focus or answer the keyboard.
it('lets only the modal opened last contain the focus and answer Escape', () => {
  const closeFirst = vi.fn(), closeSecond = vi.fn()
  const Both = ({ second }) => <>
    <FormModal title="Alterar estado" onClose={closeFirst}><label>Motivo<input /></label></FormModal>
    {second && <FormModal title="Editar dados" onClose={closeSecond}><label>Notas<input /></label></FormModal>}
  </>
  const view = render(<Both second={false} />)
  const reason = screen.getByLabelText('Motivo')
  expect(document.activeElement).toBe(reason)
  // Opening the second modal must settle, not recurse.
  expect(() => view.rerender(<Both second />)).not.toThrow()
  const notes = screen.getByLabelText('Notas')
  expect(document.activeElement).toBe(notes)
  // Focus sent to the modal underneath comes back to the one on top, once.
  reason.focus()
  expect(document.activeElement).toBe(notes)
  fireEvent.keyDown(notes, { key: 'Escape' })
  expect(closeSecond).toHaveBeenCalledTimes(1); expect(closeFirst).not.toHaveBeenCalled()
  // With the top modal gone, the one underneath contains the focus again.
  view.rerender(<Both second={false} />)
  document.body.focus(); screen.getByRole('button', { name: 'Fechar' }).focus()
  expect(screen.getByRole('dialog', { name: 'Alterar estado' }).contains(document.activeElement)).toBe(true)
  fireEvent.keyDown(document.activeElement, { key: 'Escape' })
  expect(closeFirst).toHaveBeenCalledTimes(1)
})
