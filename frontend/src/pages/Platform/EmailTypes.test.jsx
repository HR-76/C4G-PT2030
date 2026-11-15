import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { EmailTypesView } from './EmailTypes'
import EmailTemplates from './EmailTemplates'

const emailApi = vi.hoisted(() => ({ types: vi.fn(), template: vi.fn() }))
vi.mock('../../api/api', () => ({ platformEmailApi: emailApi, platformDirectoryApi: { entities: vi.fn() } }))
vi.mock('../../contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 'u1' } }) }))
afterEach(() => { cleanup(); vi.clearAllMocks() })

const list = api => render(<MemoryRouter><EmailTypesView api={api}/></MemoryRouter>)
const row = name => screen.getByRole('row', { name: new RegExp(name) })

it('lists invitation and password reset without the discontinued email code', async () => {
  list({ types: vi.fn().mockResolvedValue({ data: { items: [{ type: 'member-invitation', globalCustomized: false, organizations: 0 }] } }) })
  const invitation = within(await screen.findByRole('row', { name: /Convite de colaborador/ }))
  expect(invitation.getByText('Texto original da plataforma')).toBeTruthy()
  expect(invitation.getByText('Global e por entidade')).toBeTruthy()
  expect(invitation.getByRole('link', { name: 'Configurar Convite de colaborador' }).getAttribute('href')).toBe('/administracao/email/member-invitation')
  for (const name of ['Reposição de palavra-passe']) {
    expect(within(row(name)).getByText('Ainda não configurável')).toBeTruthy()
    expect(within(row(name)).queryByRole('link')).toBeNull()
  }
  expect(within(row('Reposição de palavra-passe')).getByText('O texto é definido no serviço de autenticação.')).toBeTruthy()
  expect(screen.queryByText(/A reposição por email está (desligada|ativa)/)).toBeNull()
  expect(screen.getAllByRole('link')).toHaveLength(1)
  expect(screen.queryByText('Código por email')).toBeNull()
})

it('reports a changed global template and how many entities have their own', async () => {
  list({ types: vi.fn().mockResolvedValue({ data: { items: [{ type: 'member-invitation', globalCustomized: true, organizations: 2 }] } }) })
  const invitation = within(await screen.findByRole('row', { name: /Convite de colaborador/ }))
  expect(invitation.getByText('Template global alterado')).toBeTruthy()
  expect(invitation.getByText('2 entidades com template próprio')).toBeTruthy()
})

it('shows a refusal without rows and retries on request', async () => {
  const types = vi.fn()
    .mockRejectedValueOnce({ response: { status: 403, data: { error: { code: 'C4G_ADMIN_REQUIRED' } } } })
    .mockResolvedValue({ data: { items: [{ type: 'member-invitation', globalCustomized: false, organizations: 1 }] } })
  list({ types })
  expect((await screen.findByRole('alert')).textContent).toContain('Esta área está reservada à administração C4G.')
  expect(screen.queryByRole('table')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }))
  expect(within(await screen.findByRole('row', { name: /Convite de colaborador/ })).getByText('1 entidade com template próprio')).toBeTruthy()
})

it('does not open an editor for a type that cannot be configured', () => {
  for (const type of ['email-code', 'desconhecido']) {
    render(<MemoryRouter initialEntries={[`/administracao/email/${type}`]}><Routes><Route path="/administracao/email/:type" element={<EmailTemplates/>}/></Routes></MemoryRouter>)
    expect(screen.getByText('Este tipo de email ainda não é configurável.')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Voltar aos tipos de email' }).getAttribute('href')).toBe('/administracao/email')
    cleanup()
  }
  expect(emailApi.template).not.toHaveBeenCalled()
  expect(emailApi.types).not.toHaveBeenCalled()
})

it('offers password reset only with an affirmative server capability and keeps email code closed', async () => {
  list({ types: vi.fn().mockResolvedValue({ data: { items: [
    { type: 'password-reset', configurable: true, globalCustomized: true },
    { type: 'email-code', configurable: true },
  ] } }) })
  const reset = within(await screen.findByRole('row', { name: /Reposição de palavra-passe/ }))
  expect(reset.getByRole('link', { name: 'Configurar Reposição de palavra-passe' }).getAttribute('href')).toBe('/administracao/email/password-reset')
  expect(reset.getByText('Template global alterado')).toBeTruthy()
  expect(screen.queryByText('Código por email')).toBeNull()
})

const resetRoute = () => render(<MemoryRouter initialEntries={['/administracao/email/password-reset']}><Routes>
  <Route path="/administracao/email/:type" element={<EmailTemplates/>}/>
</Routes></MemoryRouter>)

it.each([undefined, false, 'true'])('refuses direct reset editing without explicit capability %s', async configurable => {
  emailApi.types.mockResolvedValue({ data: { items: configurable === undefined ? [] : [{ type: 'password-reset', configurable }] } })
  resetRoute()
  expect(await screen.findByText('Este tipo de email ainda não é configurável.')).toBeTruthy()
  expect(emailApi.template).not.toHaveBeenCalled()
})

it('checks reset capability before fetching the template and does not bypass a subsequent refusal', async () => {
  let resolveTypes
  emailApi.types.mockImplementation(() => new Promise(resolve => { resolveTypes = resolve }))
  emailApi.template.mockRejectedValue({ response: { status: 403, data: { error: { code: 'C4G_ADMIN_REQUIRED' } } } })
  resetRoute()
  expect(emailApi.template).not.toHaveBeenCalled()
  resolveTypes({ data: { items: [{ type: 'password-reset', configurable: true }] } })
  expect((await screen.findByRole('alert')).textContent).toContain('Esta área está reservada à administração C4G.')
  expect(emailApi.template).toHaveBeenCalledWith('password-reset', null, expect.any(AbortSignal))
  expect(screen.queryByLabelText('Assunto')).toBeNull()
})

it('does not fetch a reset template when capability lookup fails and can retry', async () => {
  emailApi.types.mockRejectedValueOnce({ response: { status: 503 } }).mockResolvedValue({ data: { items: [] } })
  resetRoute()
  expect((await screen.findByRole('alert')).textContent).toContain('Não foi possível concluir.')
  expect(emailApi.template).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }))
  expect(await screen.findByText('Este tipo de email ainda não é configurável.')).toBeTruthy()
  expect(emailApi.template).not.toHaveBeenCalled()
})
