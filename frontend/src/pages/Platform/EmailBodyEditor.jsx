import { useEffect } from 'react'
import { EditorContent, useEditor, useEditorState } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { Bold, Italic, Link2, Link2Off, List, ListOrdered, Redo2, Underline, Undo2 } from 'lucide-react'
import { variableLabels } from './emailTemplatePresentation'

const ACTIVATION_LINK = '{LigacaoAtivacao}'

// Only the formatting the server keeps is offered, so what the administrator
// sees while writing is what survives sanitization.
const extensions = [
  StarterKit.configure({
    heading: { levels: [1, 2, 3] },
    blockquote: false,
    code: false,
    codeBlock: false,
    strike: false,
    horizontalRule: false,
    link: {
      openOnClick: false,
      autolink: false,
      protocols: ['https'],
      HTMLAttributes: { rel: null, target: null },
      isAllowedUri: url => url === ACTIVATION_LINK || /^https:\/\//i.test(url),
    },
  }),
]

function blockOf(editor) {
  for (const level of [1, 2, 3]) if (editor.isActive('heading', { level })) return String(level)
  return 'p'
}

export default function EmailBodyEditor({ value, onChange, variables = [], disabled = false, labelledBy }) {
  const editor = useEditor({
    extensions,
    content: value,
    editable: !disabled,
    editorProps: { attributes: { role: 'textbox', 'aria-multiline': 'true', 'aria-labelledby': labelledBy, class: 'email-editor-content' } },
    onUpdate: ({ editor: current }) => onChange(current.isEmpty ? '' : current.getHTML()),
  })
  const state = useEditorState({
    editor,
    selector: ({ editor: current }) => current ? {
      block: blockOf(current),
      bold: current.isActive('bold'),
      italic: current.isActive('italic'),
      underline: current.isActive('underline'),
      bullet: current.isActive('bulletList'),
      ordered: current.isActive('orderedList'),
      link: current.isActive('link'),
      undo: current.can().undo(),
      redo: current.can().redo(),
    } : null,
  })

  // A value set from outside (template loaded, reset) replaces the document.
  useEffect(() => {
    if (!editor) return
    const current = editor.isEmpty ? '' : editor.getHTML()
    if (value !== current) editor.commands.setContent(value || '', { emitUpdate: false })
  }, [editor, value])
  // Second argument false: locking the editor is not an edit and must not report one.
  useEffect(() => { editor?.setEditable(!disabled, false) }, [editor, disabled])

  if (!editor || !state) return null
  const run = command => command(editor.chain().focus()).run()
  const setBlock = block => run(chain => block === 'p' ? chain.setParagraph() : chain.setHeading({ level: Number(block) }))
  const addLink = () => {
    const url = window.prompt('Endereço da ligação (https://…)', 'https://')
    if (!url) return
    if (!/^https:\/\/\S+$/i.test(url.trim())) { window.alert('A ligação tem de começar por https://'); return }
    run(chain => chain.extendMarkRange('link').setLink({ href: url.trim() }))
  }
  const insertVariable = name => {
    if (name === 'LigacaoAtivacao') {
      run(chain => chain.insertContent(`<a href="${ACTIVATION_LINK}">Ativar acesso</a> `))
      return
    }
    run(chain => chain.insertContent(`{${name}}`))
  }
  const toggle = (label, active, Icon, action, enabled = true) => <button type="button" className="email-tool" aria-label={label} title={label} aria-pressed={active} disabled={disabled || !enabled} onClick={action}><Icon size={16} aria-hidden="true"/></button>

  return <div className="email-editor">
    <div className="email-toolbar" role="toolbar" aria-label="Formatação do corpo do email">
      <select aria-label="Estilo do parágrafo" value={state.block} disabled={disabled} onChange={event => setBlock(event.target.value)}>
        <option value="p">Parágrafo</option><option value="1">Título 1</option><option value="2">Título 2</option><option value="3">Título 3</option>
      </select>
      {toggle('Negrito', state.bold, Bold, () => run(chain => chain.toggleBold()))}
      {toggle('Itálico', state.italic, Italic, () => run(chain => chain.toggleItalic()))}
      {toggle('Sublinhado', state.underline, Underline, () => run(chain => chain.toggleUnderline()))}
      {toggle('Lista com marcadores', state.bullet, List, () => run(chain => chain.toggleBulletList()))}
      {toggle('Lista numerada', state.ordered, ListOrdered, () => run(chain => chain.toggleOrderedList()))}
      {toggle('Inserir ligação', state.link, Link2, addLink)}
      {toggle('Retirar ligação', false, Link2Off, () => run(chain => chain.extendMarkRange('link').unsetLink()), state.link)}
      {toggle('Anular', false, Undo2, () => run(chain => chain.undo()), state.undo)}
      {toggle('Refazer', false, Redo2, () => run(chain => chain.redo()), state.redo)}
    </div>
    <div className="email-variables" role="group" aria-label="Inserir variável">
      <span>Inserir</span>
      {variables.map(name => <button key={name} type="button" className="email-variable" disabled={disabled} onClick={() => insertVariable(name)}>{variableLabels[name] || name}</button>)}
    </div>
    <EditorContent editor={editor}/>
  </div>
}
