import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { EmailTemplatesView } from './EmailTemplates'
import { createEmailSimulation } from './emailTemplatesSimulation'
import { missingVariables, reasonList, removedSummary } from './emailTemplatePresentation'

vi.mock('../../api/api', () => ({ platformEmailApi: {}, platformDirectoryApi: {} }))
vi.mock('../../contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 'u1' } }) }))
afterEach(() => { cleanup(); vi.restoreAllMocks() })

const ORG = '11111111-1111-4111-8111-111111111111'
const BODY = '<p>Olá</p><p><a href="{LigacaoAtivacao}">Ativar</a></p><p>Expira em {Validade}.</p>'
const variables = { body: ['Organizacao', 'LigacaoAtivacao', 'Validade', 'Logotipo'], subject: ['Organizacao', 'Validade'], required: ['LigacaoAtivacao', 'Validade'] }
const template = (patch = {}) => ({ type: 'member-invitation', source: 'DEFAULT', subject: 'Ative o seu acesso', html: BODY, revision: 0, updatedAt: null, updatedBy: null, variables, logo: { source: 'C4G', url: null }, ...patch })

// Stands in for the rich text editor: these tests are about the page.
function PlainEditor({ value, onChange, variables: names, disabled, labelledBy }) {
  return <><textarea aria-labelledby={labelledBy} value={value} disabled={disabled} onChange={event => onChange(event.target.value)}/><span data-testid="variables">{names.join(',')}</span></>
}

function setup(overrides = {}) {
  const api = {
    template: vi.fn().mockResolvedValue({ data: template() }),
    save: vi.fn(), reset: vi.fn(), preview: vi.fn(), test: vi.fn(),
    logo: vi.fn().mockResolvedValue({ data: { url: null, revision: 0 } }),
    logoWrite: vi.fn().mockResolvedValue({ data: {} }), logoRemove: vi.fn().mockResolvedValue({ data: {} }),
    ...overrides,
  }
  const directoryApi = { entities: vi.fn().mockResolvedValue({ data: { items: [{ id: ORG, name: 'Associação A' }] } }) }
  render(<EmailTemplatesView api={api} directoryApi={directoryApi} Editor={PlainEditor}/>)
  return { api, directoryApi }
}
const body = () => screen.getByRole('textbox', { name: 'Corpo do email' })

it('loads the global template and offers only the variables the server lists', async () => {
  const { api } = setup()
  expect((await screen.findByLabelText('Assunto')).value).toBe('Ative o seu acesso')
  expect(api.template).toHaveBeenCalledWith('member-invitation', null, expect.any(AbortSignal))
  expect(body().value).toBe(BODY)
  expect(screen.getByTestId('variables').textContent).toBe('Organizacao,LigacaoAtivacao,Validade,Logotipo')
  expect(screen.getByText('Texto original da plataforma.')).toBeTruthy()
  expect(screen.getByRole('button', { name: 'Guardar' }).disabled).toBe(true)
  expect(screen.queryByRole('button', { name: 'Repor o texto original' })).toBeNull()
  expect(await screen.findByRole('img', { name: 'Logótipo da C4G nos emails' })).toBeTruthy()
})

it('saves with the loaded revision and reports what the server removed', async () => {
  const save = vi.fn().mockResolvedValue({ data: template({ source: 'GLOBAL', subject: 'Novo assunto', revision: 1, removed: ['script', 'p[style]'] }) })
  const { api } = setup({ save })
  fireEvent.change(await screen.findByLabelText('Assunto'), { target: { value: 'Novo assunto' } })
  fireEvent.click(screen.getByRole('button', { name: 'Guardar' }))
  await waitFor(() => expect(api.save).toHaveBeenCalledWith('member-invitation', null,
    { subject: 'Novo assunto', html: BODY, expectedRevision: 0, idempotencyKey: expect.any(String) }))
  expect((await screen.findByRole('status')).textContent).toBe('Template guardado. Foi retirado: código (script), formatação não suportada.')
  expect(screen.getByRole('button', { name: 'Repor o texto original' })).toBeTruthy()
  expect(screen.getByRole('button', { name: 'Guardar' }).disabled).toBe(true)
})

it('does not send a template without the activation link or the expiry', async () => {
  const { api } = setup()
  await screen.findByLabelText('Assunto')
  fireEvent.change(body(), { target: { value: '<p>Sem ligação</p>' } })
  expect(screen.getByText('Falta no corpo: Ligação de ativação, Validade da ligação.')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Guardar' }))
  const alert = await screen.findByRole('alert')
  expect(alert.textContent).toContain('Falta ligação de ativação no corpo do email.')
  expect(alert.textContent).toContain('Falta validade da ligação no corpo do email.')
  expect(api.save).not.toHaveBeenCalled()
})

it('shows the reasons the server gives when it refuses a template', async () => {
  const save = vi.fn().mockRejectedValue({ response: { status: 400, data: { error: { code: 'EMAIL_TEMPLATE_INVALID', reasons: [{ code: 'UNKNOWN_VARIABLE', variable: 'Nome' }] } } } })
  setup({ save })
  fireEvent.change(await screen.findByLabelText('Assunto'), { target: { value: 'Olá {Nome}' } })
  fireEvent.click(screen.getByRole('button', { name: 'Guardar' }))
  const alert = await screen.findByRole('alert')
  expect(alert.textContent).toContain('O template não pode ser guardado.')
  expect(alert.textContent).toContain('A variável {Nome} não existe.')
  expect(screen.getByLabelText('Assunto').value).toBe('Olá {Nome}')
})

it('tells the administrator to reload after a concurrent change', async () => {
  const save = vi.fn().mockRejectedValue({ response: { status: 409, data: { error: { code: 'STALE_REVISION' } } } })
  setup({ save })
  fireEvent.change(await screen.findByLabelText('Assunto'), { target: { value: 'Outro' } })
  fireEvent.click(screen.getByRole('button', { name: 'Guardar' }))
  expect((await screen.findByRole('alert')).textContent).toContain('O template foi alterado entretanto.')
})

it('previews the unsaved text in a sandboxed frame and as plain text', async () => {
  const preview = vi.fn().mockResolvedValue({ data: { subject: 'Assunto final', html: '<p>corpo final</p>', text: 'corpo final em texto', removed: ['img'] } })
  const { api } = setup({ preview })
  fireEvent.change(await screen.findByLabelText('Assunto'), { target: { value: 'Rascunho' } })
  fireEvent.click(screen.getByRole('button', { name: 'Pré-visualizar' }))
  const frame = await screen.findByTitle('Email em HTML')
  expect(api.preview).toHaveBeenCalledWith('member-invitation', null, { subject: 'Rascunho', html: BODY })
  expect(frame.getAttribute('sandbox')).toBe('allow-same-origin')
  expect(frame.getAttribute('srcdoc')).toBe('<p>corpo final</p>')
  expect(screen.getByText('Assunto final')).toBeTruthy()
  expect(screen.getByText('Ao guardar será retirado: imagens.')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Texto' }))
  expect(screen.getByLabelText('Email em texto simples').textContent).toBe('corpo final em texto')
  expect(api.save).not.toHaveBeenCalled()
})

it('sends a test to the signed-in administrator and reports each outcome', async () => {
  const test = vi.fn().mockResolvedValueOnce({ data: { status: 'ACCEPTED', to: 'admin@example.invalid' } }).mockResolvedValueOnce({ data: { status: 'NOT_CONFIGURED' } })
  const { api } = setup({ test })
  await screen.findByLabelText('Assunto')
  fireEvent.click(screen.getByRole('button', { name: 'Enviar teste para mim' }))
  expect((await screen.findByRole('status')).textContent).toBe('Email de teste enviado para admin@example.invalid.')
  expect(api.test).toHaveBeenCalledWith('member-invitation', null, { subject: 'Ative o seu acesso', html: BODY, idempotencyKey: expect.any(String) })
  fireEvent.click(screen.getByRole('button', { name: 'Enviar teste para mim' }))
  await waitFor(() => expect(screen.getByRole('status').textContent).toBe('O envio de email não está configurado neste ambiente.'))
})

it('switches to an entity, shows its own template and returns it to the global one', async () => {
  const own = template({ source: 'ORGANIZATION', subject: 'Convite da Associação A', revision: 3, updatedAt: '2026-11-12T10:00:00Z', updatedBy: 'Ana', logo: { source: 'ORGANIZATION', url: '/api/public/email-logos/abc' } })
  const templateRead = vi.fn().mockImplementation((type, scope) => Promise.resolve({ data: scope ? own : template() }))
  const reset = vi.fn().mockResolvedValue({ data: template({ source: 'GLOBAL', revision: 4 }) })
  const { api } = setup({ template: templateRead, reset })
  await screen.findByLabelText('Assunto')
  fireEvent.change(await screen.findByLabelText('Aplicar a'), { target: { value: ORG } })
  await waitFor(() => expect(screen.getByLabelText('Assunto').value).toBe('Convite da Associação A'))
  expect(api.template).toHaveBeenLastCalledWith('member-invitation', ORG, expect.any(AbortSignal))
  expect(screen.getByText('Template próprio desta entidade. Alterado em 12/11/26, 10:00 por Ana.')).toBeTruthy()
  expect(screen.getByRole('img', { name: 'Logótipo da entidade' }).getAttribute('src')).toBe('/api/public/email-logos/abc')
  expect(screen.queryByRole('button', { name: 'Carregar logótipo' })).toBeNull()

  fireEvent.click(screen.getByRole('button', { name: 'Usar o template global' }))
  expect(api.reset).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: 'Confirmar' }))
  await waitFor(() => expect(api.reset).toHaveBeenCalledWith('member-invitation', ORG, { expectedRevision: 3, idempotencyKey: expect.any(String) }))
  expect((await screen.findByRole('status')).textContent).toBe('A entidade voltou a usar o template global.')
  expect(screen.getByText('Esta entidade usa o template global.')).toBeTruthy()
})

it('asks before discarding unsaved changes when the scope changes', async () => {
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
  const { api } = setup()
  fireEvent.change(await screen.findByLabelText('Assunto'), { target: { value: 'Por guardar' } })
  fireEvent.change(await screen.findByLabelText('Aplicar a'), { target: { value: ORG } })
  expect(confirm).toHaveBeenCalledOnce()
  expect(api.template).toHaveBeenCalledTimes(1)
  expect(screen.getByLabelText('Assunto').value).toBe('Por guardar')
})

it('shows a denial without leaving a stale template on screen', async () => {
  setup({ template: vi.fn().mockRejectedValue({ response: { status: 403, data: { error: { code: 'C4G_ADMIN_REQUIRED' } } } }) })
  expect((await screen.findByRole('alert')).textContent).toContain('Esta área está reservada à administração C4G.')
  expect(screen.queryByLabelText('Assunto')).toBeNull()
  expect(screen.getByRole('button', { name: 'Tentar novamente' })).toBeTruthy()
})

it('uploads a C4G logo only when the file is an acceptable image', async () => {
  const { api } = setup({ logo: vi.fn().mockResolvedValue({ data: { url: '/api/public/email-logos/c4g', revision: 2 } }) })
  const input = await screen.findByLabelText('Ficheiro do logótipo da C4G')
  await waitFor(() => expect(screen.getByRole('button', { name: 'Carregar logótipo' }).disabled).toBe(false))
  fireEvent.change(input, { target: { files: [new File(['<svg/>'], 'logo.svg', { type: 'image/svg+xml' })] } })
  expect((await screen.findByRole('alert')).textContent).toBe('O ficheiro não é uma imagem PNG ou JPEG válida.')
  fireEvent.change(input, { target: { files: [new File([new Uint8Array(512 * 1024 + 1)], 'logo.png', { type: 'image/png' })] } })
  await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('A imagem excede 512 KB.'))
  expect(api.logoWrite).not.toHaveBeenCalled()
  const file = new File([new Uint8Array(10)], 'logo.png', { type: 'image/png' })
  fireEvent.change(input, { target: { files: [file] } })
  await waitFor(() => expect(api.logoWrite).toHaveBeenCalledWith(file, 2))
  fireEvent.click(await screen.findByRole('button', { name: 'Repor o logótipo original' }))
  await waitFor(() => expect(api.logoRemove).toHaveBeenCalledWith(2))
})

it('explains problems and removed markup in plain words', () => {
  expect(missingVariables('<p>{Validade}</p>', ['LigacaoAtivacao', 'Validade'])).toEqual(['LigacaoAtivacao'])
  expect(reasonList([{ code: 'VARIABLE_NOT_ALLOWED_IN_SUBJECT', variable: 'Logotipo' }, { code: 'OUTRO' }]))
    .toEqual(['A variável {Logotipo} não pode ser usada no assunto.', 'O template tem um problema por corrigir.'])
  expect(removedSummary(['a[href]', 'iframe', 'p[onclick]', 'p[style]', 'table'])).toEqual(
    ['ligações que não são https', 'conteúdo incorporado', 'formatação não suportada', 'elemento table'])
})

it('the development simulation enforces the same save rules as the contract', async () => {
  const { api } = createEmailSimulation()
  const initial = (await api.template('member-invitation', null)).data
  expect(initial.source).toBe('DEFAULT')
  await expect(api.save('member-invitation', null, { subject: 'x', html: '<p>sem variáveis</p>', expectedRevision: 0 }))
    .rejects.toMatchObject({ response: { data: { error: { code: 'EMAIL_TEMPLATE_INVALID' } } } })
  const saved = (await api.save('member-invitation', null, { subject: 'Novo', html: BODY + '<script>x</script><p onclick="y">z</p>', expectedRevision: 0 })).data
  expect(saved).toMatchObject({ source: 'GLOBAL', revision: 1, removed: ['p[onclick]', 'script'] })
  expect(saved.html).toBe(BODY + '<p>z</p>')
  expect((await api.template('member-invitation', ORG)).data.source).toBe('GLOBAL')
  await expect(api.save('member-invitation', null, { subject: 'Novo', html: BODY, expectedRevision: 0 }))
    .rejects.toMatchObject({ response: { status: 409 } })
  const preview = (await api.preview('member-invitation', ORG, { subject: 'Olá {Organizacao}', html: BODY })).data
  expect(preview.subject).toBe('Olá Associação Exemplo A')
  expect(preview.text).toContain('Ativar: https://exemplo.invalid/ativacao-de-exemplo')
})
