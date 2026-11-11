import { useEffect, useRef, useState } from 'react'
import { pq1Api } from '../../api/api'
import InfoTooltip from '../../components/InfoTooltip'

export default function Pq1Details({ record, editable, disabled, onAction, onMfa, onChange }) {
  const [catalog, setCatalog] = useState({}), [error, setError] = useState('')
  const [assertions, setAssertions] = useState((record.assertions || []).map(a => ({ assertionId:a.assertionId,versionId:a.versionId,knowledgeStatus:a.knowledgeStatus,conceptId:a.conceptRef?.conceptId || null,levelId:a.levelRef?.entryId || null })))
  const [experiences, setExperiences] = useState((record.experiences || []).map(e => ({ experienceId:e.experienceId,versionId:e.versionId,typeId:e.typeRef.entryId,observedFrom:e.observedFrom,observedUntil:e.observedUntil })))
  const [assertion, setAssertion] = useState(''), [experience, setExperience] = useState(''), [document, setDocument] = useState(''), [documents, setDocuments] = useState([])
  const [method, setMethod] = useState(''), [until, setUntil] = useState(''), [reason, setReason] = useState('EVIDENCE_WITHDRAWN')
  const [cursors, setCursors] = useState({}), [loading, setLoading] = useState({})
  const [documentCursor, setDocumentCursor] = useState(null), [documentsLoading, setDocumentsLoading] = useState(false)
  const epoch = useRef(0), documentGeneration = useRef(0), catalogPending = useRef(new Set()), documentPending = useRef(false)
  async function loadCatalog(kind, cursor, token = epoch.current) {
    if (catalogPending.current.has(kind)) return
    catalogPending.current.add(kind); setLoading(v => ({...v,[kind]:true}))
    try {
      const page = (await pq1Api.list('catalog', {kind,...(cursor ? {cursor} : {})})).data
      if (token !== epoch.current) return
      setCatalog(v => ({...v,[kind]:cursor ? [...(v[kind] || []),...page.items] : page.items}))
      setCursors(v => ({...v,[kind]:page.nextCursor || null}))
    } catch { if (token === epoch.current) setError('Não foi possível consultar as referências autorizadas.') }
    finally { if (token === epoch.current) { catalogPending.current.delete(kind); setLoading(v => ({...v,[kind]:false})) } }
  }
  useEffect(() => {
    const token = ++epoch.current
    catalogPending.current = new Set(); setCatalog({}); setCursors({}); setLoading({})
    async function load() {
      for (const kind of ['COMPETENCY_CONCEPT','EXPERIENCE_TYPE','VERIFICATION_METHOD']) {
        if (token !== epoch.current) return
        await loadCatalog(kind, null, token)
      }
    }
    if (editable) load()
    return () => { epoch.current++; documentGeneration.current++ }
  }, [editable, record.draftId])
  const moreCatalog = (kind, label) => cursors[kind] && <button disabled={disabled || loading[kind]} onClick={() => loadCatalog(kind,cursors[kind])}>Mais {label}</button>
  const action = (operation, method, command, resourceId) => onAction(operation,{method,command,resourceId})
  const updateAssertion = (index, patch) => setAssertions(rows => rows.map((r,i) => i === index ? {...r,...patch,versionId:crypto.randomUUID()} : r))
  const updateExperience = (index, patch) => setExperiences(rows => rows.map((r,i) => i === index ? {...r,...patch,versionId:crypto.randomUUID()} : r))
  const selectedMethod = catalog.VERIFICATION_METHOD?.find(m => m.entryId === method)
  async function loadDocuments(value, cursor, token) {
    if (documentPending.current) return
    const e = record.experiences.find(row => row.versionId === value)
    if (!e) return
    documentPending.current = true; setDocumentsLoading(true)
    try {
      const page = (await pq1Api.documents(record.draftId,e.experienceId,cursor ? {cursor} : {})).data
      if (token !== documentGeneration.current) return
      setDocuments(rows => cursor ? [...rows,...page.items] : page.items); setDocumentCursor(page.nextCursor || null)
    } catch { if (token === documentGeneration.current) setError('Não foi possível consultar documentos autorizados para esta experiência.') }
    finally { if (token === documentGeneration.current) { documentPending.current = false; setDocumentsLoading(false) } }
  }
  function selectExperience(value) {
    const token = ++documentGeneration.current
    documentPending.current = false; setDocumentsLoading(false)
    setExperience(value); setDocument(''); setDocuments([]); setDocumentCursor(null)
    if (value) loadDocuments(value,null,token)
  }
  const dateInput = v => v ? v.slice(0,16) : ''
  const utc = v => v ? `${v}:00.000Z` : ''
  return <section aria-label="Competências e evidências" onChangeCapture={onChange}>
    <div className="heading-with-info"><h3>Competências e evidências</h3><InfoTooltip label="Informação sobre competências e evidências">Uma competência declarada não é uma competência verificada.</InfoTooltip></div>
    {error && <p role="alert">{error}</p>}
    <ul>{(record.assertions || []).map(a => <li key={a.versionId}>{a.knowledgeStatus === 'UNKNOWN' ? 'Competências desconhecidas' : `Competência declarada: ${a.conceptRef.conceptId}`}</li>)}</ul>
    <ul>{(record.experiences || []).map(e => <li key={e.versionId}>Experiência {e.experienceId} — {e.observedFrom} a {e.observedUntil}. Proveniência: declaração manual registada em {e.provenance.recordedAt}.</li>)}</ul>
    <ul>{(record.links || []).map(l => <li key={l.linkId}>Evidência ligada à competência {l.assertionVersionId}; experiência {l.experienceId}. {l.documentVersionId ? 'Documento referenciado' : 'Sem documento associado'}.</li>)}</ul>
    <ul>{(record.verifications || []).map(v => <li key={v.verificationId}>
      {v.currentStatus && <span>Estado atual: {v.currentStatus}, observado em {record.currentObservedAt}. </span>}Verificação de {v.assertionVersionId}: {v.effectiveStatusAtSubmission}; observada em {record.observedAt}. Validade: {v.verifiedAt} até {v.validUntil || 'sem expiração permitida pelo método'}.
      {v.revoke && <button className="btn btn-danger" disabled={disabled} onClick={() => action('REVOKE_VERIFICATION','revoke',{concurrencyToken:v.revoke.concurrencyToken,reasonCode:reason},v.verificationId)}>Revogar esta verificação</button>}
    </li>)}</ul>
    {record.verifications?.some(v => v.revoke) && <label>Motivo da revogação<select value={reason} onChange={e=>setReason(e.target.value)}><option value="EVIDENCE_WITHDRAWN">Evidência retirada</option><option value="VERIFICATION_ERROR">Erro de verificação</option></select></label>}
    {editable && <>
      <p>Alterar competências, experiências ou ligações pode retirar verificações da revisão corrente. Os registos históricos são preservados.</p>
      <fieldset disabled={disabled}><legend>Declarações de competência</legend>
        {assertions.map((a,i)=><div key={a.assertionId}>
          <label>Desconhecimento declarado<input type="checkbox" checked={a.knowledgeStatus==='UNKNOWN'} onChange={e=>updateAssertion(i,{knowledgeStatus:e.target.checked?'UNKNOWN':'KNOWN',conceptId:null,levelId:null})}/></label>
          {a.knowledgeStatus==='KNOWN' && <label>Competência<select value={a.conceptId || ''} onChange={e=>updateAssertion(i,{conceptId:e.target.value || null,levelId:null})}><option value="">Selecione</option>{a.conceptId && !catalog.COMPETENCY_CONCEPT?.some(c=>c.entryId===a.conceptId) && <option value={a.conceptId}>{a.conceptId} — referência guardada</option>}{catalog.COMPETENCY_CONCEPT?.map(c=><option key={c.entryId} value={c.entryId}>{c.label} — {c.releaseVersion}</option>)}</select></label>}
          {moreCatalog('COMPETENCY_CONCEPT','competências')}
        <button className="btn btn-danger btn-sm" onClick={()=>{onChange();setAssertions(rows=>rows.filter((_,n)=>n!==i))}}>Remover declaração {i+1}</button>
        </div>)}
        {moreCatalog('COMPETENCY_CONCEPT','competências')}
        <button onClick={()=>{onChange();setAssertions(rows=>[...rows,{assertionId:crypto.randomUUID(),versionId:crypto.randomUUID(),knowledgeStatus:'KNOWN',conceptId:null,levelId:null}])}}>Adicionar competência</button>
        <button disabled={assertions.some(a=>a.knowledgeStatus==='KNOWN'&&!a.conceptId)} onClick={()=>action('SET_COMPETENCIES','competencies',{expectedRevision:record.revision,assertions})}>Guardar competências</button>
      </fieldset>
      <fieldset disabled={disabled}><legend>Experiências institucionais</legend>
        {experiences.map((e,i)=><div key={e.experienceId}>
          <label>Tipo de experiência<select value={e.typeId} onChange={v=>updateExperience(i,{typeId:v.target.value})}><option value="">Selecione</option>{e.typeId && !catalog.EXPERIENCE_TYPE?.some(t=>t.entryId===e.typeId) && <option value={e.typeId}>{e.typeId} — referência guardada</option>}{catalog.EXPERIENCE_TYPE?.map(t=><option key={t.entryId} value={t.entryId}>{t.label}</option>)}</select></label>
          <label>Início observado (UTC)<input type="datetime-local" value={dateInput(e.observedFrom)} onChange={v=>updateExperience(i,{observedFrom:utc(v.target.value)})}/></label>
          <label>Fim observado (UTC)<input type="datetime-local" value={dateInput(e.observedUntil)} onChange={v=>updateExperience(i,{observedUntil:utc(v.target.value)})}/></label>
        </div>)}
        {moreCatalog('EXPERIENCE_TYPE','tipos de experiência')}
        <button onClick={()=>{onChange();setExperiences(rows=>[...rows,{experienceId:crypto.randomUUID(),versionId:crypto.randomUUID(),typeId:'',observedFrom:'',observedUntil:''}])}}>Adicionar experiência</button>
        <button disabled={experiences.some(e=>!e.typeId||!e.observedFrom||!e.observedUntil)} onClick={()=>action('SET_EXPERIENCES','experiences',{expectedRevision:record.revision,experiences})}>Guardar experiências</button>
      </fieldset>
      <fieldset disabled={disabled}><legend>Associar e verificar evidência guardada</legend>
        <label>Declaração guardada<select value={assertion} onChange={e=>setAssertion(e.target.value)}><option value="">Selecione</option>{record.assertions?.filter(a=>a.knowledgeStatus==='KNOWN').map(a=><option key={a.versionId} value={a.versionId}>{a.conceptRef.conceptId}</option>)}</select></label>
        <label>Experiência guardada<select value={experience} onChange={e=>selectExperience(e.target.value)}><option value="">Selecione</option>{record.experiences?.map(e=><option key={e.versionId} value={e.versionId}>{e.experienceId}</option>)}</select></label>
        <label>Documento autorizado<select value={document} onChange={e=>setDocument(e.target.value)}><option value="">Sem documento</option>{documents.map(d=><option key={d.documentVersionId} value={d.documentVersionId}>{d.documentVersionId}</option>)}</select></label>
        {documentsLoading && <p role="status">A consultar documentos…</p>}
        {documentCursor && <button disabled={disabled || documentsLoading} onClick={() => loadDocuments(experience,documentCursor,documentGeneration.current)}>Mais documentos</button>}
        <button disabled={!assertion||!experience} onClick={()=>action('ATTACH_EVIDENCE','attach',{expectedRevision:record.revision,linkId:crypto.randomUUID(),assertionVersionId:assertion,experienceVersionId:experience,documentVersionId:document||null})}>Associar evidência</button>
        <label>Método de verificação<select value={method} onChange={e=>{setMethod(e.target.value);setUntil('')}}><option value="">Selecione</option>{catalog.VERIFICATION_METHOD?.map(m=><option key={m.entryId} value={m.entryId}>{m.label}</option>)}</select></label>
        {moreCatalog('VERIFICATION_METHOD','métodos de verificação')}
        {selectedMethod && <p>{selectedMethod.documentRequired?'Este método exige documento.':'Este método não exige documento.'} {selectedMethod.maxValiditySeconds===null?'Permite ausência de expiração.':`Limite de validade configurado: ${selectedMethod.maxValiditySeconds} segundos.`}</p>}
        <label>Válida até (UTC)<input type="datetime-local" disabled={selectedMethod?.maxValiditySeconds===null} value={until} onChange={e=>setUntil(e.target.value)}/></label>
        <button disabled={!assertion||!method||(selectedMethod?.maxValiditySeconds!==null&&!until)} onClick={()=>action('VERIFY','verify',{expectedRevision:record.revision,verificationId:crypto.randomUUID(),assertionVersionId:assertion,methodId:method,validUntil:until?utc(until):null})}>Verificar competência</button>
        <button onClick={onMfa}>Confirmar autentica??o</button>
      </fieldset>
    </>}
  </section>
}
