import { useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { authApi, opportunityActivationApi } from '../../api/api'
import { useAuth } from '../../contexts/AuthContext'
import LoadingIndicator from '../../components/LoadingIndicator'
import { acceptAll, loadAcceptanceProgress, reauthenticateAcceptance, saveAcceptanceProgress, validAcceptanceQueue } from './euLegacyAcceptanceReview'
import { money, time, code } from './euLegacyPresentation'
import './eu-legacy-review.css'

export default function EuLegacyAcceptanceReview({ api = opportunityActivationApi }) {
  const { user } = useAuth()
  const [search, setSearch] = useSearchParams()
  const packageId = search.get('pacote') || ''
  const [typed, setTyped] = useState(packageId)
  const [queue, setQueue] = useState(null)
  const [progress, setProgress] = useState({ items: {} })
  const progressRef = useRef(progress)
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => {
    if (!packageId || !user?.id) { setQueue(null); return }
    const controller = new AbortController(); let active = true
    setLoading(true); setError(''); setQueue(null)
    api.euLegacyAcceptanceQueue(packageId, controller.signal).then(({ data }) => {
      if (!active) return
      if (!validAcceptanceQueue(data, packageId)) throw Error('PACOTE_DESATUALIZADO')
      const saved = loadAcceptanceProgress(packageId, user.id)
      progressRef.current = saved; setProgress(saved); setQueue(data)
    }).catch(cause => { if (active) setError(code(cause)) })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false; controller.abort() }
  }, [api, packageId, user?.id])
  const completed = queue?.items.filter(item => item.accepted || progress.items[item.itemDigest]?.result).length || 0
  const remaining = queue ? queue.eligibleCount - completed : 0
  const expired = queue && Date.now() >= Date.parse(queue.expiresAt)
  const persist = next => { saveAcceptanceProgress(queue.packageId, user.id, next)
    progressRef.current = next; setProgress(next) }
  const run = async () => {
    if (!queue || busy || expired || !user?.id) return
    setBusy(true); setError('')
    try { await acceptAll({ api, queue, progress: progressRef.current, persist }) }
    catch (cause) { setError(`A aceitação parou: ${code(cause)}. As intenções ficaram guardadas para retoma explícita.`) }
    finally { setBusy(false) }
  }
  const reauthenticate = async () => {
    try { await reauthenticateAcceptance(authApi, window.location.pathname + window.location.search) }
    catch (cause) { setError(code(cause)) }
  }
  return <main className="page platform-directory eu-legacy-review">
    <header className="directory-heading"><div><h1>Aceitação EU</h1>
      <p>Revisão autenticada de candidatos arquivados. Cada aceitação cria uma revisão v2; a recolha EU continua suspensa.</p></div></header>
    <form className="eu-legacy-package" onSubmit={event => { event.preventDefault(); if (!busy) setSearch({ pacote: typed.trim() }) }}>
      <label htmlFor="eu-acceptance-package">Identificador do pacote</label>
      <input id="eu-acceptance-package" value={typed} onChange={event => setTyped(event.target.value)} disabled={busy} spellCheck="false" />
      <button className="btn btn-outline" disabled={busy || loading}>Abrir fila</button>
    </form>
    {loading && <LoadingIndicator>A validar o pacote e a autoridade…</LoadingIndicator>}
    {error && <div role="alert" className="alert alert-error">{error}</div>}
    {error.includes('OPPORTUNITY_V2_AUTHORITY_DENIED') && <div className="eu-legacy-actions">
      <button className="btn btn-primary" type="button" onClick={reauthenticate}>Reautenticar com OIDC</button>
    </div>}
    {queue && <>
      <section className="eu-legacy-summary" aria-label="Estado da fila">
        <div><strong>{queue.eligibleCount}</strong><span>candidatos</span></div>
        <div><strong>{completed}</strong><span>aceites</span></div>
        <div><strong>{queue.conflictCount}</strong><span>conflitos excluídos</span></div>
      </section>
      <p>Pacote válido até {time(queue.expiresAt)}. Fonte EU suspensa, fence {queue.sourceFence}. Cada candidato exige plano e aprovação OIDC próprios.</p>
      <div className="eu-legacy-actions">
        <button className="btn btn-outline" type="button" onClick={reauthenticate} disabled={busy}>Renovar autenticação OIDC</button>
        <button className="btn btn-primary" type="button" onClick={run} disabled={busy || expired || remaining === 0}>
          {busy ? `A aceitar (${completed}/${queue.eligibleCount})…` : completed ? `Retomar ${remaining} aceitações` : `Preparar, aprovar e aceitar ${remaining}`}
        </button>
      </div>
      {expired && <div role="alert" className="alert alert-error">O pacote expirou. É necessário novo preview e pacote.</div>}
      {remaining === 0 && <div role="status" className="alert alert-success">Os {queue.eligibleCount} candidatos estão aceites. A retoma da recolha EU continua separada.</div>}
      <div className="table-wrap"><table className="data-table eu-legacy-table">
        <caption>Candidatos oficiais sujeitos a aceitação</caption>
        <thead><tr><th>Referência</th><th>Título</th><th>Programa</th><th>Dotação</th><th>Estado</th><th>Prazos</th><th>Aceitação</th></tr></thead>
        <tbody>{queue.items.map(item => <tr key={item.itemDigest}>
          <td>{item.externalIdentifier}</td><td>{item.title}</td>
          <td>{item.programmeCodes?.join(', ') || 'Por confirmar'}</td><td>{money(item.amount)}</td>
          <td>{item.status || 'Por confirmar'}</td><td>{item.deadlineCount}</td>
          <td>{item.accepted || progress.items[item.itemDigest]?.result ? 'Aceite' : progress.items[item.itemDigest]?.fence ? 'Aprovado' : progress.items[item.itemDigest]?.planId ? 'Plano preparado' : 'Pendente'}</td>
        </tr>)}</tbody>
      </table></div>
    </>}
  </main>
}
