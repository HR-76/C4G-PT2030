import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { EmailTypesView } from './EmailTypes'
import EmailTemplates from './EmailTemplates'

const emailApi = vi.hoisted(() => ({ template: vi.fn() }))
vi.mock('../../api/api', () => ({ platformEmailApi: emailApi, platformDirectoryApi: { entities: vi.fn() } }))
vi.mock('../../contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 'u1' } }) }))
afterEach(() => { cleanup(); vi.clearAllMocks() })

const list = api => render(<MemoryRouter><EmailTypesView api={api}/></MemoryRouter>)
const row = name => screen.getByRole('row', { name: new RegExp(name) })

it('lists the three email types and lets only the invitation be configured', async () => {
  list({ types: vi.fn().mockResolvedValue({ data: { items: [{ type: 'member-invitation', globalCustomized: false, organizations: 0 }] } }) })
  const invitation = within(await screen.findByRole('row', { name: /Convite de colaborador/ }))
  expect(invitation.getByText('Texto original da plataforma')).toBeTruthy()
  expect(invitation.getByText('Global e por entidade')).toBeTruthy()
  expect(invitation.getByRole('link', { name: 'Configurar Convite de colaborador' }).getAttribute('href')).toBe('/administracao/email/member-invitation')
  for (const name of ['Reposição de palavra-passe', 'Código por email']) {
    expect(within(row(name)).getByText('Ainda não configurável')).toBeTruthy()
    expect(within(row(name)).queryByRole('link')).toBeNull()
  }
  expect(within(row('Reposição de palavra-passe')).getByText(/desligada/)).toBeTruthy()
  expect(screen.getAllByRole('link')).toHaveLength(1)
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
  for (const type of ['password-reset', 'desconhecido']) {
    render(<MemoryRouter initialEntries={[`/administracao/email/${type}`]}><Routes><Route path="/administracao/email/:type" element={<EmailTemplates/>}/></Routes></MemoryRouter>)
    expect(screen.getByText('Este tipo de email ainda não é configurável.')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Voltar aos tipos de email' }).getAttribute('href')).toBe('/administracao/email')
    cleanup()
  }
  expect(emailApi.template).not.toHaveBeenCalled()
})
