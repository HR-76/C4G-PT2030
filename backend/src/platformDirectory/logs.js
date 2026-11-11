'use strict';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const failures=new Set(['authentication.callback_failed','authentication.callback_dependency_unavailable','authentication.session_persistence_failed','authentication.session_reconciliation_required','authentication.identity_logout_unavailable','authentication.logout_reconciliation_required']);
const messages={LOGIN:'Entrada na plataforma',AUTH_ERROR:'Não foi possível concluir uma operação de autenticação.',API_ERROR:'Ocorreu um erro ao processar um pedido na aplicação.'};
const PAGE_SIZE=15;
function createPlatformLogs({pool,onFailure=()=>{}}){
 const pending=new Set();let failed=0;
 const failure=()=>{failed++;try{onFailure()}catch{}};
 function record(code,userId,status=null){
  if(!Object.hasOwn(messages,code))return;
  if(pending.size>=500){failure();return;}
  const user=UUID.test(userId||'')?userId:null;
  // Never retain caller-controlled descriptions, URLs, payloads or credentials.
  const task=Promise.resolve().then(()=>pool.query({text:'INSERT INTO public.platform_support_event(code,global_user_id,http_status) VALUES($1,$2,$3)',values:[code,user,status],query_timeout:5000})).catch(failure);
  pending.add(task);task.finally(()=>pending.delete(task));
 }
 return Object.freeze({
  audit(event,details={}){if(event==='authentication.login_succeeded')record('LOGIN',details.globalUserId);else if(failures.has(event))record('AUTH_ERROR',details.globalUserId);},
  middleware(req,res,next){const skip=req.path==='/api/admin/directory/logs';res.once('finish',()=>{if(!skip&&res.statusCode>=500&&res.statusCode<=599)record('API_ERROR',req.user?.id,res.statusCode)});next();},
  status:()=>({failedEvents:failed}),
  async flush(){await Promise.all([...pending]);}
 });
}
function logQuery(input={}){
 const fail=()=>{throw Object.assign(Error('INVALID_INPUT'),{code:'INVALID_INPUT'})};
 if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(k=>!['q','type','page'].includes(k)))fail();
 const {q='',type='',page='1'}=input;
 if(typeof q!=='string'||q.length>150||/[\x00-\x1f]/.test(q)||!['','LOGIN','ERROR'].includes(type)||typeof page!=='string'||! /^[1-9][0-9]{0,4}$/.test(page))fail();
 return {q:q.trim(),type,page:Number(page)};
}
async function listLogs(c,input,collector){
 const p=logQuery(input),values=[p.q,p.type];
 const where=`FROM public.platform_support_event e LEFT JOIN public.global_user u ON u.id=e.global_user_id
 WHERE ($1='' OR strpos(lower(u.display_name),lower($1))>0 OR strpos(lower(u.primary_email),lower($1))>0)
 AND ($2='' OR ($2='LOGIN' AND e.code='LOGIN') OR ($2='ERROR' AND e.code<>'LOGIN'))`;
 const total=(await c.query(`SELECT count(*)::int total ${where}`,values)).rows[0].total;
 const items=(await c.query(`SELECT e.id,e.occurred_at AS "occurredAt",u.display_name AS name,u.primary_email AS email,e.code,e.http_status AS "httpStatus" ${where} ORDER BY e.occurred_at DESC,e.id DESC LIMIT $3 OFFSET $4`,[...values,PAGE_SIZE,(p.page-1)*PAGE_SIZE])).rows.map(row=>({...row,type:row.code==='LOGIN'?'LOGIN':'ERROR',description:messages[row.code]}));
 const activatedAt=(await c.query("SELECT applied_at FROM public.c4g_schema_migration WHERE version='026_platform_logs'")).rows[0]?.applied_at;
 return {items,total,page:p.page,pageSize:PAGE_SIZE,activatedAt,collection:collector.status()};
}
module.exports={createPlatformLogs,logQuery,listLogs};
