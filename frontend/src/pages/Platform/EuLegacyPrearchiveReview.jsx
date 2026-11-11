import { useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { authApi, opportunityActivationApi } from '../../api/api'
import { useAuth } from '../../contexts/AuthContext'
import LoadingIndicator from '../../components/LoadingIndicator'
import { emitPreapprovals, loadReviewProgress, reauthenticateForReview, saveReviewProgress, validQueue } from './euLegacyReview'
import { money, time, code } from './euLegacyPresentation'
import './eu-legacy-review.css'

export default function EuLegacyPrearchiveReview({ api = opportunityActivationApi }) {
  const { user } = useAuth()
  const [search, setSearch] = useSearchParams()
  const [typed, setTyped] = useState(search.get('pacote') || '')
  const [queue, setQueue] = useState(null)
  const [progress, setProgress] = useState({ pending: {}, receipts: {} })
  const progressRef = useRef(progress)
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const packageId = search.get('pacote') || ''
  useEffect(() => {
    if (!packageId || !user?.id) { setQueue(null); return }
    const controller = new AbortController(); let active = true
    setLoading(true); setError(''); setQueue(null)
    api.euLegacyQueue(packageId, controller.signal).then(({ data }) => {
      if (!active) return
      if (!validQueue(data, packageId)) throw Error('PACOTE_DESATUALIZADO')
      const saved = loadReviewProgress(packageId, user.id)
      progressRef.current = saved; setProgress(saved); setQueue(data)
    }).catch(cause => { if (active) setError(code(cause)) })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false; controller.abort() }
  }, [api, packageId, user?.id])

  const completed = queue?.items.filter(item => {
    const receipt = progress.receipts[item.itemDigest]
    return receipt?.packageId === queue.packageId && receipt.externalIdentifier === item.externalIdentifier
  }).length || 0
  const remaining = queue ? queue.eligibleCount - completed : 0
  const expired = queue && Date.now() >= Date.parse(queue.expiresAt)
  const persist = next => {
    saveReviewProgress(queue.packageId, user.id, next)
    progressRef.current = next; setProgress(next)
  }
  const approve = async () => {
    if (!queue || busy || expired || !user?.id) return
    setBusy(true); setError('')
    try { await emitPreapprovals({ api, queue, progress: progressRef.current, persist }) }
    catch (cause) { setError(`A emissão parou: ${code(cause)}. A intenção pendente foi conservada para retoma explícita.`) }
    finally { setBusy(false) }
  }
  const reauthenticate = async () => {
    try { await reauthenticateForReview(authApi, window.location.pathname + window.location.search) }
    catch (cause) { setError(code(cause)) }
  }
  const exportReceipts = () => {
    if (!queue || completed === 0) return
    const payload = { kind: 'eu-legacy-prearchive-receipts-v1', packageId: queue.packageId,
      exportedAt: new Date().toISOString(), eligibleCount: queue.eligibleCount,
      receipts: queue.items.map(item => progress.receipts[item.itemDigest]).filter(Boolean) }
    const url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2) + '\n'], { type: 'application/json' }))
    const link = document.createElement('a'); link.href = url; link.download = `eu-legacy-receipts-${queue.packageId}.json`
    document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
  return <main className="page platform-directory eu-legacy-review">
    <header className="directory-heading"><div><h1>Pré-aprovação EU legada</h1><p>Decisões autenticadas por identidade. Este ecrã não arquiva candidatos nem retoma a recolha.</p></div></header>
    <form className="eu-legacy-package" onSubmit={event => { event.preventDefault(); if (!busy) setSearch({ pacote: typed.trim() }) }}>
      <label htmlFor="eu-package">Identificador do pacote</label>
      <input id="eu-package" value={typed} onChange={event => setTyped(event.target.value)} disabled={busy} spellCheck="false" />
      <button className="btn btn-outline" disabled={busy || loading}>Abrir fila</button>
    </form>
    {loading && <LoadingIndicator>A validar o pacote e a autoridade…</LoadingIndicator>}
    {error && <div role="alert" className="alert alert-error">{error}</div>}
    {error.includes('OPPORTUNITY_V2_AUTHORITY_DENIED') && !queue && <div className="eu-legacy-actions">
      <p>A sessão administrativa precisa de autenticação recente para consultar e aprovar esta fila.</p>
      <button className="btn btn-primary" type="button" onClick={reauthenticate}>Reautenticar com OIDC</button>
    </div>}
    {queue && <>
      <section className="eu-legacy-summary" aria-label="Estado da fila">
        <div><strong>{queue.eligibleCount}</strong><span>elegíveis</span></div>
        <div><strong>{completed}</strong><span>recibos neste navegador</span></div>
        <div><strong>{queue.conflictCount}</strong><span>conflitos excluídos</span></div>
      </section>
      <p>Pacote válido até {time(queue.expiresAt)}. Fonte EU suspensa, fence {queue.sourceFence}. Cada aprovação gera um evento crítico próprio.</p>
      <div className="eu-legacy-actions">
        <button className="btn btn-outline" type="button" onClick={reauthenticate} disabled={busy}>Renovar autenticação OIDC</button>
        <button className="btn btn-primary" type="button" onClick={approve} disabled={busy || expired || remaining === 0}>
          {busy ? `A emitir recibos (${completed}/${queue.eligibleCount})…` : completed ? `Retomar ${remaining} aprovações` : `Emitir ${remaining} aprovações OIDC`}
        </button>
        <button className="btn btn-outline" type="button" onClick={exportReceipts} disabled={busy || completed === 0}>Exportar recibos</button>
      </div>
      {expired && <div role="alert" className="alert alert-error">O pacote expirou. Gere novo preview e pacote antes de continuar.</div>}
      {remaining === 0 && <div role="status" className="alert alert-success">Os 391 recibos estão disponíveis para exportação. A aceitação dos candidatos continua pendente.</div>}
      <div className="table-wrap"><table className="data-table eu-legacy-table">
        <caption>Itens do preview oficial sujeitos a pré-aprovação</caption>
        <thead><tr><th>Referência</th><th>Título</th><th>Programa</th><th>Dotação</th><th>Estado</th><th>Prazos</th><th>Recibo</th></tr></thead>
        <tbody>{queue.items.map(item => <tr key={item.itemDigest}>
          <td>{item.externalIdentifier}</td><td>{item.title}</td>
          <td>{item.programmeCodes?.join(', ') || 'Por confirmar'}</td><td>{money(item.amount)}</td>
          <td>{item.status || 'Por confirmar'}</td><td>{item.deadlineCount}</td>
          <td>{progress.receipts[item.itemDigest] ? 'Emitido' : progress.pending[item.itemDigest] ? 'Intenção pendente' : 'Pendente'}</td>
        </tr>)}</tbody>
      </table></div>
    </>}
  </main>
}
