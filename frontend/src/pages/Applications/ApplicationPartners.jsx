import { useEffect, useRef, useState } from 'react'
import { Plus } from 'lucide-react'
import { privateApplicationsApi as api } from '../../api/api'
import { useConfirmDialog } from '../../components/ConfirmDialog'
import { PartnerForm, PartnerCards, EMPTY_PARTNER } from './PartnerComponents'
import { applicationPartnerIntentKey } from './intentions'
import FormModal from '../../components/FormModal'
import './partner-modal.css'

const kind={PARTNER_CREATED:'Parceiro adicionado',PARTNER_EDITED:'Parceiro atualizado',PARTNER_REMOVED:'Associação removida'}
const clean=p=>Object.fromEntries(Object.keys(EMPTY_PARTNER).map(k=>[k,k==='people'?p.people.map(person=>({id:person.id||null,...Object.fromEntries(['name','role','research_area','contact','email'].map(f=>[f,(person[f]||'').trim()]))})):(p[k]||'').trim()]))
const accessDenied=e=>[401,403,404].includes(e?.response?.status)
const message=e=>e?.response?.status===401?'A sessão terminou. Recupere a sessão e volte a consultar os parceiros.':e?.response?.status===403?'Sem permissão atual para esta ação. Volte a consultar os parceiros.':e?.response?.data?.error?.code==='SCHEMA_UPGRADE_REQUIRED'?'Os parceiros aguardam a atualização local.':e?.response?.status===409?'Os dados mudaram ou foi atingido um limite. Recarregue os parceiros.':e?.response?.status===400?'Verifique os campos ou recarregue a paginação.':e?.response?.status===404?'Candidatura indisponível ou sem permissão.':'Não foi possível confirmar o resultado. Pode repetir o mesmo envio.'

export default function ApplicationPartners({applicationId,userId,organizationId}) {
  const [data,setData]=useState(null),[history,setHistory]=useState({items:[],nextCursor:null}),[form,setForm]=useState(EMPTY_PARTNER),[editing,setEditing]=useState(null)
  const [error,setError]=useState(''),[notice,setNotice]=useState(''),[busy,setBusy]=useState(false),[refresh,setRefresh]=useState(0),[cursor,setCursor]=useState(null)
  const [historyLoading,setHistoryLoading]=useState(true),[historyError,setHistoryError]=useState(false)
  const [loading,setLoading]=useState(true)
  const [editorOpen,setEditorOpen]=useState(false)
  const editorTrigger=useRef(null)
  const hasDraft=Boolean(editing)||Object.keys(EMPTY_PARTNER).some(key=>key==='people'?form.people.length>0:Boolean(form[key]))
  const canEdit=data?.canEdit===true
  const writeAllowed=useRef(false);writeAllowed.current=canEdit
  const reject=e=>{if(accessDenied(e)){writeAllowed.current=false;setData(null);setHistory({items:[],nextCursor:null})}setError(message(e))}
  const section=useRef(null)
  useEffect(()=>{if(data&&window.location.hash==='#parceiros'){section.current?.scrollIntoView?.();section.current?.focus({preventScroll:true})}},[applicationId,data])
  const key=applicationPartnerIntentKey(userId,organizationId,applicationId),{confirm,dialog}=useConfirmDialog(),alive=useRef(true),sending=useRef(false)
  const [pending,setPending]=useState(()=>{try{const p=JSON.parse(sessionStorage.getItem(key)||'null');return p?.userId===userId&&p.organizationId===organizationId&&p.applicationId===applicationId&&['partnerCreate','partnerEdit','partnerRemove'].includes(p.method)?p:null}catch{return null}})
  useEffect(()=>{alive.current=true;return()=>{alive.current=false}},[])
  useEffect(()=>{
    let active=true, denied=false
    const controller=new AbortController()
    writeAllowed.current=false;setData(null);setError('');setLoading(true);setHistoryLoading(true);setHistoryError(false)
    const handleDenial=e=>{denied=true;reject(e);controller.abort()}
    api.partnersGet(applicationId,cursor?{cursor}:{},organizationId,controller.signal)
      .then(({data})=>{if(active&&!denied)setData(data)})
      .catch(e=>{if(active&&!denied){if(accessDenied(e))handleDenial(e);else reject(e)}})
      .finally(()=>{if(active)setLoading(false)})
    api.partnersHistory(applicationId,{},organizationId,controller.signal)
      .then(({data})=>{if(active&&!denied)setHistory(data)})
      .catch(e=>{if(active&&!denied){if(accessDenied(e))handleDenial(e);else setHistoryError(true)}})
      .finally(()=>{if(active)setHistoryLoading(false)})
    return()=>{active=false;controller.abort()}
  },[applicationId,organizationId,cursor,refresh])
  const send=async(method,fields,retry=false)=>{
    if(sending.current||!writeAllowed.current||retry&&(!pending||pending.userId!==userId||pending.organizationId!==organizationId||pending.applicationId!==applicationId))return;sending.current=true;setBusy(true);setError('');setNotice('')
    let intent=pending
    try {
      if(!retry){if(pending)throw Error('PENDING');intent={userId,organizationId,applicationId,method,payload:{...fields,expectedRevision:data.revision,idempotencyKey:crypto.randomUUID()}};sessionStorage.setItem(key,JSON.stringify(intent));setPending(intent)}
      await api[intent.method](applicationId,intent.payload,organizationId)
      sessionStorage.removeItem(key)
      if(alive.current){setPending(null);setForm(EMPTY_PARTNER);setEditing(null);setEditorOpen(false);setNotice('Parceiros atualizados.');setCursor(null);setRefresh(v=>v+1)}
    }catch(e){if(alive.current){if(e?.response?.status===400||['STALE_REVISION','STATE_CONFLICT','LIMIT_EXCEEDED'].includes(e?.response?.data?.error?.code)){sessionStorage.removeItem(key);setPending(null);setData(null)}reject(e)}}
    finally{sending.current=false;if(alive.current)setBusy(false)}
  }
  const remove=async partnerId=>{if(await confirm({title:'Remover associação ao parceiro?',message:'A ficha e os contactos ficam conservados no histórico da candidatura.',confirmLabel:'Remover associação',tone:'danger'}))await send('partnerRemove',{partnerId})}
  const feedback=<>{error&&<p role="alert">{error}</p>}{notice&&<p role="status">{notice}</p>}
    {pending&&<p role="status">Envio por confirmar. {canEdit?<button type="button" disabled={busy} onClick={()=>send(null,null,true)}>Repetir envio de parceiros</button>:'A intenção está preservada. Confirme a sessão e as permissões antes de continuar.'}</p>}</>
  return <section ref={section} tabIndex={-1} id="parceiros" className="detail-section application-partners" aria-label="Parceiros da candidatura">
    {dialog}
    <div className="section-hd application-section-actions">
      <h2>Parceiros {data && `(${data.total})`}</h2>
      {canEdit && <button type="button" className="btn btn-primary" aria-haspopup="dialog" disabled={busy || Boolean(pending)}
        onClick={event => { editorTrigger.current = event.currentTarget; setEditorOpen(true) }}>
        <Plus size={16} aria-hidden="true" /> {hasDraft ? 'Continuar ficha de parceiro' : 'Adicionar parceiro'}
      </button>}
    </div>
    {(!editorOpen||!canEdit)&&feedback}
    {data && !canEdit && !pending && <p className="text-muted">Acesso de consulta aos parceiros da candidatura.</p>}
    {data&&pending&&!canEdit&&<button className="btn btn-outline" disabled={busy} onClick={()=>{setCursor(null);setRefresh(v=>v+1)}}>Recarregar parceiros</button>}
    {!data?(loading ? <p role="status">A carregar parceiros…</p> : <button type="button" className="btn btn-outline" onClick={()=>{setCursor(null);setRefresh(v=>v+1)}} disabled={busy}>Recarregar parceiros</button>):<>
      {canEdit&&editorOpen&&<FormModal title={editing?'Editar parceiro':'Adicionar parceiro'} locked={busy||!!pending} returnFocusRef={editorTrigger} onClose={()=>setEditorOpen(false)}><div className="application-partner-editor">{feedback}<fieldset disabled={busy||!!pending} className="partner-fields"><PartnerForm form={form} saving={busy} editing={!!editing} onChange={setForm} onCancel={()=>setEditorOpen(false)} onSubmit={e=>{e.preventDefault();send(editing?'partnerEdit':'partnerCreate',{partner:clean(form),...(editing?{partnerId:editing}:{})})}}/></fieldset></div></FormModal>}
      {canEdit&&hasDraft&&!editorOpen&&!pending&&<p className="partner-draft-notice">A ficha por guardar está preservada nesta página. <button type="button" className="btn btn-secondary btn-sm" disabled={busy} onClick={()=>{setForm(EMPTY_PARTNER);setEditing(null)}}>Descartar rascunho</button></p>}
      {data.items.length?<PartnerCards partners={data.items} canEditPartners={canEdit&&!busy&&!pending&&!hasDraft} editPartner={p=>{editorTrigger.current=null;setEditing(p.id);setForm(clean(p));setEditorOpen(true)}} removePartner={remove}/>:<p className="empty-row">Sem parceiros nesta candidatura.</p>}
      {(data.previousCursor||data.nextCursor)&&<nav aria-label="Paginação dos parceiros da candidatura"><button disabled={!data.previousCursor||busy} onClick={()=>setCursor(data.previousCursor)}>Anterior</button> Página {data.page} <button disabled={!data.nextCursor||busy} onClick={()=>setCursor(data.nextCursor)}>Seguinte</button></nav>}
      <h3>Histórico de parceiros</h3>
      {historyLoading&&<p role="status">A carregar histórico de parceiros…</p>}
      {historyError&&<p role="alert">Não foi possível carregar o histórico de parceiros. <button type="button" disabled={busy||!!pending} onClick={()=>setRefresh(v=>v+1)}>Repetir consulta</button></p>}
      {!historyLoading&&!historyError&&!history.items.length&&<p className="text-muted">Sem alterações registadas.</p>}
      {!historyLoading&&!historyError&&history.items.map(h=><details key={h.revision}><summary>{kind[h.kind]} — {h.snapshot.entity_name} · {new Date(h.recordedAt).toLocaleString('pt-PT')}</summary>
        <p className="text-muted">Revisão {h.revision} · Autor: {h.actorSubjectId}</p>
        <PartnerCards partners={[{...h.snapshot,people:h.snapshot.people.filter(p=>p.active)}]} canEditPartners={false}/>
        {h.snapshot.people.filter(p=>!p.active).map(p=><p key={p.id}>Pessoa removida: {p.name} · {p.role} · {p.research_area} · {[p.contact,p.email].filter(Boolean).join(' | ')}</p>)}
      </details>)}
      {!historyLoading&&!historyError&&history.nextCursor&&<button disabled={busy} onClick={async()=>{setBusy(true);try{const r=await api.partnersHistory(applicationId,{cursor:history.nextCursor},organizationId);if(alive.current)setHistory(h=>({items:[...h.items,...r.data.items],nextCursor:r.data.nextCursor}))}catch(e){if(alive.current)reject(e)}finally{if(alive.current)setBusy(false)}}}>Mais histórico de parceiros</button>}
    </>}
  </section>
}
