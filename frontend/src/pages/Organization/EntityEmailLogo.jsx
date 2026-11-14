import { useEffect, useRef, useState } from 'react'
import { ImageIcon, Trash2, Upload } from 'lucide-react'
import './entity-profile.css'

// The same limits the server enforces from the bytes; checked here only to answer sooner.
const LOGO_BYTES = 512 * 1024
const LOGO_TYPES = ['image/png', 'image/jpeg']

export function logoError(error) {
  const status = error?.response?.status, code = error?.response?.data?.error?.code
  const messages = {
    EMAIL_LOGO_INVALID: 'O ficheiro não é uma imagem PNG ou JPEG válida.',
    EMAIL_LOGO_TOO_LARGE: 'A imagem excede 512 KB.',
    EMAIL_LOGO_DIMENSIONS: 'A imagem excede 1200 × 600 píxeis.',
    EMAIL_LOGO_NOT_SET: 'A entidade já não tem logótipo próprio.',
    STALE_REVISION: 'O logótipo foi alterado entretanto. Foi carregada a versão atual; repita a ação.',
    STATE_CONFLICT: 'O logótipo foi alterado entretanto. Foi carregada a versão atual; repita a ação.',
    IDEMPOTENCY_CONFLICT: 'Este pedido já foi usado com dados diferentes. Repita a ação.',
    NOT_AUTHORIZED: 'Só o Administrador da entidade pode alterar o logótipo.',
    OPERATION_NOT_AVAILABLE: 'Esta função ainda não está disponível.',
  }
  if (messages[code]) return messages[code]
  if (status === 401) return 'Sessão expirada. Inicie sessão novamente.'
  if (status === 403) return messages.NOT_AUTHORIZED
  if (status === 413) return messages.EMAIL_LOGO_TOO_LARGE
  return 'Não foi possível concluir. Tente novamente.'
}

// The entity's own logo for the emails sent on its behalf. Shown only to the entity's administrator; the server
// decides again on every request, from the session, who may read or change it.
export default function EntityEmailLogo({ api }) {
  const [logo, setLogo] = useState(null), [busy, setBusy] = useState(true), [error, setError] = useState(''), [notice, setNotice] = useState(''), [reload, setReload] = useState(0)
  const input = useRef(null)
  useEffect(() => {
    let active = true; const controller = new AbortController()
    setBusy(true)
    api.emailLogo(controller.signal)
      .then(response => { if (active) setLogo(response.data) })
      .catch(reason => { if (active && reason?.code !== 'ERR_CANCELED') setError(logoError(reason)) })
      .finally(() => { if (active) setBusy(false) })
    return () => { active = false; controller.abort() }
  }, [api, reload])
  const change = async (action, done) => {
    setBusy(true); setError(''); setNotice('')
    try {
      const response = await action()
      setLogo(response.data); setNotice(done); setBusy(false)
    } catch (reason) {
      setError(logoError(reason))
      // Someone else changed it: show what is there now, so the next attempt carries the right revision.
      if (['STALE_REVISION', 'STATE_CONFLICT', 'EMAIL_LOGO_NOT_SET'].includes(reason?.response?.data?.error?.code)) setReload(value => value + 1)
      else setBusy(false)
    }
  }
  const choose = event => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    setNotice('')
    if (!LOGO_TYPES.includes(file.type)) { setError(logoError({ response: { data: { error: { code: 'EMAIL_LOGO_INVALID' } } } })); return }
    if (file.size > LOGO_BYTES) { setError(logoError({ response: { data: { error: { code: 'EMAIL_LOGO_TOO_LARGE' } } } })); return }
    change(() => api.emailLogoWrite(file, logo?.revision ?? 0), 'Logótipo guardado.')
  }
  return <section className="entity-profile-sheet entity-email-logo" aria-labelledby="entity-email-logo-title">
    <header className="entity-profile-header"><div className="entity-profile-title-line"><ImageIcon size={21} aria-hidden="true"/><h2 id="entity-email-logo-title">Logótipo nos emails</h2></div></header>
    <p className="entity-profile-note">Aparece nos emails enviados em nome da entidade, como o convite de acesso. Sem logótipo próprio, os emails levam o da C4G.</p>
    {logo?.url
      ? <img className="entity-email-logo-image" src={logo.url} alt="Logótipo da entidade nos emails"/>
      : logo && <p className="entity-email-logo-empty">A entidade ainda não carregou um logótipo.</p>}
    {error && <p className="entity-profile-message error" role="alert">{error}</p>}
    {notice && !error && <p className="entity-profile-message" role="status">{notice}</p>}
    <p className="entity-email-logo-limits">PNG ou JPEG, até 512 KB e 1200 × 600 píxeis.</p>
    <div className="entity-email-logo-actions">
      <input ref={input} type="file" accept="image/png,image/jpeg" className="sr-only" aria-label="Ficheiro do logótipo da entidade" onChange={choose}/>
      <button className="btn btn-outline" type="button" disabled={busy || !logo} onClick={() => input.current?.click()}><Upload size={16} aria-hidden="true"/>{logo?.url ? 'Substituir logótipo' : 'Carregar logótipo'}</button>
      {logo?.url && <button className="btn btn-secondary" type="button" disabled={busy} onClick={() => change(() => api.emailLogoRemove(logo.revision), 'Logótipo removido. Os emails voltam a levar o da C4G.')}><Trash2 size={16} aria-hidden="true"/>Remover logótipo</button>}
    </div>
  </section>
}
