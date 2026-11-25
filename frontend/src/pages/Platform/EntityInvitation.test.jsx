import { beforeEach, expect, it, vi } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor, within } from '@testing-library/react'
import EntityInvitation from './EntityInvitation'

// Contract: context/features/entity-invitation-simplified.md.
const record = { id: 'adm-1', name: 'Ana', email: 'ana@example.invalid', phase: 'IDENTITY', createdAt: '2026-10-18T12:00:00Z' }
const row = (overrides = {}) => ({ ...record, phase: 'READY', createdBy: 'C4G', invitationStatus: 'OPEN', expiresAt: '2027-10-18T12:00:00Z', state: 'SENT', detail: null, ...overrides })
const api = { list: vi.fn(), create: vi.fn(), resume: vi.fn(), issue: vi.fn(), cancel: vi.fn() }
const listing = items => ({ data: { page: 1, pageSize: 25, total: items.length, items } })
const accepted = { data: { id: 'inv-1', expiresAt: '2027-10-18T12:00:00Z', emailDelivery: { status: 'ACCEPTED', recipient: 'ana@example.invalid' } } }
beforeEach(() => {
  cleanup(); vi.resetAllMocks()
  api.list.mockResolvedValue(listing([]))
  api.create.mockResolvedValue({ data: record })
  api.resume.mockImplementation(async id => ({ data: { ...record, id, phase: 'READY' } }))
  api.issue.mockResolvedValue(accepted)
})
const mount = () => render(<EntityInvitation api={api} />)
function fill() {
  fireEvent.click(screen.getByRole('button', { name: 'Novo convite' }))
  fireEvent.change(screen.getByLabelText('Nome do administrador'), { target: { value: 'Ana' } })
  fireEvent.change(screen.getByLabelText('Email do administrador'), { target: { value: 'ana@example.invalid' } })
}

it('opens a modal focused on the name and cancels without creating an invitation', async () => {
  mount(); const trigger = screen.getByRole('button', { name: 'Novo convite' }); trigger.focus(); fireEvent.click(trigger)
  expect(screen.getByRole('dialog', { name: 'Novo convite' })).toBeTruthy(); expect(document.activeElement).toBe(screen.getByLabelText('Nome do administrador'))
  fireEvent.click(screen.getByRole('button', { name: 'Cancelar' })); expect(screen.queryByRole('dialog')).toBeNull()
  await waitFor(() => expect(document.activeElement).toBe(trigger)); expect(api.create).not.toHaveBeenCalled()
})

it('sends the invitation with one action: create, prepare the account and send the link', async () => {
  mount(); fill(); fireEvent.click(screen.getByRole('button', { name: 'Enviar convite' }))
  const sent = await screen.findByText(/^Convite enviado por email para ana@example\.invalid\. A ligação é válida até .*Lisboa/)
  expect(sent.getAttribute('role')).toBe('status'); expect(screen.queryByRole('dialog')).toBeNull()
  expect(Object.keys(api.create.mock.calls[0][0]).sort()).toEqual(['email', 'name', 'requestId'])
  expect(api.resume).toHaveBeenCalledWith('adm-1')
  expect(api.issue).toHaveBeenCalledWith('adm-1', { requestId: expect.any(String), replace: false })
  expect(api.create.mock.invocationCallOrder[0]).toBeLessThan(api.resume.mock.invocationCallOrder[0])
  expect(api.resume.mock.invocationCallOrder[0]).toBeLessThan(api.issue.mock.invocationCallOrder[0])
  for (const removed of ['Rever convite', 'Criar convite', 'Preparar conta', 'Emitir ligação temporária']) expect(screen.queryByText(removed)).toBeNull()
  expect(screen.queryByLabelText('Ligação para entregar ao administrador')).toBeNull()
})

it('skips preparing an account that is already prepared', async () => {
  api.create.mockResolvedValue({ data: { ...record, phase: 'READY' } }); mount(); fill()
  fireEvent.click(screen.getByRole('button', { name: 'Enviar convite' })); await screen.findByText(/^Convite enviado por email/)
  expect(api.resume).not.toHaveBeenCalled()
})

it('says where it stopped and retries the same invitation without duplicating it', async () => {
  api.resume.mockRejectedValueOnce(Error('lost')).mockResolvedValue({ data: { ...record, phase: 'READY' } }); mount(); fill()
  fireEvent.click(screen.getByRole('button', { name: 'Enviar convite' }))
  const dialog = screen.getByRole('dialog'), retry = await screen.findByRole('button', { name: 'Tentar novamente' })
  expect(dialog.contains(retry)).toBe(true); expect(within(dialog).getByRole('alert').textContent).toMatch(/ficou por confirmar/)
  fireEvent.keyDown(document.activeElement, { key: 'Escape' }); expect(screen.getByRole('dialog')).toBe(dialog)
  expect(api.issue).not.toHaveBeenCalled()
  fireEvent.click(retry); await screen.findByText(/^Convite enviado por email/)
  expect(api.create.mock.calls[1][0]).toEqual(api.create.mock.calls[0][0])
  expect(api.issue).toHaveBeenCalledTimes(1)
})

it('waits when the account is not ready yet and continues from the same invitation', async () => {
  api.resume.mockResolvedValueOnce({ data: record }).mockResolvedValue({ data: { ...record, phase: 'READY' } }); mount(); fill()
  fireEvent.click(screen.getByRole('button', { name: 'Enviar convite' }))
  expect((await screen.findByRole('alert')).textContent).toBe('A conta ainda não ficou preparada. Tente novamente dentro de momentos.')
  fireEvent.click(screen.getByRole('button', { name: 'Tentar novamente' })); await screen.findByText(/^Convite enviado por email/)
  expect(api.create).toHaveBeenCalledTimes(1); expect(api.resume).toHaveBeenCalledTimes(2)
})

it('explains that an existing entity link blocks a second entity, with nothing to retry', async () => {
  api.create.mockRejectedValue({ response: { status: 409, data: { error: { code: 'MEMBERSHIP_ALREADY_EXISTS' } } } }); mount(); fill()
  fireEvent.click(screen.getByRole('button', { name: 'Enviar convite' })); await screen.findByText(/já pertence a uma entidade/)
  expect(screen.queryByRole('button', { name: 'Tentar novamente' })).toBeNull()
})

it('shows the link for manual delivery, with the reason, when the email did not leave', async () => {
  for (const [status, reason] of [['NOT_CONFIGURED', 'O envio de email não está configurado neste ambiente.'], ['UNCONFIRMED', 'O envio do email não foi confirmado.']]) {
    cleanup(); api.issue.mockResolvedValue({ data: { id: 'inv', secret: 'ab'.repeat(32), expiresAt: '2027-10-18T12:00:00Z', emailDelivery: { status } } }); mount(); fill()
    fireEvent.click(screen.getByRole('button', { name: 'Enviar convite' }))
    expect((await screen.findByText(reason, { exact: false })).textContent).toBe(reason + ' Entregue esta ligação ao administrador.')
    expect(screen.getByLabelText('Ligação para entregar ao administrador').value).toBe(window.location.origin + '/api/admission-activation#' + 'ab'.repeat(32))
  }
})

it('shows each invitation with the state the server decided, never the internal phase', async () => {
  api.list.mockResolvedValue(listing([
    row({ id: 'a', name: 'Sent' }), row({ id: 'b', name: 'Filling', phase: 'FILLING', invitationStatus: 'USED', detail: 'FILLING' }),
    row({ id: 'c', name: 'Preparing', phase: 'PREPARING', state: 'ACCEPTED', detail: 'PREPARING' }), row({ id: 'd', name: 'Done', phase: 'COMPLETE', state: 'ACCEPTED' }),
    row({ id: 'e', name: 'Late', state: 'EXPIRED', expiresAt: '2026-01-01T00:00:00Z' }), row({ id: 'f', name: 'Gone', phase: 'CANCELLED', state: 'CANCELLED' }),
    row({ id: 'g', name: 'Stuck', phase: 'IDENTITY', invitationStatus: null, expiresAt: null, state: 'NOT_SENT' })]))
  mount(); await screen.findByText('Sent')
  const line = name => { const cells = within(screen.getByText(name).closest('tr')).getAllByRole('cell'); return [cells[2].textContent, within(cells[4]).queryAllByRole('button').map(button => button.textContent)] }
  expect(line('Sent')).toEqual(['Convite enviado', ['Reenviar', 'Cancelar']])
  expect(line('Filling')).toEqual(['Convite enviadoFicha em preenchimento', ['Cancelar']])
  expect(line('Preparing')).toEqual(['AceiteEntidade em criação', []])
  expect(line('Done')).toEqual(['Aceite', []])
  expect(line('Late')).toEqual(['Expirado', ['Reenviar', 'Cancelar']])
  expect(line('Gone')).toEqual(['Cancelado', []])
  expect(line('Stuck')).toEqual(['Por enviar', ['Enviar', 'Cancelar']])
  for (const phase of ['A preparar a conta', 'Convite por aceitar', 'Entidade em preparação', 'Acesso ativado']) expect(screen.queryByText(phase)).toBeNull()
  expect(screen.getAllByText(/Lisboa/).length).toBeGreaterThan(0)
})

it('resends by replacing the link, and sends a stuck invitation from where it stopped', async () => {
  api.list.mockResolvedValue(listing([row({ id: 'a', name: 'Sent' }), row({ id: 'g', name: 'Stuck', phase: 'IDENTITY', invitationStatus: null, state: 'NOT_SENT' })]))
  mount(); await screen.findByText('Sent')
  fireEvent.click(within(screen.getByText('Sent').closest('tr')).getByRole('button', { name: 'Reenviar' })); await screen.findByText(/^Convite enviado por email/)
  expect(api.create).not.toHaveBeenCalled(); expect(api.resume).not.toHaveBeenCalled()
  expect(api.issue).toHaveBeenLastCalledWith('a', { requestId: expect.any(String), replace: true })
  fireEvent.click(within(screen.getByText('Stuck').closest('tr')).getByRole('button', { name: 'Enviar' })); await waitFor(() => expect(api.issue).toHaveBeenCalledTimes(2))
  expect(api.resume).toHaveBeenCalledWith('g'); expect(api.issue).toHaveBeenLastCalledWith('g', { requestId: expect.any(String), replace: false })
})

it('asks before cancelling and refreshes the list afterwards', async () => {
  api.list.mockResolvedValue(listing([row({ id: 'a', name: 'Sent' })])); api.cancel.mockResolvedValue({ data: {} })
  const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValue(true)
  mount(); const button = within((await screen.findByText('Sent')).closest('tr')).getByRole('button', { name: 'Cancelar' })
  fireEvent.click(button); expect(api.cancel).not.toHaveBeenCalled()
  fireEvent.click(button); await waitFor(() => expect(api.cancel).toHaveBeenCalledWith('a'))
  await waitFor(() => expect(api.list).toHaveBeenCalledTimes(2)); confirm.mockRestore()
})

it('says an invitation had already been issued when a repeated request returns no link', async () => {
  api.issue.mockResolvedValue({ data: { id: 'inv', expiresAt: '2027-10-18T12:00:00Z', secretUnavailable: true } }); mount(); fill()
  fireEvent.click(screen.getByRole('button', { name: 'Enviar convite' }))
  expect(await screen.findByText('O convite de ana@example.invalid já tinha sido emitido. Use «Reenviar» para enviar uma ligação nova.')).toBeTruthy()
})
