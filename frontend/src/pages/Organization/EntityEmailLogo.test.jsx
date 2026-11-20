import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import EntityEmailLogo, { logoError } from './EntityEmailLogo'

afterEach(cleanup)

const coded = (code, status = 409) => ({ response: { status, data: { error: { code } } } })
function setup(overrides = {}) {
  const api = {
    emailLogo: vi.fn().mockResolvedValue({ data: { url: null, revision: 0, updatedAt: null } }),
    emailLogoWrite: vi.fn().mockResolvedValue({ data: { url: '/api/public/email-logos/abc', revision: 1, updatedAt: '2026-11-14T10:00:00.000Z' } }),
    emailLogoRemove: vi.fn().mockResolvedValue({ data: { url: null, revision: 2, updatedAt: null } }),
    ...overrides,
  }
  render(<EntityEmailLogo api={api}/>)
  return api
}
const pick = file => fireEvent.change(screen.getByLabelText('Ficheiro do logótipo da entidade'), { target: { files: [file] } })
const image = (size = 10, type = 'image/png', name = 'logo.png') => new File([new Uint8Array(size)], name, { type })

it('without a logo it says the C4G one is used and offers the upload', async () => {
  setup()
  expect(await screen.findByText('A entidade ainda não carregou um logótipo.')).toBeTruthy()
  expect(screen.getByRole('heading', { name: 'Logótipo nos emails' })).toBeTruthy()
  expect(screen.getByRole('button', { name: 'Carregar logótipo' }).disabled).toBe(false)
  expect(screen.queryByRole('button', { name: 'Remover logótipo' })).toBeNull()
  expect(screen.queryByRole('img')).toBeNull()
})

it('uploads with the loaded revision and shows the stored image', async () => {
  const api = setup()
  await screen.findByText('A entidade ainda não carregou um logótipo.')
  const file = image()
  pick(file)
  await waitFor(() => expect(api.emailLogoWrite).toHaveBeenCalledWith(file, 0))
  expect((await screen.findByRole('img', { name: 'Logótipo da entidade nos emails' })).getAttribute('src')).toBe('/api/public/email-logos/abc')
  expect(screen.getByRole('status').textContent).toBe('Logótipo guardado.')
  expect(screen.getByRole('button', { name: 'Substituir logótipo' })).toBeTruthy()
  // The next change carries the revision the server answered with.
  fireEvent.click(screen.getByRole('button', { name: 'Remover logótipo' }))
  await waitFor(() => expect(api.emailLogoRemove).toHaveBeenCalledWith(1))
  expect(await screen.findByText('A entidade ainda não carregou um logótipo.')).toBeTruthy()
  expect(screen.getByRole('status').textContent).toBe('Logótipo removido. Os emails voltam a levar o da C4G.')
  expect(api.emailLogo).toHaveBeenCalledTimes(1)
})

it('refuses a file that is not an acceptable image before asking the server', async () => {
  const api = setup()
  await screen.findByText('A entidade ainda não carregou um logótipo.')
  pick(image(10, 'image/svg+xml', 'logo.svg'))
  expect(screen.getByRole('alert').textContent).toBe('O ficheiro não é uma imagem PNG ou JPEG válida.')
  pick(image(512 * 1024 + 1))
  expect(screen.getByRole('alert').textContent).toBe('A imagem excede 512 KB.')
  expect(api.emailLogoWrite).not.toHaveBeenCalled()
})

it('reports a server refusal and reloads the current logo after a stale revision', async () => {
  const api = setup({
    emailLogo: vi.fn().mockResolvedValueOnce({ data: { url: null, revision: 0, updatedAt: null } })
      .mockResolvedValue({ data: { url: '/api/public/email-logos/outro', revision: 3, updatedAt: null } }),
    emailLogoWrite: vi.fn().mockRejectedValueOnce(coded('STALE_REVISION')).mockRejectedValueOnce(coded('EMAIL_LOGO_DIMENSIONS', 400)),
  })
  await screen.findByText('A entidade ainda não carregou um logótipo.')
  pick(image())
  expect((await screen.findByRole('alert')).textContent).toMatch(/alterado entretanto/)
  expect((await screen.findByRole('img')).getAttribute('src')).toBe('/api/public/email-logos/outro')
  expect(api.emailLogo).toHaveBeenCalledTimes(2)
  const file = image()
  pick(file)
  await waitFor(() => expect(api.emailLogoWrite).toHaveBeenLastCalledWith(file, 3))
  await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('A imagem excede 1200 × 600 píxeis.'))
  expect(api.emailLogo).toHaveBeenCalledTimes(2)
  expect(screen.getByRole('button', { name: 'Substituir logótipo' }).disabled).toBe(false)
})

it('keeps the buttons off when the logo cannot be read', async () => {
  setup({ emailLogo: vi.fn().mockRejectedValue(coded('NOT_AUTHORIZED', 403)) })
  expect((await screen.findByRole('alert')).textContent).toBe('Só o Administrador da entidade pode alterar o logótipo.')
  expect(screen.getByRole('button', { name: 'Carregar logótipo' }).disabled).toBe(true)
})

it('turns each server code into a plain message', () => {
  expect(logoError(coded('EMAIL_LOGO_NOT_SET'))).toBe('A entidade já não tem logótipo próprio.')
  expect(logoError(coded('OPERATION_NOT_AVAILABLE', 405))).toBe('Esta função ainda não está disponível.')
  expect(logoError(coded('OUTRO', 403))).toBe('Só o Administrador da entidade pode alterar o logótipo.')
  expect(logoError({ response: { status: 413, data: {} } })).toBe('A imagem excede 512 KB.')
  expect(logoError({ response: { status: 401, data: {} } })).toBe('Sessão expirada. Inicie sessão novamente.')
  expect(logoError(new Error('network'))).toBe('Não foi possível concluir. Tente novamente.')
})
