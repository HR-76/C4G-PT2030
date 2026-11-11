import { StrictMode } from 'react'
import { afterEach, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { useConfirmDialog } from './ConfirmDialog'

afterEach(cleanup)

function Example({ onResult = () => {}, twice = false }) {
  const { confirm, dialog } = useConfirmDialog()
  const open = () => {
    confirm({ title: 'Arquivar oportunidade?', message: 'O histórico será preservado.', confirmLabel: 'Arquivar' }).then(onResult)
    if (twice) confirm({ title: 'Segunda confirmação' }).then(onResult)
  }
  return <><button onClick={open}>Abrir confirmação</button><button>Outra ação</button>{dialog}</>
}

it('names the modal, focuses cancellation and contains keyboard navigation', () => {
  render(<StrictMode><Example /></StrictMode>)
  const trigger = screen.getByRole('button', { name: 'Abrir confirmação' }); trigger.focus(); fireEvent.click(trigger)
  const dialog = screen.getByRole('dialog', { name: 'Arquivar oportunidade?' })
  expect(dialog.getAttribute('aria-modal')).toBe('true')
  expect(document.getElementById(dialog.getAttribute('aria-describedby')).textContent).toBe('O histórico será preservado.')
  expect(document.activeElement).toBe(within(dialog).getByRole('button', { name: 'Cancelar' }))
  const close = within(dialog).getByRole('button', { name: 'Fechar' }), confirm = within(dialog).getByRole('button', { name: 'Arquivar' })
  confirm.focus(); fireEvent.keyDown(document, { key: 'Tab' }); expect(document.activeElement).toBe(close)
  fireEvent.keyDown(document, { key: 'Tab', shiftKey: true }); expect(document.activeElement).toBe(confirm)
  screen.getByRole('button', { name: 'Outra ação' }).focus()
  expect(dialog.contains(document.activeElement)).toBe(true)
})

it('Escape cancels once and restores the triggering focus', async () => {
  const result = vi.fn(); render(<StrictMode><Example onResult={result} /></StrictMode>)
  const trigger = screen.getByRole('button', { name: 'Abrir confirmação' }); trigger.focus(); fireEvent.click(trigger)
  fireEvent.keyDown(document, { key: 'Escape' }); await act(async () => {})
  expect(screen.queryByText('Arquivar oportunidade?')).toBeNull()
  expect(result.mock.calls).toEqual([[false]])
  expect(document.activeElement).toBe(trigger)
})

it('confirmation retains the boolean contract without duplicate settlement', async () => {
  const result = vi.fn(); render(<StrictMode><Example onResult={result} /></StrictMode>)
  fireEvent.click(screen.getByRole('button', { name: 'Abrir confirmação' }))
  fireEvent.click(screen.getByRole('button', { name: 'Arquivar' })); await act(async () => {})
  expect(result.mock.calls).toEqual([[true]])
})

it('unmount cancels the outstanding confirmation without leaving its promise pending', async () => {
  const result = vi.fn(), view = render(<Example onResult={result} />)
  fireEvent.click(screen.getByRole('button', { name: 'Abrir confirmação' })); view.unmount(); await act(async () => {})
  expect(result.mock.calls).toEqual([[false]])
})

it('superseding a confirmation settles the old request as cancellation', async () => {
  const result = vi.fn(); render(<Example onResult={result} twice />)
  fireEvent.click(screen.getByRole('button', { name: 'Abrir confirmação' })); await act(async () => {})
  expect(result.mock.calls).toEqual([[false]])
  fireEvent.click(screen.getByRole('button', { name: 'Cancelar' })); await act(async () => {})
  expect(result.mock.calls).toEqual([[false], [false]])
})
