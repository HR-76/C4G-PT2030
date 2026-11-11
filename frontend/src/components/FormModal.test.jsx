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
