import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
vi.mock('../../api/api', () => ({ platformImportsApi: { stage: vi.fn(), review: vi.fn(), accept: vi.fn() }, authApi: { stepUpPolicy: vi.fn(), stepUp: vi.fn() } }))
import CentralImportCatalog from './CentralImportCatalog'

const DIGEST = 'a'.repeat(64)
const review = (totals, extra = {}) => ({ importId: 'import-1', totalRows: Object.values(totals).reduce((a, b) => a + b, 0), batchDigest: 'b'.repeat(64),
  totals: { ACCEPTABLE: 0, ALREADY_ACCEPTED: 0, NEEDS_REVIEW: 0, REJECTED: 0, ...totals },
  rows: [{ physicalRow: 3, externalIdentifier: '8485', title: 'CONTRATOS DE IMPACTO SOCIAL', status: 'ACCEPTABLE' },
    { physicalRow: 4, externalIdentifier: '8486', title: 'Aviso alterado', status: 'NEEDS_REVIEW', reasons: ['CONTENT_CHANGED'] }], ...extra })
let api, auth
beforeEach(() => {
  auth = { stepUpPolicy: vi.fn().mockResolvedValue({ data: { mfaOptional: true } }), stepUp: vi.fn() }
  api = { stage: vi.fn().mockResolvedValue({ data: { importId: 'import-1' } }), review: vi.fn().mockResolvedValue({ data: review({ ACCEPTABLE: 1, NEEDS_REVIEW: 1 }) }), accept: vi.fn() }
})
afterEach(cleanup)
const ui = () => render(<MemoryRouter><CentralImportCatalog uploadId="file-1" sheetName="Sheet1" previewDigest={DIGEST} api={api} auth={auth} /></MemoryRouter>)

it('saves the candidates, then shows what would enter the Catálogo before anything is accepted', async () => {
  ui()
  expect(screen.queryByRole('button', { name: /Aceitar/ })).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Gravar candidatas' }))
  await screen.findByText(/1 novas · 0 já aceites · 1 a rever/)
  expect(api.stage).toHaveBeenCalledWith('file-1', { requestId: expect.any(String), sheetName: 'Sheet1', previewDigest: DIGEST })
  expect(api.review).toHaveBeenCalledWith('import-1')
  expect(api.accept).not.toHaveBeenCalled()
  expect(screen.getByText('CONTRATOS DE IMPACTO SOCIAL')).toBeTruthy()
  expect(screen.getByRole('button', { name: 'Aceitar 1 oportunidades novas no Catálogo' })).toBeTruthy()
})

it('accepts with the digest of the review, shows the result and reloads the review', async () => {
  api.accept.mockResolvedValue({ data: { created: 1, failed: [], skipped: { alreadyAccepted: 0, needsReview: 1, rejected: 0 } } })
  api.review.mockResolvedValueOnce({ data: review({ ACCEPTABLE: 1, NEEDS_REVIEW: 1 }) }).mockResolvedValueOnce({ data: review({ ALREADY_ACCEPTED: 1, NEEDS_REVIEW: 1 }) })
  ui()
  fireEvent.click(screen.getByRole('button', { name: 'Gravar candidatas' }))
  fireEvent.click(await screen.findByRole('button', { name: /Aceitar 1 oportunidades novas/ }))
  await screen.findByText(/1 oportunidades aceites/)
  expect(api.accept).toHaveBeenCalledWith('import-1', { batchDigest: 'b'.repeat(64) })
  expect(screen.getByRole('link', { name: 'Consultar o Catálogo' }).getAttribute('href')).toBe('/catalogo')
  await waitFor(() => expect(screen.getByRole('button', { name: 'Não há oportunidades novas' }).disabled).toBe(true))
})

it('says which rows failed, by code only', async () => {
  api.accept.mockResolvedValue({ data: { created: 0, failed: [{ physicalRow: 3, externalIdentifier: '8485', code: 'OPPORTUNITY_V2_STALE_REVISION' }], skipped: { alreadyAccepted: 0, needsReview: 0, rejected: 0 } } })
  ui()
  fireEvent.click(screen.getByRole('button', { name: 'Gravar candidatas' }))
  fireEvent.click(await screen.findByRole('button', { name: /Aceitar 1/ }))
  await screen.findByText(/1 falharam/)
  expect(screen.getByText('OPPORTUNITY_V2_STALE_REVISION')).toBeTruthy()
})

it('explains a stale review and a missing recent authentication, and writes nothing more', async () => {
  const refuse = code => ({ response: { status: 409, data: { error: { code } } } })
  api.accept.mockRejectedValueOnce(refuse('PT2030_BATCH_STALE')).mockRejectedValueOnce(refuse('PT2030_RECENT_AUTHENTICATION_REQUIRED'))
  ui()
  fireEvent.click(screen.getByRole('button', { name: 'Gravar candidatas' }))
  fireEvent.click(await screen.findByRole('button', { name: /Aceitar 1/ }))
  await screen.findByText(/O conteúdo mudou desde a revisão/)
  fireEvent.click(screen.getByRole('button', { name: /Aceitar 1/ }))
  await screen.findByText(/autenticação recente/)
})

it('keeps the same request id when saving is retried after an uncertain failure', async () => {
  api.stage.mockRejectedValueOnce({ response: { status: 503 } })
  ui()
  fireEvent.click(screen.getByRole('button', { name: 'Gravar candidatas' }))
  await screen.findByRole('alert')
  fireEvent.click(screen.getByRole('button', { name: 'Gravar candidatas' }))
  await screen.findByText(/1 novas/)
  expect(api.stage.mock.calls[0][1].requestId).toBe(api.stage.mock.calls[1][1].requestId)
})

// Regression: accepting with a login older than the policy allows only said "sign in again" and lost the screen. It now renews the
// authentication through the existing step-up and comes back to the same review.
it('offers to renew the authentication, returns to the same import and asks for the category the policy names', async () => {
  api.accept.mockRejectedValueOnce({ response: { status: 403, data: { error: { code: 'PT2030_RECENT_AUTHENTICATION_REQUIRED' } } } })
  ui()
  fireEvent.click(screen.getByRole('button', { name: 'Gravar candidatas' }))
  fireEvent.click(await screen.findByRole('button', { name: /Aceitar 1/ }))
  fireEvent.click(await screen.findByRole('button', { name: 'Renovar autenticação e continuar' }))
  await waitFor(() => expect(auth.stepUp).toHaveBeenCalledWith('recent-auth', '/administracao/importar?importacao=import-1'))
  auth.stepUpPolicy.mockResolvedValue({ data: { mfaOptional: false } })
  fireEvent.click(screen.getByRole('button', { name: 'Renovar autenticação e continuar' }))
  await waitFor(() => expect(auth.stepUp).toHaveBeenLastCalledWith('recent-mfa', '/administracao/importar?importacao=import-1'))
})

it('comes back to the saved review after the authentication is renewed, without uploading again', async () => {
  render(<MemoryRouter><CentralImportCatalog resumeImportId="import-1" api={api} auth={auth} /></MemoryRouter>)
  await screen.findByText(/1 novas · 0 já aceites · 1 a rever/)
  expect(api.review).toHaveBeenCalledWith('import-1'); expect(api.stage).not.toHaveBeenCalled()
  expect(screen.queryByRole('button', { name: 'Gravar candidatas' })).toBeNull()
  expect(screen.getByRole('button', { name: /Aceitar 1/ })).toBeTruthy()
})
