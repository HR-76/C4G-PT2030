'use strict';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const fail=code=>{throw Object.assign(new Error(code),{code});};
const authoritySql=`SELECT u.id FROM public.application_session s
 JOIN public.global_user u ON u.id=s.global_user_id
 JOIN public.platform_admin_assignment a ON a.global_user_id=u.id
 WHERE s.sid=$1 AND u.id=$2 AND s.status='ACTIVE' AND s.expires_at>clock_timestamp()
 AND s.revocation_version=u.session_revocation_version AND u.status='ACTIVE'
 AND a.role_code='C4G_ADMIN' AND a.status='ACTIVE'`;
function query(input={},kind){
 if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(k=>!['q','status','page','organizationId'].includes(k)))fail('INVALID_INPUT');
 const q=input.q??'',status=input.status??'',page=input.page??'1',organizationId=input.organizationId??'';
 if(typeof q!=='string'||q.length>150||/[\x00-\x1f]/.test(q)||typeof status!=='string'||
   !(kind==='entities'?['','ACTIVE','PROVISIONING','SUSPENDED','TERMINATING','ARCHIVED']:['','ACTIVE','SUSPENDED','ARCHIVED']).includes(status)||
   typeof page!=='string'||! /^[1-9][0-9]{0,4}$/.test(page)||typeof organizationId!=='string'||
   (organizationId&&(!UUID.test(organizationId)||kind!=='users')))fail('INVALID_INPUT');
 return {q:q.trim(),status,page:Number(page),organizationId:organizationId||null};
}
const eligible=`m.status='ACTIVE' AND u.status='ACTIVE' AND o.status='ACTIVE'
 AND m.valid_from<=clock_timestamp() AND (m.valid_until IS NULL OR m.valid_until>clock_timestamp())`;
const entitySelect=`SELECT o.id,o.display_name AS name,o.legal_name AS "legalName",o.slug,
 o.type_code AS "typeCode",o.status,o.reporting_currency AS currency,o.created_at AS "createdAt",
 (SELECT count(*)::int FROM public.organization_membership m JOIN public.global_user u ON u.id=m.global_user_id
 WHERE m.organization_id=o.id AND ${eligible}) AS "activeAccounts",
 COALESCE((SELECT jsonb_agg(v) FROM (SELECT u.display_name AS name,u.primary_email AS email
 FROM public.organization_membership m JOIN public.global_user u ON u.id=m.global_user_id
 WHERE m.organization_id=o.id AND m.base_role_code='ORG_ADMIN' AND ${eligible}
 ORDER BY u.display_name,u.id LIMIT 10) v),'[]') AS administrators
 FROM public.organization o`;
function createPlatformDirectory({pool,logs,health}){
 if(!pool||typeof pool.connect!=='function')throw TypeError('Central pool required');
 async function read(request,work){
  const sid=request.authContext?.sessionId,userId=request.user?.id;
  if(!sid||sid!==request.sessionID||!UUID.test(userId||''))fail('C4G_ADMIN_REQUIRED');
  const c=await pool.connect();
  try{
   await c.query('BEGIN READ ONLY');await c.query("SET LOCAL statement_timeout='5s'");
   const authorize=async()=>{if(!(await c.query(authoritySql,[sid,userId])).rowCount)fail('C4G_ADMIN_REQUIRED');};
   await authorize();const result=await work(c);await authorize();await c.query('COMMIT');return result;
  }catch(e){await c.query('ROLLBACK').catch(()=>{});throw e;}finally{c.release();}
 }
 return Object.freeze({
  importAvailability(input,request){return read(request,async()=>{if(!input||Object.keys(input).length)fail('INVALID_INPUT');return {available:false,code:'CENTRAL_IMPORT_NOT_CONFIGURED'};});},
  dashboard(input,request){return read(request,async c=>{if(!input||Object.keys(input).length)fail('INVALID_INPUT');const result=await require('./dashboard').dashboard(c,logs);let dependencies=null;try{const state=await health?.check();if(state&&['READY','DEGRADED','UNAVAILABLE'].includes(state.status)&&Array.isArray(state.reasons))dependencies={status:state.status,reasons:state.reasons.filter(x=>typeof x==='string'&&/^[A-Z0-9_-]{1,80}$/.test(x))};}catch{}const values=[pool.totalCount,pool.idleCount,pool.waitingCount,pool.options?.max];const capacity=values.every(Number.isSafeInteger)&&values.every(x=>x>=0)&&values[3]>0?{total:values[0],idle:values[1],waiting:values[2],max:values[3]}:null;return {...result,operational:{dependencies,capacity}};});},
  logs(input,request){return read(request,async c=>{if(!logs)throw Error('LOGS_UNAVAILABLE');return require('./logs').listLogs(c,input,logs);});},
  entities(input,request){return read(request,async c=>{
   const p=query(input,'entities'),values=[p.q,p.status,50,(p.page-1)*50];
   const where=`WHERE ($1='' OR strpos(lower(o.display_name),lower($1))>0 OR strpos(lower(o.legal_name),lower($1))>0 OR strpos(lower(o.slug),lower($1))>0) AND ($2='' OR o.status=$2)`;
   const total=(await c.query(`SELECT count(*)::int total FROM public.organization o ${where}`,values.slice(0,2))).rows[0].total;
   const items=(await c.query(`${entitySelect} ${where} ORDER BY o.display_name,o.id LIMIT $3 OFFSET $4`,values)).rows;
   return {items,total,page:p.page,pageSize:50};
  });},
  entity(id,request){return read(request,async c=>{if(!UUID.test(id||''))fail('INVALID_INPUT');const row=(await c.query(entitySelect+' WHERE o.id=$1',[id])).rows[0];if(!row)fail('RESOURCE_NOT_AVAILABLE');return row;});},
  users(input,request){return read(request,async c=>{
   const p=query(input,'users'),values=[p.q,p.status,p.organizationId,50,(p.page-1)*50];
   const where=`WHERE ($1='' OR strpos(lower(u.display_name),lower($1))>0 OR strpos(lower(u.primary_email),lower($1))>0)
    AND ($2='' OR u.status=$2) AND ($3::uuid IS NULL OR EXISTS(SELECT 1 FROM public.organization_membership f WHERE f.global_user_id=u.id AND f.organization_id=$3))`;
   const total=(await c.query(`SELECT count(*)::int total FROM public.global_user u ${where}`,values.slice(0,3))).rows[0].total;
   const items=(await c.query(`SELECT u.id,u.display_name AS name,u.primary_email AS email,u.status,
    COALESCE((SELECT jsonb_agg(DISTINCT a.role_code) FROM public.platform_admin_assignment a WHERE a.global_user_id=u.id AND a.status='ACTIVE'),'[]') AS "platformRoles",
    (SELECT count(*)::int FROM public.organization_membership m WHERE m.global_user_id=u.id) AS "membershipCount",
    COALESCE((SELECT jsonb_agg(v) FROM (SELECT m.id AS "membershipId",o.id AS "organizationId",o.display_name AS "organizationName",m.base_role_code AS "roleCode",m.status,
    m.valid_from AS "validFrom",m.valid_until AS "validUntil",(${eligible}) AS effective
    FROM public.organization_membership m JOIN public.organization o ON o.id=m.organization_id WHERE m.global_user_id=u.id
    ORDER BY (o.id=$3::uuid) DESC NULLS LAST,o.display_name,o.id LIMIT 100) v),'[]') AS memberships
    FROM public.global_user u ${where} ORDER BY u.display_name,u.id LIMIT $4 OFFSET $5`,values)).rows;
   return {items,total,page:p.page,pageSize:50};
  });}
 });
}
module.exports={createPlatformDirectory,query,authoritySql};
