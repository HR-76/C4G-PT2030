import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
vi.mock('../api/api', () => ({ organizationNotificationsApi: { noticeContext: vi.fn(), noticeHistory: vi.fn(), noticeGet: vi.fn(), noticeSend: vi.fn() } }))
import OrganizationNotices from './OrganizationNotices'
import { organizationNotificationsApi as api } from '../api/api'
const recipients = [{ membershipId: 'a', name: 'Ana' }, { membershipId: 'b', name: 'Bruno' }]
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r }); return { promise, resolve } }
beforeEach(() => { vi.resetAllMocks(); api.noticeContext.mockResolvedValue({ data: { canManage: true, recipients } }); api.noticeHistory.mockResolvedValue({ data: { items: [], nextCursor: null } }); api.noticeSend.mockResolvedValue({ data: { recipientCount: 1 } }) })
afterEach(cleanup)
const ui = (org = 'org-a') => <OrganizationNotices key={org} organizationId={org} organizationName={org} />
const open = async () => fireEvent.click(await screen.findByRole('button', { name: 'Preparar aviso e consultar histórico' }))
async function fill() { await open(); fireEvent.change(screen.getByLabelText('Título'), { target: { value: 'Aviso privado' } }); fireEvent.change(screen.getByLabelText('Mensagem'), { target: { value: 'Mensagem da organização A' } }); fireEvent.click(screen.getByLabelText('Ana')); fireEvent.click(screen.getByRole('button', { name: 'Rever aviso' })) }
it('common member has no administrative form or history request', async () => { api.noticeContext.mockResolvedValue({ data: { canManage: false, recipients: [] } }); render(ui()); await act(async () => {}); expect(screen.queryByRole('heading')).toBeNull(); expect(api.noticeHistory).not.toHaveBeenCalled() })
it('selects nobody by default and requires preview before explicit send', async () => {
  render(ui()); await open(); expect(screen.getByLabelText('Ana').checked).toBe(false); expect(screen.getByLabelText('Bruno').checked).toBe(false)
  fireEvent.change(screen.getByLabelText('Título'), { target: { value: 'Aviso' } }); fireEvent.change(screen.getByLabelText('Mensagem'), { target: { value: 'Texto' } })
  fireEvent.click(screen.getByRole('button', { name: 'Selecionar todos os membros ativos (2)' })); fireEvent.click(screen.getByRole('button', { name: 'Rever aviso' }))
  expect(api.noticeSend).not.toHaveBeenCalled(); expect(screen.getByText('Ana; Bruno', { exact: false })).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Confirmar e enviar aviso' })); await screen.findByRole('status')
  expect(api.noticeSend.mock.calls[0][0].recipientMembershipIds).toEqual(['a', 'b']); expect(api.noticeSend.mock.calls[0][1]).toBe('org-a')
})
it('uncertain send retains the same intent and prevents editing and duplicate in-flight requests', async () => {
  api.noticeSend.mockRejectedValueOnce(new Error('lost response')); const pending = deferred(); api.noticeSend.mockReturnValueOnce(pending.promise)
  render(ui()); await fill(); fireEvent.click(screen.getByRole('button', { name: 'Confirmar e enviar aviso' })); await screen.findByRole('alert')
  expect(screen.queryByRole('button', { name: 'Voltar a editar' })).toBeNull(); const retry = screen.getByRole('button', { name: 'Repetir confirmação do envio' }); fireEvent.click(retry); fireEvent.click(retry)
  expect(api.noticeSend).toHaveBeenCalledTimes(2); expect(api.noticeSend.mock.calls[1]).toEqual(api.noticeSend.mock.calls[0])
  await act(async () => pending.resolve({ data: { recipientCount: 1 } })); await screen.findByRole('status')
})
it('recipient changed before sending requires a fresh explicit selection', async () => {
  api.noticeSend.mockRejectedValue({ response: { data: { error: { code: 'RECIPIENT_UNAVAILABLE' } } } }); render(ui()); await fill(); fireEvent.click(screen.getByRole('button', { name: 'Confirmar e enviar aviso' })); await screen.findByRole('alert'); expect(screen.getByLabelText('Ana').checked).toBe(false); expect(screen.getByRole('button', { name: 'Rever aviso' }).disabled).toBe(true)
})
it('organization switch discards a draft and an old send response', async () => {
  const pending = deferred(); api.noticeSend.mockReturnValue(pending.promise); const view = render(ui()); await fill(); fireEvent.click(screen.getByRole('button', { name: 'Confirmar e enviar aviso' })); view.rerender(ui('org-b')); await open()
  await act(async () => pending.resolve({ data: { recipientCount: 1 } })); expect(screen.getByLabelText('Título').value).toBe(''); expect(screen.queryByText('Aviso enviado a 1 pessoa.')).toBeNull(); expect(screen.queryByText('Mensagem da organização A')).toBeNull()
})
it('late history detail cannot replace the next page or leak read receipts', async () => {
  api.noticeHistory.mockResolvedValueOnce({ data: { items: [{ noticeId: 'n', title: 'Aviso antigo', authorName: 'Ana', recipientCount: 1, createdAt: '2026-10-18' }], nextCursor: 'cursor' } })
  const pending = deferred(); api.noticeGet.mockReturnValue(pending.promise); render(ui()); await open(); fireEvent.click(await screen.findByRole('button', { name: 'Ver aviso' }));
  await act(async () => pending.resolve({ data: { title: 'Aviso antigo', message: 'Detalhe', recipientCount: 1, recipients } })); await screen.findByText('Detalhe'); expect(screen.queryByText(/Leu/)).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Seguinte' })); await waitFor(() => expect(screen.queryByText('Detalhe')).toBeNull()); expect(api.noticeHistory).toHaveBeenLastCalledWith({ cursor: 'cursor' }, 'org-a')
})
