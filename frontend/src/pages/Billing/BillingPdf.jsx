import {useEffect,useMemo,useRef,useState} from 'react'
import {billingFilesApi} from '../../api/api'
import {formatInstant} from '../Platform/billingPresentation'
import './billing-pdf.css'
const errors={PDF_INVALID:'Selecione um PDF válido, até 10 MB.',PDF_REJECTED:'O ficheiro foi rejeitado pela análise de segurança.',PDF_SCAN_UNAVAILABLE:'A análise de segurança não está disponível. O PDF não foi publicado.',STALE_REVISION:'Já existe uma versão mais recente. Atualize os documentos antes de enviar.',IDEMPOTENCY_CONFLICT:'Este pedido já foi usado para outro ficheiro. Atualize os documentos.',NOT_AUTHORIZED:'O acesso à faturação foi retirado.',RESOURCE_NOT_AVAILABLE:'Este documento já não está disponível.',PDF_FEATURE_UNAVAILABLE:'Os PDFs privados ainda não estão disponíveis neste ambiente.',PDF_BUSY:'Existem outros ficheiros em processamento. Tente novamente.'}
export default function BillingPdf({documentId,organizationId,platform=false,api:provided}){
  const api=useMemo(()=>provided||billingFilesApi(organizationId,platform),[provided,organizationId,platform])
  const [data,setData]=useState(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[pending,setPending]=useState(null),[file,setFile]=useState(null),[notice,setNotice]=useState('')
  const epoch=useRef(0),active=useRef(null),input=useRef(null)
  async function load(generation=epoch.current,signal){
    try{const r=await api.list(documentId,signal);if(generation===epoch.current)setData(r.data)}catch(e){if(generation===epoch.current){setData(null);setError(errors[e.response?.data?.error?.code]||'Não foi possível consultar os PDFs.')}}
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- Runs only when the listed keys change; load is read at that moment.
  useEffect(()=>{const generation=++epoch.current,controller=new AbortController();active.current=controller;setData(null);setError('');setFile(null);setPending(null);setBusy(false);setNotice('');load(generation,controller.signal);return()=>{epoch.current += 1;active.current?.abort()}},[api,documentId])
  async function execute(kind,version,command){
    const generation=epoch.current,controller=new AbortController();active.current=controller;setBusy(true);setError('');setNotice('')
    try{
      if(kind==='upload'){
        setPending(command);await api.upload(documentId,command.file,command,controller.signal)
        if(generation!==epoch.current)return
        setPending(null);setFile(null);if(input.current)input.current.value='';setNotice('PDF privado disponibilizado.');await load(generation,controller.signal)
      }else{
        const response=await api.download(documentId,version.id,controller.signal)
        if(generation!==epoch.current)return
        const url=URL.createObjectURL(response.data),link=document.createElement('a');link.href=url;link.download=version.filename;document.body.appendChild(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000)
      }
    }catch(e){if(generation!==epoch.current)return
      let code=e.response?.data?.error?.code
      if(e.response?.data instanceof Blob){try{code=JSON.parse(await e.response.data.text()).error?.code}catch{}if(generation!==epoch.current)return}
      if(e.response?.status<500)setPending(null)
      setError(errors[code]||(kind==='upload'?'O envio não foi confirmado. Pode repetir o mesmo pedido.':'Não foi possível descarregar o PDF.'))
      if([401,403,404].includes(e.response?.status))setData(null)
    }finally{if(generation===epoch.current)setBusy(false)}
  }
  function choose(value){setError('');setNotice('');if(value&&(!/\.pdf$/i.test(value.name)||value.size>10*1024*1024||value.size<16)){setFile(null);setError(errors.PDF_INVALID);return}setFile(value)}
  return <div className="billing-pdf" aria-label="PDF privado">
    {error&&<p role="alert">{error}</p>}{notice&&<p role="status">{notice}</p>}{busy&&<p role="status">A processar PDF…</p>}
    {!data&&!error&&<p role="status">A consultar PDF…</p>}
    {data?.items.length>0?<details><summary>{data.items.length===1?'PDF disponível':`${data.items.length} versões do PDF`}</summary><ul>{data.items.map((version,index)=><li key={version.id}><div><b>{version.filename}</b><small>Versão {version.version}{index===0?' · atual':''} · {formatInstant(version.createdAt)}</small></div><button className="btn btn-outline btn-sm" disabled={busy||Boolean(pending)} onClick={()=>execute('download',version)}>Descarregar PDF{index?' anterior':''}</button></li>)}</ul></details>:data&&<p>PDF ainda não disponibilizado.</p>}
    {platform&&data?.canUpload&&<div className="billing-pdf-upload"><label>PDF original<input ref={input} type="file" accept=".pdf,application/pdf" disabled={busy||Boolean(pending)} onChange={e=>choose(e.target.files?.[0]||null)}/></label>{file&&!pending&&<><p>{data.items.length?'Será criada uma nova versão. O PDF anterior mantém-se no histórico.':'O PDF será disponibilizado aos utilizadores com acesso financeiro após validação.'}</p><button className="btn btn-primary btn-sm" disabled={busy} onClick={()=>execute('upload',null,{file,requestId:crypto.randomUUID(),expectedVersion:data.items[0]?.version||0})}>Confirmar PDF</button></>}</div>}
    {pending&&!busy&&<button className="btn btn-primary btn-sm" onClick={()=>execute('upload',null,pending)}>Repetir o mesmo envio</button>}
    {error&&!pending&&<button className="btn btn-outline btn-sm" disabled={busy} onClick={()=>{setError('');load()}}>Atualizar PDFs</button>}
  </div>
}
