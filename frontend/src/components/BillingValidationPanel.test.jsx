import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import BillingValidationPanel from './BillingValidationPanel'
afterEach(cleanup)
const account = { legalName: 'Entidade Norte', taxIdentifier: '501234567', taxCountry: 'PT', addressLine1: 'Rua guardada', locality: 'Porto', billingEmail: 'contabilidade@example.invalid' }
const data = { enabled: true, versionId: 'version-1', requestId: 'request-1', status: 'PENDING', account }
const response = data => Promise.resolve({ data })
it('requires a fresh review and an explicit confirmation of that exact version', async () => {
 const api = { validation: vi.fn(() => response(data)), confirmValidation: vi.fn(() => response({})) }
 render(<BillingValidationPanel api={api} organizationId="org"/>)
 fireEvent.click(await screen.findByRole('button', { name: 'Rever dados para confirmar' }))
 await screen.findByText('Rua guardada')
 expect(api.validation).toHaveBeenCalledTimes(2)
 expect(api.confirmValidation).not.toHaveBeenCalled()
 api.validation.mockImplementation(() => response({ ...data, status: 'CONFIRMED' }))
 fireEvent.click(screen.getByRole('button', { name: 'Confirmar dados' }))
 await screen.findByText('Dados confirmados pela entidade')
 expect(api.confirmValidation).toHaveBeenCalledWith({ versionId: 'version-1', requestId: 'request-1' })
})
it('sends only saved version and retains idempotency after uncertain delivery', async () => {
 const api = { validation: vi.fn(() => response({ ...data, status: 'NOT_REQUESTED' })), requestValidation: vi.fn(() => Promise.reject({ response: { status: 503 } })) }
 render(<BillingValidationPanel api={api} organizationId="org" admin/>)
 fireEvent.click(await screen.findByRole('button', { name: 'Rever dados e pedir validação' }))
 fireEvent.click(await screen.findByRole('button', { name: 'Pedir validação' }))
 await screen.findByRole('alert')
 fireEvent.click(screen.getByRole('button', { name: 'Pedir validação' }))
 await waitFor(() => expect(api.requestValidation).toHaveBeenCalledTimes(2))
 expect(api.requestValidation.mock.calls[0]).toEqual(api.requestValidation.mock.calls[1])
 expect(api.requestValidation.mock.calls[0][1]).toEqual({ versionId: 'version-1', requestKey: expect.any(String) })
})
it('does not confirm a changed version without another review', async () => {
 const api = { validation: vi.fn(() => response(data)), confirmValidation: vi.fn(() => Promise.reject({ response: { status: 409, data: { error: { code: 'STALE_REVISION' } } } })) }
 render(<BillingValidationPanel api={api} organizationId="org"/>)
 fireEvent.click(await screen.findByRole('button', { name: 'Rever dados para confirmar' }))
 fireEvent.click(await screen.findByRole('button', { name: 'Confirmar dados' }))
 expect((await screen.findByRole('alert')).textContent).toContain('Os dados foram alterados')
 expect(screen.queryByRole('button', { name: 'Confirmar dados' })).toBeNull()
})
it('never shows confirmation for a different organization in the email link', () => {
 const api = { validation: vi.fn() }
 render(<BillingValidationPanel api={api} organizationId="org-a" expectedOrganizationId="org-b"/>)
 expect(screen.getByText(/outra entidade/)).toBeTruthy()
 expect(api.validation).not.toHaveBeenCalled()
})
it('hides actions from read-only billing members', async () => {
 const api = { validation: vi.fn(() => Promise.reject({ response: { status: 403 } })) }
 render(<BillingValidationPanel api={api} organizationId="org"/>)
 await waitFor(() => expect(screen.queryByRole('region')).toBeNull())
})
it('ignores a late response when the selected entity changes', async () => {
 let resolve
 const api = { validation: vi.fn(org => org === 'a' ? new Promise(done => { resolve = done }) : response({ ...data, account: { ...account, legalName: 'Entidade B' }, status: 'CONFIRMED' })) }
 const view = render(<BillingValidationPanel api={api} organizationId="a" admin/>)
 view.rerender(<BillingValidationPanel api={api} organizationId="b" admin/>)
 await screen.findByText('Dados confirmados pela entidade')
 resolve({ data: { ...data, status: 'NOT_REQUESTED' } })
 await waitFor(() => expect(screen.queryByRole('button', { name: 'Rever dados e pedir validação' })).toBeNull())
})
