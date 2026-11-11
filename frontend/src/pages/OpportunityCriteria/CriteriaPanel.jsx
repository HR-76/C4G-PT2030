import LoadingIndicator from '../../components/LoadingIndicator'
import './criteria.css'
import { saveIntention, removeIntention, findIntention } from './intentions'
import { useEffect, useRef, useState } from 'react'
import api from '../../api/api'
import { useAuth } from '../../contexts/AuthContext'
import InfoTooltip from '../../components/InfoTooltip'
const kinds = { COMPETENCY_REQUIREMENT: 'Competência obrigatória', THEMATIC_AFFINITY: 'Afinidade temática', STRATEGIC_PRIORITY_AFFINITY: 'Prioridade estratégica' }
const errorText = e => ({ 400: 'Pedido inválido.', 401: 'Sessão expirada.', 403: 'Não tem autorização para esta operação.', 404: 'Registo indisponível.', 409: 'A revisão ou evidência mudou. Volte a consultar antes de confirmar.' }[e.response?.status] || 'Serviço indisponível ou resultado por confirmar.')
export default function CriteriaPanel({ opportunity, organization }) {
 const auth = useAuth(), root = '/opportunities/' + opportunity.opportunityId + '/criteria'
 const [head, setHead] = useState(null), [record, setRecord] = useState(null), [criteria, setCriteria] = useState([]), [sources, setSources] = useState([]), [catalog, setCatalog] = useState({}), [history, setHistory] = useState({items:[]})
 const [busy, setBusy] = useState(false), [loading, setLoading] = useState(true), [error, setError] = useState(''), [notice, setNotice] = useState(''), [dirty, setDirty] = useState(false), [confirm, setConfirm] = useState(false), [pending, setPending] = useState(null), [adopt, setAdopt] = useState(false)
 const alive = useRef(false), generation = useRef(0), mutex = useRef(false), timer = useRef(null), title = useRef(null), alert = useRef(null)
 const identity = {userId:auth.user.id,organizationId:organization.id,opportunityId:opportunity.opportunityId}
 const valid = n => alive.current && n === generation.current
 function pendingLoad() { const value=findIntention(identity);setPending(value);return value }
 async function session() { const data = await auth.refreshSession({timeout:10000}); if(data.user?.id!==identity.userId || data.organization?.id!==identity.organizationId) throw new Error('Session changed'); return alive.current }
 function fill(value) { setAdopt(false); setRecord(value); setCriteria(value.criteria.map(({required,verificationRequired,...c})=>c)); setSources(value.sources); setDirty(false); setConfirm(false) }
 async function load() { const n=++generation.current; setLoading(true); setError('');setConfirm(false)
 try { if(!await session()||!valid(n))return; const h=(await api.get(root)).data;if(!valid(n))return;setHead(h)
 if(h.head){const r=(await api.get(root+'/revisions/'+h.head.revisionId)).data;if(!valid(n))return;fill(r)}else{setRecord(null);setCriteria([]);setSources([]);setDirty(false)}
 const pages={};for(const kind of Object.keys(kinds)){if(!valid(n))return;pages[kind]=(await api.get(root+'/catalog',{params:{kind}})).data}if(!valid(n))return;setCatalog(pages)
 const list=(await api.get(root+'/revisions')).data;if(!valid(n))return;setHistory(list);pendingLoad();title.current?.focus()
 }catch(e){if(valid(n)){setHead(null);setRecord(null);setCriteria([]);setSources([]);setHistory({items:[]});setError(errorText(e))}}finally{if(valid(n))setLoading(false)} }
 // eslint-disable-next-line react-hooks/exhaustive-deps -- Runs only when the listed keys change; load is read at that moment.
 useEffect(()=>{alive.current=true;load();return()=>{alive.current=false;generation.current += 1;clearTimeout(timer.current)}},[])
 useEffect(()=>{if(error)alert.current?.focus()},[error])
 async function recover(value,attempt=0,deadline=Date.now()+30000){if(!alive.current||mutex.current||document.visibilityState==='hidden')return;mutex.current=true;setBusy(true)
 try{if(!await session())return;const budget=deadline-Date.now();if(budget<=0)return;const {requestId,operation,resourceId}=value;const r=(await api.post(root+'/intentions/lookup',{requestId,operation,resourceId},{timeout:Math.min(10000,budget)})).data;if(!alive.current)return
 if(['CONFIRMED','FAILED_FINAL'].includes(r.status)){removeIntention(requestId);setPending(null);setNotice(r.status==='CONFIRMED'?'Operação confirmada.':'Rollback comprovado. Consulte antes de iniciar outra operação.');await load()}
 else {setNotice('Resultado não confirmado. Contacte o suporte se persistir. Referência: '+r.correlationId+' · Intenção: '+requestId);if(attempt<2&&Date.now()+5000<deadline)timer.current=setTimeout(()=>recover(value,attempt+1,deadline),5000)}
 }catch(e){if(alive.current)setError(errorText(e))}finally{mutex.current=false;if(alive.current)setBusy(false)}}
 // eslint-disable-next-line react-hooks/exhaustive-deps -- Runs only when the listed keys change; pending, recover are read at that moment.
 useEffect(()=>{if(pending&&!loading){timer.current=setTimeout(()=>recover(pending),1000)}return()=>clearTimeout(timer.current)},[pending?.requestId,loading])
 async function write(method){if(mutex.current||pending||head?.opportunityRevisionId!==opportunity.revisionId||(method==='save'&&record?.opportunityRevisionId!==head?.opportunityRevisionId&&record&&!adopt))return;mutex.current=true;setBusy(true);setError('');let intent,sent=false
 try{if(!await session())return;const requestId=crypto.randomUUID(),revisionId=record?.revisionId;intent={...identity,requestId,operation:method==='save'?'SAVE_REVISION':'CONFIRM',resourceId:method==='save'?opportunity.opportunityId:revisionId};
 const body={requestId,expectedHeadRevision:head.head?.revisionNumber||0,opportunityRevisionId:head.opportunityRevisionId,...(method==='save'?{criteria,sources}:{})};saveIntention(intent);sent=true
 await api.post(root+(method==='save'?'/revisions':'/revisions/'+revisionId+'/confirm'),body,{timeout:15000});if(!alive.current)return;removeIntention(requestId);setNotice(method==='save'?'Nova revisão guardada.':'Interpretação editorial confirmada. Não significa elegibilidade.');setConfirm(false);await load()
 }catch(e){if(!alive.current)return;if(intent&&sent&&(!e.response||e.response.status>=500)){setPending(intent);setNotice('Resultado por confirmar. Novas gravações estão suspensas.')}else if(intent)removeIntention(intent.requestId);setError(errorText(e))}finally{mutex.current=false;if(alive.current)setBusy(false)}}
 async function review(){if(mutex.current||dirty||pending)return;mutex.current=true;setBusy(true);const n=generation.current
 try{if(!await session()||!valid(n))return;const h=(await api.get(root)).data;const r=(await api.get(root+'/revisions/'+record.revisionId)).data;if(!valid(n))return
 if(h.head?.revisionId!==r.revisionId||h.opportunityRevisionId!==r.opportunityRevisionId||!r.actions.canConfirm)throw {response:{status:409}};setHead(h);fill(r);setConfirm(true)
 }catch(e){if(valid(n))setError(errorText(e))}finally{mutex.current=false;if(alive.current)setBusy(false)}}
 async function openRevision(revisionId){const n=++generation.current;setLoading(true);try{const r=(await api.get(root+'/revisions/'+revisionId)).data;if(valid(n))fill(r)}catch(e){if(valid(n))setError(errorText(e))}finally{if(valid(n))setLoading(false)}}
 async function more(kind){const n=generation.current;try{const page=kind?(await api.get(root+'/catalog',{params:{kind,cursor:catalog[kind].nextCursor}})).data:(await api.get(root+'/revisions',{params:{cursor:history.nextCursor}})).data;if(!valid(n))return;if(kind)setCatalog(old=>({...old,[kind]:{...page,items:[...old[kind].items,...page.items]}}));else setHistory(old=>({...page,items:[...old.items,...page.items]}))}catch(e){if(valid(n))setError(errorText(e))}}
 function change(index,patch){setCriteria(old=>old.map((c,i)=>i===index?{...c,...patch}:c));setDirty(true);setConfirm(false)}
 function source(index,patch){setSources(old=>old.map((s,i)=>i===index?{...s,...patch}:s));setDirty(true);setConfirm(false)}
 const changed=record&&record.opportunityRevisionId!==head?.opportunityRevisionId, parentStale=head&&head.opportunityRevisionId!==opportunity.revisionId
 const historical=record&&record.revisionId!==head?.head?.revisionId,disabled=busy||loading||Boolean(pending)||!head?.actions.canEdit||historical||parentStale
 return <section className="criteria-panel" aria-busy={busy||loading} style={{minWidth:0,maxWidth:'100%'}}>
 <a href={"/pre-qualificacao?opportunityId="+opportunity.opportunityId}>Analisar critérios com o perfil ativo</a>
 <div className="heading-with-info"><h2 ref={title} tabIndex={-1}>Interpretação privada dos critérios</h2><InfoTooltip label="Informação sobre a interpretação dos critérios">Regista a interpretação dos critérios; não verifica se a organização os cumpre.</InfoTooltip></div><p><strong>Organização:</strong> {organization.displayName||organization.display_name||organization.name||organization.id}</p>
 {loading&&<LoadingIndicator>A carregar critérios…</LoadingIndicator>}{error&&<p role="alert" ref={alert} tabIndex={-1}>{error}</p>}{notice&&<p role="status">{notice}</p>}
 <button disabled={busy||loading} onClick={load}>Voltar a consultar critérios</button>
 {pending&&<p role="alert">Operação por resolver. Não inicie outra gravação. <button disabled={busy} onClick={()=>{clearTimeout(timer.current);recover(pending)}}>Consultar resultado</button></p>}
 {record&&<p>Revisão dos critérios {record.revisionNumber} · Oportunidade/revisão {record.opportunityRevisionId} · {record.state==='CONFIRMED'?'Interpretação confirmada':'Rascunho'} · Autor: {record.author.displayLabel} · {record.createdAt}{record.confirmation&&<> · Confirmado por {record.confirmation.displayLabel} em {record.confirmation.confirmedAt}</>}</p>}
 {record?.freshness!=='CURRENT'&&record&&<p role="alert">Referência desatualizada ou indisponível. Guardar nova revisão exige rever a oportunidade e a evidência.</p>}
 {parentStale&&<p role="alert">A oportunidade mudou. Use «Recarregar revisão persistida» para rever a versão atual antes de editar.</p>}
 {changed&&!parentStale&&<label><input type="checkbox" checked={adopt} onChange={e=>setAdopt(e.target.checked)}/>Revi a oportunidade na revisão {head.opportunityRevisionId} e a evidência para esta interpretação.</label>}
 {historical&&<p>Revisão histórica, apenas consulta. Volte ao head para editar.</p>}
 {!record&&!loading&&!error&&<p>Ainda não existem interpretações nesta organização.</p>}
 {criteria.map((c,i)=><fieldset key={c.criterionId} disabled={disabled} style={{minWidth:0}}><legend>{kinds[c.kind]}</legend>
 <label>Interpretação<textarea value={c.interpretationText} maxLength={2000} onChange={e=>change(i,{interpretationText:e.target.value})}/></label>
 <label>Conceito publicado<select value={c.conceptRef?.conceptId||''} onChange={e=>change(i,{conceptRef:catalog[c.kind].items.find(x=>x.conceptRef.conceptId===e.target.value)?.conceptRef||null})}><option value="">Selecione</option>{c.conceptRef&&!catalog[c.kind]?.items.some(x=>x.conceptRef.conceptId===c.conceptRef.conceptId)&&<option value={c.conceptRef.conceptId}>Referência guardada — consultar catálogo</option>}{catalog[c.kind]?.items.map(x=><option key={x.conceptRef.conceptId} value={x.conceptRef.conceptId}>{x.label} — {x.releaseVersion}</option>)}</select></label>{catalog[c.kind]?.nextCursor&&<button onClick={()=>more(c.kind)}>Mais conceitos</button>}
 <label>Fonte<select value={c.evidence?.sourceId||''} onChange={e=>change(i,{evidence:e.target.value?{locator:'',excerpt:'',justification:'',...c.evidence,sourceId:e.target.value}:null})}><option value="">Selecione</option>{sources.map(s=><option key={s.sourceId} value={s.sourceId}>{s.label||'Fonte sem nome'}</option>)}</select></label>
 {c.evidence&&['locator','excerpt','justification'].map((key,j)=><label key={key}>{['Cláusula/localização','Trecho exato','Justificação da interpretação'][j]}<textarea value={c.evidence[key]} maxLength={key==='locator'?256:key==='excerpt'?4000:2000} onChange={e=>change(i,{evidence:{...c.evidence,[key]:e.target.value}})}/></label>)}
 <p>{c.kind==='COMPETENCY_REQUIREMENT'?'Obrigatório: prova verificada válida no instante da avaliação. Ausência de prova não prova incumprimento.':'Afinidade não eliminatória.'}</p><button className="btn btn-danger btn-sm" onClick={()=>{setCriteria(old=>old.filter((_,n)=>n!==i));setDirty(true);setConfirm(false)}}>Remover critério</button></fieldset>)}
 {Object.entries(kinds).filter(([kind])=>!criteria.some(c=>c.kind===kind)).map(([kind,label])=><button key={kind} disabled={disabled} onClick={()=>{setCriteria(old=>[...old,{criterionId:crypto.randomUUID(),kind,interpretationText:'',temporalBasis:kind==='COMPETENCY_REQUIREMENT'?'EVALUATION_INSTANT':null}]);setDirty(true);setConfirm(false)}}>Adicionar {label.toLowerCase()}</button>)}
 <a href={"/pre-qualificacao?opportunityId="+opportunity.opportunityId}>Analisar critérios com o perfil ativo</a><h3>Fontes da interpretação</h3><p>Não são evidência de capacidade da organização. Uma transcrição não é uma fonte autenticada automaticamente.</p>
 {sources.map((s,i)=><fieldset key={s.sourceId} disabled={disabled} style={{minWidth:0}}><legend>Fonte {i+1}</legend><label>Tipo<select value={s.sourceKind} onChange={e=>source(i,{sourceKind:e.target.value})}><option value="SYNTHETIC">Sintética</option><option value="EDITORIAL_TRANSCRIPTION">Transcrição editorial</option></select></label>{['label','reference','versionLabel','capturedText'].map((key,j)=><label key={key}>{['Nome da fonte','Referência da fonte','Versão da fonte','Texto capturado'][j]}<textarea value={s[key]} maxLength={[200,2048,128,12000][j]} onChange={e=>source(i,{[key]:e.target.value})}/></label>)}</fieldset>)}
 <button disabled={disabled||sources.length>=3} onClick={()=>{setSources(old=>[...old,{sourceId:crypto.randomUUID(),sourceKind:'SYNTHETIC',label:'',reference:'',versionLabel:'',capturedText:''}]);setDirty(true);setConfirm(false)}}>Adicionar fonte</button>
 <button disabled={disabled||!dirty||!criteria.length||(changed&&!adopt)} onClick={()=>write('save')}>Guardar nova revisão</button>
 {record?.findings.length>0&&<p>Revisão incompleta: {record.findings.map(f=>f.code).join(', ')}. Complete a interpretação, referências e evidência.</p>}
 <button disabled={busy||loading||!!pending||dirty||historical||!record?.actions.canConfirm} onClick={review}>Rever e confirmar revisão</button>
 {confirm&&<section aria-label="Confirmar interpretação"><h3>Revisão {record.revisionNumber}</h3><p>Reveja a fonte, interpretação e evidência acima. Confirmo apenas a interpretação editorial desta revisão.</p><button disabled={busy||dirty||!!pending} onClick={()=>write('confirm')}>Confirmar interpretação editorial</button><button disabled={busy} onClick={()=>setConfirm(false)}>Cancelar</button></section>}
 <h3>Histórico</h3><ul>{history.items.map(r=><li key={r.revisionId}><button disabled={busy} onClick={()=>openRevision(r.revisionId)}>Consultar revisão {r.revisionNumber} — {r.state==='CONFIRMED'?'confirmada':'rascunho'}</button></li>)}</ul>{history.nextCursor&&<button disabled={busy} onClick={()=>more()}>Mais revisões</button>}
 </section>
}
