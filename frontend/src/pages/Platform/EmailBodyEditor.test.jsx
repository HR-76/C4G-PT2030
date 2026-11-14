import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import EmailBodyEditor from './EmailBodyEditor'

afterEach(() => { cleanup(); vi.restoreAllMocks() })

// jsdom has no layout. The editor asks for these when it scrolls the caret into view.
for (const prototype of [Range.prototype, Text.prototype]) {
  prototype.getClientRects ||= () => []
  prototype.getBoundingClientRect ||= () => ({ top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 })
}

const variables = ['Organizacao', 'LigacaoAtivacao', 'Validade', 'Logotipo']
function setup(value = '<p>Olá</p>') {
  const onChange = vi.fn()
  const view = render(<><span id="body-label">Corpo do email</span><EmailBodyEditor value={value} variables={variables} labelledBy="body-label" onChange={onChange}/></>)
  return { onChange, ...view }
}
const last = onChange => onChange.mock.calls.at(-1)[0]

it('shows the stored text and offers only the supported formatting', async () => {
  setup('<h2>Título</h2><p>Olá <strong>mundo</strong></p>')
  const editor = await screen.findByRole('textbox', { name: 'Corpo do email' })
  expect(editor.innerHTML).toContain('<h2>Título</h2>')
  expect(editor.innerHTML).toContain('<strong>mundo</strong>')
  const tools = screen.getAllByRole('button').map(button => button.getAttribute('aria-label') || button.textContent)
  expect(tools).toEqual(['Negrito', 'Itálico', 'Sublinhado', 'Lista com marcadores', 'Lista numerada', 'Inserir ligação', 'Retirar ligação', 'Anular', 'Refazer',
    'Nome da entidade', 'Ligação de ativação', 'Validade da ligação', 'Logótipo'])
  expect([...screen.getByLabelText('Estilo do parágrafo').options].map(option => option.textContent)).toEqual(['Parágrafo', 'Título 1', 'Título 2', 'Título 3'])
})

it('inserts variables as text and the activation link as a link', async () => {
  const { onChange } = setup()
  await screen.findByRole('textbox', { name: 'Corpo do email' })
  fireEvent.click(screen.getByRole('button', { name: 'Nome da entidade' }))
  await waitFor(() => expect(last(onChange)).toContain('{Organizacao}'))
  fireEvent.click(screen.getByRole('button', { name: 'Ligação de ativação' }))
  await waitFor(() => expect(last(onChange)).toContain('<a href="{LigacaoAtivacao}">Ativar acesso</a>'))
})

it('drops markup the server would refuse when it is pasted in as content', async () => {
  const { onChange } = setup('<p>Texto</p><script>alert(1)</script><img src="https://example.test/x.png"><p><a href="javascript:alert(1)">mau</a> <a href="https://example.test/">bom</a></p>')
  const editor = await screen.findByRole('textbox', { name: 'Corpo do email' })
  expect(editor.querySelector('script,img')).toBeNull()
  expect([...editor.querySelectorAll('a')].map(link => link.getAttribute('href'))).toEqual(['https://example.test/'])
  fireEvent.click(screen.getByRole('button', { name: 'Validade da ligação' }))
  await waitFor(() => expect(last(onChange)).toContain('{Validade}'))
  expect(last(onChange)).not.toMatch(/script|img|javascript/)
})

it('replaces the document when a new value arrives and locks when disabled', async () => {
  const onChange = vi.fn()
  const view = render(<EmailBodyEditor value="<p>Primeiro</p>" variables={variables} onChange={onChange}/>)
  const editor = await screen.findByRole('textbox')
  view.rerender(<EmailBodyEditor value="<p>Segundo</p>" variables={variables} disabled onChange={onChange}/>)
  await waitFor(() => expect(editor.textContent).toBe('Segundo'))
  expect(editor.getAttribute('contenteditable')).toBe('false')
  expect(screen.getByRole('button', { name: 'Negrito' }).disabled).toBe(true)
  expect(onChange).not.toHaveBeenCalled()
})
