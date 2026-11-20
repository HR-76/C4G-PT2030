import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import EmailHistory from './EmailHistory'

vi.mock('../../api/api', () => ({ platformEmailApi: {} }))
afterEach(cleanup)
const show = api => render(<MemoryRouter><EmailHistory api={api}/></MemoryRouter>)
const row = { id: 'one', type: 'password-reset', source: 'KEYCLOAK', recipient: 'synthetic@example.invalid',
  occurredAt: '2026-07-01T12:00:00Z', status: 'ACCEPTED', test: false }

it('shows real transport result and Lisbon time without claiming inbox delivery', async () => {
  show({ history: vi.fn().mockResolvedValue({ data: { items: [row], nextCursor: null } }) })
  expect(await screen.findByText('synthetic@example.invalid')).toBeTruthy()
  expect(screen.getByRole('cell', { name: 'Aceite pelo serviço de envio' })).toBeTruthy()
  expect(screen.getByText(/13:00:00/)).toBeTruthy()
  expect(screen.getByText(/não confirma a entrega/)).toBeTruthy()
});
it('shows an expired address without resolving it from the account', async () => {
  show({ history: vi.fn().mockResolvedValue({ data: { items: [{ ...row, recipient: null }], nextCursor: null } }) })
  expect(await screen.findByText('Endereço não conservado')).toBeTruthy()
});
it('retries failure and does not call it an empty history', async () => {
  const api = { history: vi.fn().mockRejectedValueOnce(Error('private')).mockResolvedValue({ data: { items: [], nextCursor: null } }) }
  show(api)
  expect(await screen.findByRole('alert')).toBeTruthy()
  expect(screen.queryByText(/Não existem envios/)).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }))
  expect(await screen.findByText(/Não existem envios/)).toBeTruthy()
});
it('uses returned cursors and resets pagination when filters change', async () => {
  const api = { history: vi.fn().mockResolvedValue({ data: { items: [row], nextCursor: 'next' } }) }
  show(api)
  await screen.findByText(row.recipient)
  fireEvent.click(screen.getByRole('button', { name: 'Seguinte' }))
  await waitFor(() => expect(api.history.mock.calls.at(-1)[0].cursor).toBe('next'))
  fireEvent.change(screen.getByLabelText('Tipo'), { target: { value: 'member-invitation' } })
  await waitFor(() => expect(api.history.mock.calls.at(-1)[0]).toEqual({ type: 'member-invitation', status: '', cursor: '' }))
});
it('reports degraded collection and distinguishes test messages', async () => {
  show({ history: vi.fn().mockResolvedValue({ data: { items: [{ ...row, type: 'member-invitation', test: true }], recordingFailures: 1 } }) })
  expect(await screen.findByRole('alert')).toBeTruthy()
  expect(screen.getByText('Convite de colaborador (teste)')).toBeTruthy()
});
