import {useEffect,useRef,useState} from 'react'
import {platformImportsApi as api} from '../../api/api'
import LoadingIndicator from '../../components/LoadingIndicator'
import CentralImportCatalog from './CentralImportCatalog'

const columns=[['A','Referência'],['D','Aviso'],['E','Programa'],['I','Início previsto'],['J','Fim previsto'],['H','Dotação (valor do ficheiro)']]
const additional=[['B','Beneficiários'],['C','Natureza do aviso'],['F','Objetivo específico'],['G','Fundo'],['K','Quadrimestre'],['L','NUTS II'],['M','Modalidade de candidatura']]
const display=(key,value)=>['I','J'].includes(key)&&/^\d{4}-\d{2}-\d{2}$/.test(value||'')?value.split('-').reverse().join('/'):value??'—'
const errors={
 PT2030_UPLOAD_REJECTED:'O ficheiro foi recusado pela verificação de segurança.',PT2030_SCAN_UNAVAILABLE:'Não foi possível concluir a verificação de segurança. Pode repetir o mesmo envio.',
 PT2030_UPLOAD_CONFLICT:'Este pedido já corresponde a outro ficheiro. Selecione novamente o ficheiro para iniciar um novo pedido.',PT2030_DOCUMENT_CHANGED:'O original guardado não corresponde ao ficheiro verificado. Carregue novamente o ficheiro.',
 PT2030_PLAN_HEADERS_CHANGED:'As colunas não correspondem ao formato do Plano Anual de Avisos suportado.',PT2030_PLAN_DOCUMENT_CONTEXT_REQUIRED:'A folha não identifica o Plano Anual de Avisos. Confirme a folha selecionada.',
 PT2030_PLAN_SHEET_NOT_FOUND:'A folha selecionada não está disponível.',PT2030_PLAN_WORKBOOK_EMPTY:'A folha não contém avisos.',
 PT2030_PLAN_FORMULA_FORBIDDEN:'O ficheiro contém fórmulas que não podem ser importadas.',PT2030_PLAN_EXTERNAL_LINK_FORBIDDEN:'O ficheiro contém ligações ou conteúdo incorporado não suportado.',
 PT2030_UPLOAD_BUSY:'Existe um carregamento em curso. Aguarde e repita o envio.',PT2030_UPLOAD_TOO_LARGE:'Selecione um ficheiro até 10 MiB.',
 C4G_ADMIN_REQUIRED:'Já não tem autorização para esta operação.'
}
const message=error=>errors[error?.response?.data?.error?.code]||(error?.response?.status===400?'O ficheiro ou os dados não são válidos. Confirme o formato do Excel oficial.':'Não foi possível confirmar a operação. Pode repetir o mesmo pedido.')
// catalog: the deployment can also save the candidates and accept the new ones into the Catálogo (mode STAGE_AND_ACCEPT).
export default function CentralImportPreview({catalog=false}){
 const [file,setFile]=useState(null),[document,setDocument]=useState(null),[sheet,setSheet]=useState(''),[preview,setPreview]=useState(null),[page,setPage]=useState(0),[busy,setBusy]=useState(''),[error,setError]=useState('')
 const alive=useRef(true),lock=useRef(false),uploadIntent=useRef(null),previewIntent=useRef(null)
 useEffect(()=>{alive.current=true;return()=>{alive.current=false}},[])
 function choose(event){
  if(lock.current)return
  const chosen=event.target.files?.[0];setError('');setDocument(null);setPreview(null);setSheet('');setPage(0);uploadIntent.current=null;previewIntent.current=null;setFile(null)
  if(!chosen)return
  if(!/\.xlsx$/i.test(chosen.name)||chosen.size<4||chosen.size>10*1024*1024){setError('Selecione um ficheiro .xlsx até 10 MiB.');event.target.value='';return}
  setFile(chosen);uploadIntent.current={file:chosen,requestId:crypto.randomUUID()}
 }
 async function upload(){
  if(lock.current||!uploadIntent.current)return;lock.current=true;setBusy('upload');setError('');setPreview(null)
  const intent=uploadIntent.current
  try{
   const body=new FormData();body.append('requestId',intent.requestId);body.append('file',intent.file)
   const {data}=await api.upload(body)
   if(alive.current){setDocument(data);setSheet('');previewIntent.current=null}
  }catch(e){if(alive.current)setError(message(e))}finally{lock.current=false;if(alive.current)setBusy('')}
 }
 async function inspect(){
  if(lock.current||!document||!sheet)return;lock.current=true;setBusy('preview');setError('');setPreview(null)
  previewIntent.current||={requestId:crypto.randomUUID(),sheetName:sheet}
  try{const {data}=await api.preview(document.requestId,previewIntent.current);if(alive.current){setPreview(data);setPage(0)}}
  catch(e){if(alive.current)setError(message(e))}finally{lock.current=false;if(alive.current)setBusy('')}
 }
 const rows=preview?.rows||[],pages=Math.max(1,Math.ceil(rows.length/50))
 return <section aria-label="Carregamento e pré-visualização central">
  <p>{catalog?'Valide o ficheiro, confira os avisos e leve as oportunidades novas para o Catálogo. Nada é aceite sem a sua confirmação.':'Valide o ficheiro e confira os avisos. Esta etapa não publica oportunidades no Catálogo.'}</p>
  <div className="upload-zone"><label htmlFor="central-plan-file">Ficheiro Excel oficial</label><p>.xlsx · até 10 MiB · até 5.000 linhas</p><input id="central-plan-file" type="file" accept=".xlsx" disabled={!!busy} onChange={choose}/></div>
  {error&&<p role="alert">{error}</p>}
  {busy&&<LoadingIndicator>{busy==='upload'?'A guardar e verificar o ficheiro…':'A validar os avisos…'}</LoadingIndicator>}
  {file&&!document&&<button className="btn btn-primary" disabled={!!busy} onClick={upload}>Carregar e verificar Excel</button>}
  {document&&<section className="detail-section"><h2>Ficheiro verificado</h2><p>{document.filename}</p><label htmlFor="central-plan-sheet">Folha a analisar</label><select id="central-plan-sheet" disabled={!!busy} value={sheet} onChange={event=>{setSheet(event.target.value);setPreview(null);setError('');previewIntent.current=null}}><option value="">Selecione uma folha</option>{document.sheets.map(name=><option key={name} value={name}>{name}</option>)}</select><div className="form-actions"><button className="btn btn-primary" disabled={!!busy||!sheet} onClick={inspect}>Pré-visualizar avisos</button></div></section>}
  {preview&&<section className="detail-section"><h2>Pré-visualização</h2><p>{preview.totalRows} linhas · {preview.validRows} válidas · {preview.errorRows} com erros</p>
   <div className="table-wrap"><table className="data-table"><thead><tr><th>Linha</th>{columns.map(([key,label])=><th key={key}>{label}</th>)}<th>Restantes campos</th><th>Validação</th></tr></thead><tbody>{rows.slice(page*50,(page+1)*50).map(row=><tr key={row.line}><td>{row.line}</td>{columns.map(([key])=><td key={key}>{display(key,row.values[key])}</td>)}<td><details><summary>Ver campos da linha {row.line}</summary><dl>{additional.map(([key,label])=><div key={key}><dt>{label}</dt><dd>{row.values[key]??'—'}</dd></div>)}</dl></details></td><td>{row.errors.length?<><span>Rever dados</span><details><summary>Detalhes</summary>{row.errors.map(code=><p key={code}>{errors[code]||'Verifique os dados desta linha.'} <small>{code}</small></p>)}</details></>:'Válida'}</td></tr>)}</tbody></table></div>
   {pages>1&&<nav aria-label="Páginas da pré-visualização"><button className="btn btn-secondary" disabled={page===0} onClick={()=>setPage(v=>v-1)}>Anterior</button><span> Página {page+1} de {pages} </span><button className="btn btn-secondary" disabled={page+1>=pages} onClick={()=>setPage(v=>v+1)}>Seguinte</button></nav>}
  </section>}
  {catalog&&preview?.previewDigest&&preview.validRows>0&&<CentralImportCatalog key={preview.previewDigest} uploadId={document.requestId} sheetName={preview.sheetName} previewDigest={preview.previewDigest}/>}
 </section>
}
