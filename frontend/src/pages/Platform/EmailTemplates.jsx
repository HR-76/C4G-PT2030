import { useEffect, useId, useRef, useState } from 'react'
import { Eye, RotateCcw, Save, Send, Trash2, Upload } from 'lucide-react'
import LoadingIndicator from '../../components/LoadingIndicator'
import SearchInput from '../../components/SearchInput'
import { platformDirectoryApi, platformEmailApi } from '../../api/api'
import { useAuth } from '../../contexts/AuthContext'
import EmailBodyEditor from './EmailBodyEditor'
import {
  emailError, emailTypes, errorReasons, formatInstant, limits, missingVariables,
  reasonList, removedSummary, testStatus, variableLabels,
} from './emailTemplatePresentation'
import './email-templates.css'

const TYPE = 'member-invitation'
const LOGO_BYTES = 512 * 1024

export default function EmailTemplates() {
  const { user } = useAuth()
  return <EmailTemplatesView key={user?.id}/>
}

function sourceText(data, scope) {
  if (data.source === 'DEFAULT') return scope ? 'Esta entidade usa o texto original da plataforma.' : 'Texto original da plataforma.'
  if (scope && data.source === 'GLOBAL') return 'Esta entidade usa o template global.'
  const who = data.updatedBy ? ` por ${data.updatedBy}` : ''
  const when = data.updatedAt ? ` Alterado em ${formatInstant(data.updatedAt)}${who}.` : ''
  return `${scope ? 'Template próprio desta entidade.' : 'Template global.'}${when}`
}

export function EmailTemplatesView({ api = platformEmailApi, directoryApi = platformDirectoryApi, Editor = EmailBodyEditor }) {
  const [scope, setScope] = useState(''), [entities, setEntities] = useState([]), [entityQuery, setEntityQuery] = useState('')
  const [data, setData] = useState(null), [form, setForm] = useState({ subject: '', html: '' })
  const [busy, setBusy] = useState(true), [working, setWorking] = useState(''), [reload, setReload] = useState(0)
  const [error, setError] = useState(''), [problems, setProblems] = useState([]), [notice, setNotice] = useState('')
  const [preview, setPreview] = useState(null), [previewPart, setPreviewPart] = useState('html'), [confirmReset, setConfirmReset] = useState(false)
  const generation = useRef(0), bodyLabel = useId()

  const findEntities = async event => {
    event?.preventDefault()
    try {
      const { data: found } = await directoryApi.entities({ ...(entityQuery.trim() ? { q: entityQuery.trim() } : {}), status: 'ACTIVE', page: 1 })
      setEntities(found.items)
    } catch (reason) {
      setError(emailError(reason))
    }
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- Runs once on entry; later searches are explicit.
  useEffect(() => { findEntities() }, [])

  useEffect(() => {
    const epoch = ++generation.current, controller = new AbortController()
    setBusy(true); setError(''); setProblems([]); setPreview(null); setConfirmReset(false)
    api.template(TYPE, scope || null, controller.signal)
      .then(response => {
        if (epoch !== generation.current) return
        setData(response.data)
        setForm({ subject: response.data.subject, html: response.data.html })
      })
      .catch(reason => {
        if (epoch !== generation.current || reason?.code === 'ERR_CANCELED') return
        setData(null)
        setError(emailError(reason))
      })
      .finally(() => { if (epoch === generation.current) setBusy(false) })
    return () => { generation.current += 1; controller.abort() }
  }, [api, scope, reload])

  const dirty = Boolean(data) && (form.subject !== data.subject || form.html !== data.html)
  const required = data?.variables?.required || []
  const missing = missingVariables(form.html, required)
  const ownTemplate = Boolean(data) && data.source === (scope ? 'ORGANIZATION' : 'GLOBAL')
  const locked = busy || Boolean(working)

  const changeScope = value => {
    if (dirty && !window.confirm('Tem alterações por guardar. Quer descartá-las?')) return
    setNotice(''); setScope(value)
  }
  const edit = patch => { setForm(old => ({ ...old, ...patch })); setNotice(''); setProblems([]) }

  const command = async (name, action) => {
    setWorking(name); setError(''); setProblems([]); setNotice('')
    try {
      await action()
    } catch (reason) {
      setError(emailError(reason))
      setProblems(errorReasons(reason))
    } finally {
      setWorking('')
    }
  }
  const showPreview = () => command('preview', async () => {
    const response = await api.preview(TYPE, scope || null, form)
    setPreview(response.data)
  })
  const save = event => {
    event.preventDefault()
    if (missing.length) {
      setError(emailError({ response: { data: { error: { code: 'EMAIL_TEMPLATE_INVALID' } } } }))
      setProblems(reasonList(missing.map(variable => ({ code: 'REQUIRED_VARIABLE_MISSING', variable }))))
      return
    }
    command('save', async () => {
      const response = await api.save(TYPE, scope || null, { ...form, expectedRevision: data.revision, idempotencyKey: crypto.randomUUID() })
      setData(response.data)
      setForm({ subject: response.data.subject, html: response.data.html })
      setPreview(null)
      const removed = removedSummary(response.data.removed)
      setNotice(removed.length ? `Template guardado. Foi retirado: ${removed.join(', ')}.` : 'Template guardado.')
    })
  }
  const sendTest = () => command('test', async () => {
    const response = await api.test(TYPE, scope || null, { ...form, idempotencyKey: crypto.randomUUID() })
    setNotice((testStatus[response.data.status] || testStatus.UNCONFIRMED)(response.data.to))
  })
  const reset = () => command('reset', async () => {
    const response = await api.reset(TYPE, scope || null, { expectedRevision: data.revision, idempotencyKey: crypto.randomUUID() })
    setData(response.data)
    setForm({ subject: response.data.subject, html: response.data.html })
    setPreview(null); setConfirmReset(false)
    setNotice(scope ? 'A entidade voltou a usar o template global.' : 'O template global voltou ao texto original.')
  })

  return <div className="page email-templates">
    <header className="email-heading"><h1>Email</h1></header>

    <section className="email-panel" aria-label="Template de email">
      <div className="email-scope">
        <label>Tipo de email<select value={TYPE} disabled><option value={TYPE}>{emailTypes[TYPE]}</option></select></label>
        <label>Aplicar a<select value={scope} disabled={locked} onChange={event => changeScope(event.target.value)}>
          <option value="">Todas as entidades (global)</option>
          {entities.map(entity => <option key={entity.id} value={entity.id}>{entity.name}</option>)}
        </select></label>
        <form className="email-entity-search" role="search" onSubmit={findEntities}>
          <label>Procurar entidade<SearchInput value={entityQuery} maxLength={120} placeholder="Nome ou NIF" onChange={event => setEntityQuery(event.target.value)}/></label>
          <button className="btn btn-secondary" type="submit">Procurar</button>
        </form>
      </div>

      {busy && <LoadingIndicator>A carregar o template…</LoadingIndicator>}
      {error && <div className="alert alert-error" role="alert">{error}
        {problems.length > 0 && <ul>{problems.map(problem => <li key={problem}>{problem}</li>)}</ul>}
        {!data && !busy && <button className="btn btn-outline" onClick={() => setReload(value => value + 1)}>Tentar novamente</button>}
      </div>}
      {notice && <p className="alert alert-success" role="status">{notice}</p>}

      {data && !busy && <div className="email-workspace">
        <form className="email-form" onSubmit={save} aria-label="Editar template">
          <p className="email-source">{sourceText(data, scope)}</p>
          <label className="email-field">Assunto
            <input value={form.subject} maxLength={limits.subject} required disabled={locked} onChange={event => edit({ subject: event.target.value })}/>
          </label>
          <div className="email-field">
            <span id={bodyLabel}>Corpo do email</span>
            <Editor value={form.html} variables={data.variables?.body || []} disabled={locked} labelledBy={bodyLabel} onChange={html => edit({ html })}/>
          </div>
          {missing.length > 0 && <p className="email-missing" role="status">Falta no corpo: {missing.map(name => variableLabels[name] || name).join(', ')}.</p>}
          <div className="email-actions">
            <button className="btn btn-primary" type="submit" disabled={locked || !dirty} aria-busy={working === 'save'}><Save size={16} aria-hidden="true"/>Guardar</button>
            <button className="btn btn-outline" type="button" disabled={locked} aria-busy={working === 'preview'} onClick={showPreview}><Eye size={16} aria-hidden="true"/>Pré-visualizar</button>
            <button className="btn btn-outline" type="button" disabled={locked} aria-busy={working === 'test'} onClick={sendTest}><Send size={16} aria-hidden="true"/>Enviar teste para mim</button>
            {ownTemplate && !confirmReset && <button className="btn btn-secondary" type="button" disabled={locked} onClick={() => setConfirmReset(true)}><RotateCcw size={16} aria-hidden="true"/>{scope ? 'Usar o template global' : 'Repor o texto original'}</button>}
          </div>
          {confirmReset && <div className="email-confirm" role="group" aria-label="Confirmar reposição">
            <p>{scope ? 'A entidade deixa de ter template próprio e passa a usar o global.' : 'O template global volta ao texto original da plataforma.'} As versões anteriores ficam guardadas.</p>
            <button className="btn btn-danger" type="button" disabled={locked} aria-busy={working === 'reset'} onClick={reset}>Confirmar</button>
            <button className="btn btn-secondary" type="button" disabled={locked} onClick={() => setConfirmReset(false)}>Cancelar</button>
          </div>}
        </form>

        <aside className="email-side">
          <section className="email-preview" aria-label="Pré-visualização">
            <header><h2>Pré-visualização</h2>
              {preview && <div role="group" aria-label="Versão a mostrar">
                <button type="button" className="email-part" aria-pressed={previewPart === 'html'} onClick={() => setPreviewPart('html')}>HTML</button>
                <button type="button" className="email-part" aria-pressed={previewPart === 'text'} onClick={() => setPreviewPart('text')}>Texto</button>
              </div>}
            </header>
            {!preview && <p className="email-preview-empty">Use «Pré-visualizar» para ver o email com dados de exemplo.</p>}
            {preview && <>
              <p className="email-preview-subject"><span>Assunto</span>{preview.subject}</p>
              {removedSummary(preview.removed).length > 0 && <p className="alert alert-warn" role="status">Ao guardar será retirado: {removedSummary(preview.removed).join(', ')}.</p>}
              {previewPart === 'html'
                ? <iframe title="Email em HTML" sandbox="" srcDoc={preview.html}/>
                : <pre tabIndex={0} aria-label="Email em texto simples">{preview.text}</pre>}
            </>}
          </section>
          {scope
            ? <EntityLogo logo={data.logo}/>
            : <PlatformLogo api={api} disabled={locked}/>}
        </aside>
      </div>}
    </section>
  </div>
}

function EntityLogo({ logo }) {
  const own = logo?.source === 'ORGANIZATION' && logo.url
  return <section className="email-logo" aria-label="Logótipo da entidade">
    <h2>Logótipo da entidade</h2>
    {own ? <img src={logo.url} alt="Logótipo da entidade"/> : <p>A entidade ainda não carregou um logótipo. Os emails levam o da C4G.</p>}
    <p className="email-logo-note">É carregado pelo Admin da entidade, na ficha da entidade.</p>
  </section>
}

function PlatformLogo({ api, disabled }) {
  const [logo, setLogo] = useState(null), [busy, setBusy] = useState(true), [error, setError] = useState(''), [reload, setReload] = useState(0)
  const input = useRef(null)
  useEffect(() => {
    let active = true; const controller = new AbortController()
    setBusy(true)
    api.logo(controller.signal)
      .then(response => { if (active) { setLogo(response.data); setError('') } })
      .catch(reason => { if (active && reason?.code !== 'ERR_CANCELED') setError(emailError(reason)) })
      .finally(() => { if (active) setBusy(false) })
    return () => { active = false; controller.abort() }
  }, [api, reload])
  const change = async action => {
    setBusy(true); setError('')
    try {
      await action()
      setReload(value => value + 1)
    } catch (reason) {
      setError(emailError(reason)); setBusy(false)
    }
  }
  const choose = event => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    if (!['image/png', 'image/jpeg'].includes(file.type)) { setError(emailError({ response: { data: { error: { code: 'EMAIL_LOGO_INVALID' } } } })); return }
    if (file.size > LOGO_BYTES) { setError(emailError({ response: { data: { error: { code: 'EMAIL_LOGO_TOO_LARGE' } } } })); return }
    change(() => api.logoWrite(file, logo?.revision ?? 0))
  }
  return <section className="email-logo" aria-label="Logótipo da C4G">
    <h2>Logótipo da C4G</h2>
    {logo && <img src={logo.url || '/logo-c4g.png'} alt="Logótipo da C4G nos emails"/>}
    {error && <p className="alert alert-error" role="alert">{error}</p>}
    <p className="email-logo-note">PNG ou JPEG, até 512 KB e 1200 × 600 píxeis.</p>
    <div className="email-actions">
      <input ref={input} type="file" accept="image/png,image/jpeg" className="sr-only" aria-label="Ficheiro do logótipo da C4G" onChange={choose}/>
      <button className="btn btn-outline" type="button" disabled={disabled || busy || !logo} onClick={() => input.current?.click()}><Upload size={16} aria-hidden="true"/>Carregar logótipo</button>
      {logo?.url && <button className="btn btn-secondary" type="button" disabled={disabled || busy} onClick={() => change(() => api.logoRemove(logo.revision))}><Trash2 size={16} aria-hidden="true"/>Repor o logótipo original</button>}
    </div>
  </section>
}
