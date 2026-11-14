import LoadingIndicator from '../components/LoadingIndicator'
import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { CheckCircle, Download, Upload, XCircle } from 'lucide-react'
import { importsApi as privateImportsApi, platformImportsApi } from '../api/api'
import { useAuth } from '../contexts/AuthContext'
import { ImportPreview, ImportResult, importError, stateLabel, terminal } from './Imports/ImportPresentation'
import './Imports/import.css'
import CentralImportPreview from './Imports/CentralImportPreview'
import { scheduleWhenVisible } from '../utils/visiblePolling'

export default function Import() {
  const { user } = useAuth()
  if (!user?.platformRoles?.includes('C4G_ADMIN')) return <p role="alert">A importação Portugal 2030 é gerida pela administração C4G.</p>
  return <CentralImportAvailability key={user.id} />
}

function CentralImportAvailability() {
  const [state, setState] = useState('loading'), [error, setError] = useState(''), [attempt, setAttempt] = useState(0), [catalog, setCatalog] = useState(false)
  useEffect(() => {
    let active = true
    const controller = new AbortController()
    setState('loading'); setError('')
    platformImportsApi.availability(controller.signal).then(({data}) => {
      if (!active) return
      if (typeof data?.available !== 'boolean') throw new Error('Invalid availability response')
      setCatalog(data.mode === 'STAGE_AND_ACCEPT')
      setState(data.available ? ['PREVIEW_ONLY', 'STAGE_AND_ACCEPT'].includes(data.mode) ? 'ready' : 'integration-pending' : 'unavailable')
    }).catch(err => {
      if (!active) return
      setError([401,403].includes(err.response?.status) ? importError(err) : 'Não foi possível consultar a disponibilidade da importação. Tente novamente.')
      setState('error')
    })
    return () => { active = false; controller.abort() }
  }, [attempt])

  return <div className="import-page">
    <div className="page-header"><h1>Importar Portugal 2030</h1></div>
    <div className="toolbar">
      <a className="btn btn-outline" href="https://portugal2030.pt/plano-anual-de-avisos/" target="_blank" rel="noopener noreferrer"><Download size={14} aria-hidden="true"/> Obter Excel oficial</a>
      <Link className="btn btn-outline" to="/catalogo">Consultar catálogo C4G</Link>
    </div>
    {state === 'ready' ? <CentralImportPreview catalog={catalog}/> : <section className="detail-section" aria-label="Disponibilidade da importação" aria-busy={state === 'loading'}>
      {state === 'loading' ? <LoadingIndicator>A verificar disponibilidade…</LoadingIndicator>
        : state === 'error' ? <p role="alert">{error}</p>
        : <p role="status">{state === 'unavailable' ? 'A importação para o catálogo C4G ainda não está disponível.' : 'O serviço está disponível, mas o envio de ficheiros por esta página ainda não está integrado.'}</p>}
      {state !== 'loading' && <button className="btn btn-outline" onClick={() => { setState('loading'); setAttempt(value => value + 1) }}>Voltar a verificar</button>}
    </section>}
  </div>
}

export function ImportWorkspace({ organization, platform=false, importsApi=privateImportsApi }) {
  const input = useRef(null), alive = useRef(false), lock = useRef(false), historyRequest = useRef(0)
  const pendingUpload = useRef(null)
  const [history, setHistory] = useState([]), [historyError, setHistoryError] = useState('')
  const [uploaded, setUploaded] = useState(null), [sheetName, setSheetName] = useState('')
  const [unknownHeaders, setUnknownHeaders] = useState([]), [headerDecisions, setHeaderDecisions] = useState({})
  const [preview, setPreview] = useState(null), [detail, setDetail] = useState(null)
  const [busy, setBusy] = useState(''), [loading, setLoading] = useState(true), [ready, setReady] = useState(false)
  const [error, setError] = useState(''), [retryUpload, setRetryUpload] = useState(false)

  async function load() {
    const request = ++historyRequest.current
    try {
      const response = await importsApi.list()
      if (!alive.current || request !== historyRequest.current) return
      setHistory(response.data); setHistoryError(''); setReady(true)
    } catch (err) {
      if (!alive.current || request !== historyRequest.current) return
      setHistoryError(importError(err)); setReady(false)
    } finally { if (alive.current && request === historyRequest.current) setLoading(false) }
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- Runs only when the listed keys change; load is read at that moment.
  useEffect(() => { alive.current = true; load(); return () => { alive.current = false; historyRequest.current += 1 } }, [])

  async function run(action, work) {
    if (lock.current || !alive.current) return
    lock.current = true; setBusy(action); setError('')
    try { await work() }
    catch (err) { if (alive.current) setError(importError(err)) }
    finally { lock.current = false; if (alive.current) setBusy('') }
  }
  useEffect(() => {
    if (!detail?.job || terminal.has(detail.job.state) || ['UPLOADED', 'READY_FOR_CONFIRMATION'].includes(detail.job.state)) return undefined
    let active = true, cancel
    const poll = async () => {
      try {
        if (!lock.current) {
          const response = await importsApi.get(detail.job.importId)
          if (!active || !alive.current) return
          setDetail(response.data); await load()
        }
      } catch (err) { if (active && alive.current) setError(importError(err)) }
      finally { if (active && alive.current) cancel = scheduleWhenVisible(poll, 2000) }
    }
    cancel = scheduleWhenVisible(poll, 2000)
    return () => { active = false; cancel() }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- Runs only when the listed keys change; detail.job, importsApi, load are read at that moment.
  }, [detail?.job?.importId, detail?.job?.state, busy])

  function resetSelection() {
    setUploaded(null); setPreview(null); setDetail(null); setSheetName(''); setUnknownHeaders([]); setHeaderDecisions({})
  }
  async function sendUpload() {
    const intention = pendingUpload.current
    if (!intention) return
    const body = new FormData(); body.append('file', intention.file); body.append('requestId', intention.requestId)
    try {
      const response = await importsApi.upload(body)
      if (!alive.current) return
      pendingUpload.current = null; setRetryUpload(false)
      const value = response.data
      if (['UPLOADED', 'READY_FOR_CONFIRMATION'].includes(value.job.state)) {
        setUploaded(value); setSheetName(value.job.sheetName || ''); setHeaderDecisions(Object.fromEntries((value.job.mapping?.explicitlyIgnored || []).map(header => [header, 'IGNORE'])))
      } else {
        const responseDetail = await importsApi.get(value.job.importId)
        if (!alive.current) return
        setDetail(responseDetail.data)
      }
      await load()
    } catch (err) {
      if (!alive.current) return
      const status = err.response?.status, uncertain = !status || status >= 500
      setRetryUpload(uncertain && Boolean(pendingUpload.current))
      if (!uncertain) { pendingUpload.current = null; if (input.current) input.current.value = '' }
      throw err
    }
  }
  const chooseFile = event => {
    const file = event.target.files?.[0]
    if (!file || !ready || lock.current || pendingUpload.current) return
    if (!/\.xlsx$/i.test(file.name) || file.size > 10 * 1024 * 1024) {
      setError('Selecione um ficheiro .xlsx até 10 MiB.'); event.target.value = ''; return
    }
    resetSelection(); pendingUpload.current = { file, requestId: crypto.randomUUID() }
    run('upload', sendUpload)
  }
  const runPreview = () => run('preview', async () => {
    try {
      const response = await importsApi.preview(uploaded.job.importId, sheetName, headerDecisions)
      if (!alive.current) return
      setPreview(response.data); setUnknownHeaders([]); await load()
    } catch (err) {
      if (alive.current && err.response?.data?.error?.code === 'IMPORT_HEADER_DECISION_REQUIRED') setUnknownHeaders(err.response.data.error.details?.headers || [])
      throw err
    }
  })
  async function refreshDetail(id) {
    const response = await importsApi.get(id)
    if (!alive.current) return
    setDetail(response.data); await load()
  }
  const confirm = () => run('confirm', async () => {
    const id = uploaded.job.importId
    await importsApi.confirm(id)
    if (!alive.current) return
    await refreshDetail(id)
    if (!alive.current) return
    setUploaded(null); setPreview(null); if (input.current) input.current.value = ''
  })
  const cancel = id => run('cancel', async () => {
    await importsApi.cancel(id)
    if (!alive.current) return
    await refreshDetail(id)
    if (!alive.current) return
    setUploaded(null); setPreview(null)
  })
  const review = (line, decision) => run('review', async () => {
    const id = detail.job.importId
    await importsApi.review(id, line, decision)
    if (alive.current) await refreshDetail(id)
  })
  const open = id => run('read', async () => {
    const response = await importsApi.get(id)
    if (!alive.current) return
    resetSelection()
    const value = response.data
    if (['UPLOADED', 'READY_FOR_CONFIRMATION'].includes(value.job.state) && value.sheets?.length) {
      setUploaded(value); setSheetName(value.job.sheetName || ''); setHeaderDecisions(Object.fromEntries((value.job.mapping?.explicitlyIgnored || []).map(header => [header, 'IGNORE'])))
    } else setDetail(value)
  })
  const download = id => run('download', async () => {
    const response = await importsApi.report(id)
    if (!alive.current) return
    const url = URL.createObjectURL(response.data), link = document.createElement('a')
    link.href = url; link.download = `opportunity-import-${id}.csv`; link.click(); URL.revokeObjectURL(url)
  })

  const disabled = Boolean(busy)
  return <div className="import-page">
    <div className="page-header"><div><h1>{platform?'Importar Portugal 2030':'Importar oportunidades'}</h1>{!platform&&<p className="text-muted">Portugal 2030 · {organization.name || organization.displayName || 'Organização ativa'}</p>}</div></div>
    <div className="toolbar">{!platform&&<p>Os avisos ficam nas oportunidades privadas desta organização.</p>}<a className="btn btn-outline" href="https://portugal2030.pt/plano-anual-de-avisos/" target="_blank" rel="noopener noreferrer"><Download size={14}/> Obter Excel oficial</a></div>
    <div className="upload-zone"><Upload size={24} className="text-muted"/><label htmlFor="portugal-file">Selecione o ficheiro Excel do Plano de Avisos Portugal 2030</label><p className="text-muted">Formato .xlsx · até 10 MiB e 5.000 linhas. A pré-visualização não cria oportunidades.</p><input id="portugal-file" ref={input} type="file" accept=".xlsx" onChange={chooseFile} disabled={!ready || disabled || retryUpload}/>{busy === 'upload' && <p role="status">A guardar o ficheiro…</p>}</div>
    {historyError && <div className="alert alert-error" role="alert"><p>{historyError}</p><button className="btn btn-outline" disabled={disabled} onClick={() => run('reload', load)}>Voltar a verificar</button></div>}
    {error && <div className="alert alert-error" role="alert">{error}</div>}
    {retryUpload && <div className="alert"><p>O envio ainda não foi confirmado. Repita o mesmo envio para recuperar o resultado, sem escolher outro ficheiro.</p><button className="btn btn-outline" disabled={disabled} onClick={() => run('upload', sendUpload)}>Repetir envio</button></div>}
    {uploaded && !preview && <section className="detail-section"><h3>Validar ficheiro</h3><div className="form-group"><label htmlFor="import-sheet">Folha</label><select id="import-sheet" value={sheetName} disabled={disabled} onChange={event => { setSheetName(event.target.value); setUnknownHeaders([]); setHeaderDecisions({}) }}><option value="">Selecione uma folha</option>{uploaded.sheets.map(sheet => <option key={sheet.index} value={sheet.name}>{sheet.name}</option>)}</select></div>
      {unknownHeaders.length > 0 && <><h4>Colunas não reconhecidas</h4><p>Escolha o tratamento de cada coluna antes de continuar.</p>{unknownHeaders.map((header, index) => <div key={header} className="form-group"><label htmlFor={`import-header-${index}`}>{header}</label><select id={`import-header-${index}`} disabled={disabled} value={headerDecisions[header] || ''} onChange={event => setHeaderDecisions(current => ({...current, [header]: event.target.value}))}><option value="">Escolha uma decisão</option><option value="IGNORE">Ignorar esta coluna</option><option value="REJECT">Rejeitar o ficheiro</option></select></div>)}</>}
      <div className="form-actions"><button className="btn btn-danger" onClick={() => cancel(uploaded.job.importId)} disabled={disabled}>Cancelar importação</button><button className="btn btn-primary" onClick={runPreview} disabled={!ready || !sheetName || disabled || unknownHeaders.some(header => !headerDecisions[header])}>{busy === 'preview' ? 'A validar…' : 'Validar e pré-visualizar'}</button></div></section>}
    {preview && <ImportPreview preview={preview} busy={busy} onBack={() => setPreview(null)} onConfirm={confirm} canConfirm={ready}/>}
    {detail && <ImportResult detail={detail} busy={busy} onCancel={cancel} onReview={review} onDownload={download} onRefresh={() => run('refresh', () => refreshDetail(detail.job.importId))}/>}
    <section className="detail-section"><h3>Histórico de importações</h3>{loading ? <LoadingIndicator>A carregar importações…</LoadingIndicator> : historyError ? <p>Não foi possível consultar o histórico. Volte a verificar a disponibilidade acima.</p> : history.length === 0 ? <p className="empty-state">Ainda não existem importações nesta organização.</p> : <div className="table-wrap"><table className="data-table"><thead><tr><th>Data</th><th>Folha</th><th>Estado</th><th>Processadas</th><th>Criadas</th><th>Duplicadas</th><th>Por rever</th><th>Rejeitadas</th><th>Falhas</th><th>Ações</th></tr></thead><tbody>{history.map(job => <tr key={job.importId}><td>{new Date(job.createdAt).toLocaleString('pt-PT')}</td><td>{job.sheetName || 'Por escolher'}</td><td>{job.state === 'COMPLETED' ? <CheckCircle size={14}/> : job.state === 'FAILED' ? <XCircle size={14}/> : null} {stateLabel[job.state] || job.state}</td><td>{job.processedRows}/{job.totalRows}</td><td>{job.createdRows}</td><td>{job.exactRows}</td><td>{job.possibleRows}</td><td>{job.rejectedRows}</td><td>{job.conflictRows}</td><td><button className="btn btn-outline" disabled={disabled || retryUpload} onClick={() => open(job.importId)}>{['UPLOADED', 'READY_FOR_CONFIRMATION'].includes(job.state) ? 'Continuar' : 'Consultar'}</button></td></tr>)}</tbody></table></div>}</section>
    <Link className="btn btn-outline" to={platform?'/catalogo':'/oportunidades'}>{platform?'Consultar catálogo C4G':'Consultar oportunidades privadas'}</Link>
  </div>
}
