import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { platformImportsApi, authApi } from '../../api/api'
import LoadingIndicator from '../../components/LoadingIndicator'

// After a preview: save the candidates, review what would enter the Catálogo and accept the new ones. The administrator
// approves the digest of the review; nothing is accepted if anything changed under it. Contract:
// context/features/pt2030-central-import-to-catalog.md
const STATUS = { ACCEPTABLE: 'Nova', ALREADY_ACCEPTED: 'Já aceite', NEEDS_REVIEW: 'A rever', REJECTED: 'Rejeitada' }
const errors = {
  PT2030_BATCH_STALE: 'O conteúdo mudou desde a revisão. Reveja de novo antes de aceitar.',
  PT2030_RECENT_AUTHENTICATION_REQUIRED: 'Para aceitar no Catálogo é preciso uma autenticação recente. Termine a sessão, entre de novo e repita o pedido.',
  PT2030_IMPORT_BUSY: 'Esta importação já está a ser tratada. Aguarde e consulte o resultado.',
  PT2030_IMPORT_NOT_FOUND: 'A importação gravada já não está disponível. Grave as candidatas de novo.',
  PT2030_PREVIEW_DIGEST_MISMATCH: 'A pré-visualização mudou. Pré-visualize a folha de novo antes de gravar.',
  PT2030_PREVIEW_REQUIRED: 'Pré-visualize a folha antes de gravar as candidatas.',
  PT2030_IDEMPOTENCY_CONFLICT: 'Este pedido já corresponde a outra operação. Pré-visualize de novo para começar um novo pedido.',
  PT2030_DOCUMENT_CHANGED: 'O original guardado não corresponde ao ficheiro verificado. Carregue novamente o ficheiro.',
  C4G_ADMIN_REQUIRED: 'Já não tem autorização para esta operação.'
}
// The import to resume after the administrator renews the authentication: the page reloads on return and the staged
// candidates are still saved, so the review comes back without uploading anything again.
export const RESUME_KEY = 'c4g.pt2030.import'
const RETURN_PATH = '/administracao/importar'
const message = error => errors[error?.response?.data?.error?.code] || 'Não foi possível concluir a operação. Pode repetir o pedido: nada é duplicado.'

export default function CentralImportCatalog({ uploadId, sheetName, previewDigest, resumeImportId = null, api = platformImportsApi, auth = authApi }) {
  const [review, setReview] = useState(null), [result, setResult] = useState(null), [page, setPage] = useState(0)
  const [busy, setBusy] = useState(''), [error, setError] = useState(''), [needsAuth, setNeedsAuth] = useState(false)
  const alive = useRef(true), lock = useRef(false), stageIntent = useRef(null)
  useEffect(() => { alive.current = true; return () => { alive.current = false } }, [])
  useEffect(() => {
    if (!resumeImportId) return
    try { sessionStorage.removeItem(RESUME_KEY) } catch { /* storage unavailable */ }
    setBusy('review')
    api.review(resumeImportId).then(({ data }) => { if (alive.current) setReview(data) }, e => { if (alive.current) fail(e) }).finally(() => { if (alive.current) setBusy('') })
  }, [resumeImportId, api])
  function fail(e) {
    setNeedsAuth(e?.response?.data?.error?.code === 'PT2030_RECENT_AUTHENTICATION_REQUIRED'); setError(message(e))
  }
  async function renew() {
    if (!review) return
    try { sessionStorage.setItem(RESUME_KEY, review.importId) } catch { /* the review is then reloaded by hand */ }
    try {
      const { data } = await auth.stepUpPolicy()
      if (typeof data?.mfaOptional !== 'boolean') throw Error('POLICY')
      auth.stepUp(data.mfaOptional ? 'recent-auth' : 'recent-mfa', RETURN_PATH)
    } catch { setError('Não foi possível iniciar a renovação da autenticação. Termine a sessão e entre de novo.') }
  }
  async function reload() {
    if (lock.current || !review) return
    lock.current = true; setBusy('review'); setError(''); setNeedsAuth(false)
    try { const { data } = await api.review(review.importId); if (alive.current) setReview(data) }
    catch (e) { if (alive.current) fail(e) } finally { lock.current = false; if (alive.current) setBusy('') }
  }

  async function stage() {
    if (lock.current) return
    lock.current = true; setBusy('stage'); setError(''); setResult(null)
    stageIntent.current ||= crypto.randomUUID()
    try {
      const { data: staged } = await api.stage(uploadId, { requestId: stageIntent.current, sheetName, previewDigest })
      const { data } = await api.review(staged.importId)
      if (alive.current) { setReview(data); setPage(0) }
    } catch (e) { if (alive.current) fail(e) } finally { lock.current = false; if (alive.current) setBusy('') }
  }
  async function accept() {
    if (lock.current || !review) return
    lock.current = true; setBusy('accept'); setError(''); setNeedsAuth(false)
    try {
      const { data } = await api.accept(review.importId, { batchDigest: review.batchDigest })
      const again = await api.review(review.importId)
      if (alive.current) { setResult(data); setReview(again.data) }
    } catch (e) { if (alive.current) fail(e) } finally { lock.current = false; if (alive.current) setBusy('') }
  }
  const rows = review?.rows || [], pages = Math.max(1, Math.ceil(rows.length / 50))
  const fresh = review?.totals?.ACCEPTABLE || 0

  return <section className="detail-section" aria-label="Gravar e aceitar no Catálogo">
    <h2>Levar para o Catálogo</h2>
    {!review && uploadId && <p>Grave as candidatas desta folha. Ainda nada chega ao Catálogo: antes verá o que entra.</p>}
    {error && <p role="alert">{error}</p>}
    {needsAuth && review && <div className="form-actions"><button className="btn btn-primary" onClick={renew}>Renovar autenticação e continuar</button></div>}
    {busy && <LoadingIndicator>{busy === 'stage' ? 'A gravar as candidatas…' : busy === 'review' ? 'A carregar a revisão…' : 'A aceitar no Catálogo…'}</LoadingIndicator>}
    {!review && uploadId && <div className="form-actions"><button className="btn btn-primary" disabled={!!busy} onClick={stage}>Gravar candidatas</button></div>}
    {review && <>
      <p>{review.totalRows} linhas · {review.totals.ACCEPTABLE} novas · {review.totals.ALREADY_ACCEPTED} já aceites · {review.totals.NEEDS_REVIEW} a rever · {review.totals.REJECTED} rejeitadas</p>
      <p>Só as novas são aceites. As já aceites e as alteradas não são tocadas: uma alteração fica a rever e não substitui o que já está no Catálogo.</p>
      <div className="form-actions"><button className="btn btn-primary" disabled={!!busy || fresh === 0} onClick={accept}>{fresh === 0 ? 'Não há oportunidades novas' : `Aceitar ${fresh} oportunidades novas no Catálogo`}</button>
        <button className="btn btn-secondary" disabled={!!busy} onClick={reload}>Atualizar revisão</button></div>
      {result && <div role="status"><p>{result.created} oportunidades aceites{result.failed.length ? ` · ${result.failed.length} falharam` : ''}{result.skipped.alreadyAccepted ? ` · ${result.skipped.alreadyAccepted} já aceites` : ''}{result.skipped.needsReview ? ` · ${result.skipped.needsReview} a rever` : ''}.</p>
        {result.failed.length > 0 && <details><summary>Linhas que falharam</summary>{result.failed.map(item => <p key={item.externalIdentifier}>Linha {item.physicalRow} ({item.externalIdentifier}): <small>{item.code}</small></p>)}</details>}
        {result.created > 0 && <p><Link to="/catalogo">Consultar o Catálogo</Link></p>}</div>}
      <div className="table-wrap"><table className="data-table"><thead><tr><th>Linha</th><th>Referência</th><th>Aviso</th><th>Estado</th></tr></thead><tbody>
        {rows.slice(page * 50, (page + 1) * 50).map(row => <tr key={row.externalIdentifier}><td>{row.physicalRow}</td><td>{row.externalIdentifier}</td><td>{row.title ?? '—'}</td>
          <td>{STATUS[row.status]}{(row.reasons?.length || row.code || row.errors?.length) ? <details><summary>Detalhes</summary>{[...(row.reasons || []), ...(row.errors || []), ...(row.code ? [row.code] : [])].map(code => <small key={code}>{code} </small>)}</details> : null}</td></tr>)}
      </tbody></table></div>
      {pages > 1 && <nav aria-label="Páginas da revisão"><button className="btn btn-secondary" disabled={page === 0} onClick={() => setPage(v => v - 1)}>Anterior</button><span> Página {page + 1} de {pages} </span><button className="btn btn-secondary" disabled={page + 1 >= pages} onClick={() => setPage(v => v + 1)}>Seguinte</button></nav>}
    </>}
  </section>
}
