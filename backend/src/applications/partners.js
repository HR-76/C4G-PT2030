'use strict';
const {randomUUID,createHash}=require('node:crypto');
const {canonicalize}=require('../organizationalProfile/canonicalization');
const {uuid,fail}=require('./contracts');
const {resource}=require('./repository');
const {titleExpression}=require('../opportunities/v2/catalogSql');
const ROLES=['RESPONSAVEL','INVESTIGADOR','OUTRO'];
const digest=value=>createHash('sha256').update(canonicalize(value)).digest('hex');
function pageDigest(rows){
 const hash=createHash('sha256').update('[');
 for(let index=0;index<rows.length;index++){
  if(index)hash.update(',');
  // Retain the canonical array depth and per-record bounds without applying a
  // material's 256 KiB limit to the whole internal collection. Existing cursor
  // bytes stay identical; mutation digests still use the bounded helper above.
  hash.update(canonicalize([rows[index]]).slice(1,-1));
 }
 return hash.update(']').digest('hex');
}
function exact(v,keys){if(!v||Array.isArray(v)||Object.getPrototypeOf(v)!==Object.prototype||Object.keys(v).sort().join()!==keys.slice().sort().join())fail();}
function string(v,max,required=false){if(typeof v!=='string'||v!==v.trim()||v.length>max||required&&!v||v.includes('\0'))fail();return v;}
function email(v){string(v,254);if(v&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v))fail();return v;}
function partner(v){
 exact(v,['entity_name','country','research_area_interest','responsible_person','contact','email','people']);
 if(!Array.isArray(v.people)||v.people.length>50)fail();
 const ids=new Set();const people=v.people.map(p=>{
  exact(p,['id','name','role','research_area','contact','email']);if(!ROLES.includes(p.role))fail();
  const id=p.id===null?null:uuid(p.id);if(id&&ids.has(id))fail();if(id)ids.add(id);
  return {id,name:string(p.name,200,true),role:p.role,research_area:string(p.research_area,2000),contact:string(p.contact,200),email:email(p.email)};
 });
 return {entity_name:string(v.entity_name,200,true),country:string(v.country,100),research_area_interest:string(v.research_area_interest,2000),responsible_person:string(v.responsible_person,200),contact:string(v.contact,200),email:email(v.email),people};
}
function parse(method,v){
 if(['partnersBrowse','partnersGet','partnersHistory'].includes(method)){
  const keys=method==='partnersBrowse'?['q','country','person_role','cursor']:['cursor'];
  if(!v||Object.keys(v).some(k=>!keys.includes(k))||Object.values(v).some(x=>typeof x!=='string')||v.cursor?.length>4096)fail();
  if(method!=='partnersBrowse')return {cursor:v.cursor||null};
  const role=v.person_role||'';if(role&&!ROLES.includes(role))fail();return {q:string((v.q||'').trim(),200),country:string(v.country||'',100),person_role:role,cursor:v.cursor||null};
 }
 if(!['partnerCreate','partnerEdit','partnerRemove'].includes(method))fail();
 exact(v,['expectedRevision','idempotencyKey',...(method!=='partnerCreate'?['partnerId']:[]),...(method!=='partnerRemove'?['partner']:[])]);
 if(!Number.isSafeInteger(v.expectedRevision)||v.expectedRevision<1)fail();
 return {expectedRevision:v.expectedRevision,idempotencyKey:uuid(v.idempotencyKey),...(method!=='partnerCreate'?{partnerId:uuid(v.partnerId)}:{}),...(method!=='partnerRemove'?{partner:partner(v.partner)}:{})};
}
const projection=row=>({id:row.partner_id,...row.body,people:row.body.people.filter(p=>p.active),createdAt:new Date(row.created_at).toISOString(),updatedAt:new Date(row.updated_at).toISOString()});
function createPartnersRepository({organizationId:org,actor,protect,authorize,audit,cursor,browseAllowed=async()=>true}){
 async function schema(c){if(!(await c.query("SELECT to_regclass('opportunity_catalog.application_partner') AS relation")).rows[0].relation)fail('SCHEMA_UPGRADE_REQUIRED');}
 async function application(c,id,write=false,intention=null){
  const row=(await c.query('SELECT * FROM opportunity_catalog.application WHERE organization_id=$1 AND application_id=$2',[org,id])).rows[0];if(!row)fail('RESOURCE_NOT_AVAILABLE');
  await protect({operationCode:write?'APPLICATION_EDIT':'APPLICATION_READ',resource:resource(id,org),additionalAuthorizations:[{operationCode:'OPPORTUNITY_READ',resource:resource(row.opportunity_id||org,org,'OPPORTUNITY')},...(row.evaluation_id?[{operationCode:'F14_PREQUALIFICATION_READ',resource:resource(row.evaluation_id,org,'PREQUALIFICATION_EVALUATION')}]:[])],intention});
  if(write&&!await authorize('APPLICATION_READ',resource(id,org)))fail('RESOURCE_NOT_AVAILABLE');
  await schema(c);return row;
 }
 function page(rows,token,bind){
  const hash=pageDigest(rows),position=token?cursor.openCursor(token,bind):null;
  if(position&&(!Number.isSafeInteger(position.offset)||position.offset<0||position.offset%25||position.digest!==hash))fail('INVALID_CURSOR');
  const offset=position?.offset||0,pointer=n=>cursor.cursor({offset:n,digest:hash},bind);
  return {items:rows.slice(offset,offset+25),total:rows.length,page:offset/25+1,nextCursor:offset+25<rows.length?pointer(offset+25):null,previousCursor:offset?pointer(Math.max(0,offset-25)):null};
 }
 async function partnersGet(c,id,input){await application(c,id);
  const head=(await c.query('SELECT revision FROM opportunity_catalog.application_partners WHERE organization_id=$1 AND application_id=$2',[org,id])).rows[0];
  const rows=(await c.query('SELECT * FROM opportunity_catalog.application_partner WHERE organization_id=$1 AND application_id=$2 AND active ORDER BY partner_id',[org,id])).rows;
  const revision=Number(head?.revision||1);
  return {...page(rows.map(projection),input.cursor,{organizationId:org,subjectId:actor.id,route:'partners-get',applicationId:id,revision}),revision,canEdit:await authorize('APPLICATION_EDIT',resource(id,org))};
 }
 async function partnersHistory(c,id,input){await application(c,id);
  const bind={organizationId:org,subjectId:actor.id,route:'partners-history',applicationId:id},after=input.cursor?cursor.openCursor(input.cursor,bind):null;
  if(after!==null&&(!Number.isSafeInteger(after)||after<2))fail('INVALID_CURSOR');
  const rows=(await c.query('SELECT * FROM opportunity_catalog.application_partner_change WHERE organization_id=$1 AND application_id=$2 AND ($3::bigint IS NULL OR revision<$3) ORDER BY revision DESC LIMIT 26',[org,id,after])).rows;
  return {items:rows.slice(0,25).map(r=>({revision:Number(r.revision),kind:r.kind,partnerId:r.partner_id,snapshot:r.snapshot,actorSubjectId:r.actor_subject_id,recordedAt:new Date(r.recorded_at).toISOString()})),nextCursor:rows.length>25?cursor.cursor(Number(rows[24].revision),bind):null};
 }
 async function partnersBrowse(c,id,input){
  await protect({operationCode:'APPLICATION_READ',resource:resource(org,org)});
  if(!await browseAllowed())fail('NOT_AUTHORIZED');
  await schema(c);
  const visible=[];let last=null,exhausted=false;
  for(let n=0;n<=10000;n+=100){
   const limit=n===10000?1:100;
   const rows=(await c.query(`SELECT p.*,a.title AS application_title,a.status AS application_status,a.opportunity_id,a.evaluation_id,
    COALESCE(${titleExpression('a.central_snapshot',"a.central_snapshot->>'title'")},o.title) AS opportunity_title FROM opportunity_catalog.application_partner p
    JOIN opportunity_catalog.application a USING(organization_id,application_id)
    LEFT JOIN opportunity_catalog.opportunity o ON o.organization_id=a.organization_id AND o.opportunity_id=a.opportunity_id
    WHERE p.organization_id=$1 AND p.active AND ($2::uuid IS NULL OR p.partner_id>$2) ORDER BY p.partner_id LIMIT ${limit}`,[org,last])).rows;
   if(n===10000&&rows.length)fail('LIMIT_EXCEEDED');
   for(const r of rows){last=r.partner_id;if(!await authorize('APPLICATION_READ',resource(r.application_id,org))||!await authorize('OPPORTUNITY_READ',resource(r.opportunity_id||org,org,'OPPORTUNITY'))||r.evaluation_id&&!await authorize('F14_PREQUALIFICATION_READ',resource(r.evaluation_id,org,'PREQUALIFICATION_EVALUATION')))continue;
    visible.push({...projection(r),application_id:r.application_id,application_title:r.application_title,application_status:r.application_status,opportunity_title:r.opportunity_title});
   }if(rows.length<100){exhausted=true;break}
  }if(!exhausted)fail('LIMIT_EXCEEDED');
  const countries=[...new Set(visible.map(r=>r.country).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'pt'));
  const needle=input.q.toLocaleLowerCase('pt'),matches=visible.filter(r=>(!input.country||r.country===input.country)&&(!input.person_role||r.people.some(p=>p.role===input.person_role))&&(!needle||[r.entity_name,r.country,r.research_area_interest,r.responsible_person,r.contact,r.email,...r.people.flatMap(p=>[p.name,p.research_area,p.contact,p.email])].some(v=>v.toLocaleLowerCase('pt').includes(needle))));
  matches.sort((a,b)=>a.entity_name.localeCompare(b.entity_name,'pt')||a.id.localeCompare(b.id));
  const {cursor:token,...filters}=input;return {...page(matches,token,{organizationId:org,subjectId:actor.id,route:'partners-browse',...filters}),countries};
 }
 async function mutate(c,method,id,input){
  const hash=digest({method,applicationId:id,input,organizationId:org,subjectId:actor.id});
  await application(c,id,true,{operation:'APPLICATION_EDIT',key:input.idempotencyKey,digest:hash});
  const receipt=(await c.query('SELECT * FROM opportunity_catalog.application_partner_receipt WHERE organization_id=$1 AND idempotency_key=$2',[org,input.idempotencyKey])).rows[0];
  if(receipt){if(receipt.subject_id!==actor.id||receipt.resource_id!==id||receipt.intention_digest!==hash)fail('IDEMPOTENCY_CONFLICT');return receipt.result_projection;}
  await c.query('INSERT INTO opportunity_catalog.application_partners(organization_id,application_id) VALUES($1,$2) ON CONFLICT DO NOTHING',[org,id]);
  const head=(await c.query('SELECT revision FROM opportunity_catalog.application_partners WHERE organization_id=$1 AND application_id=$2 FOR UPDATE',[org,id])).rows[0];if(Number(head.revision)!==input.expectedRevision)fail('STALE_REVISION');
  const partnerId=input.partnerId||randomUUID(),old=method==='partnerCreate'?null:(await c.query('SELECT * FROM opportunity_catalog.application_partner WHERE organization_id=$1 AND application_id=$2 AND partner_id=$3',[org,id,partnerId])).rows[0];
  if(method!=='partnerCreate'&&!old?.active)fail('RESOURCE_NOT_AVAILABLE');
  if(method==='partnerCreate'&&Number((await c.query('SELECT count(*) AS n FROM opportunity_catalog.application_partner WHERE organization_id=$1 AND application_id=$2 AND active',[org,id])).rows[0].n)>=100)fail('LIMIT_EXCEEDED');
  const active=method!=='partnerRemove';let body=old?.body;
  if(active){const previous=old?.body.people||[],ids=new Set(input.partner.people.map(p=>p.id).filter(Boolean));
   for(const person of input.partner.people)if(person.id&&!previous.some(p=>p.id===person.id&&p.active))fail();
   body={...input.partner,people:[...input.partner.people.map(p=>({...p,id:p.id||randomUUID(),active:true})),...previous.filter(p=>!ids.has(p.id)).map(p=>({...p,active:false}))]};
  }
  if(old)await c.query('UPDATE opportunity_catalog.application_partner SET body=$4,active=$5,updated_at=transaction_timestamp() WHERE organization_id=$1 AND application_id=$2 AND partner_id=$3',[org,id,partnerId,body,active]);
  else await c.query('INSERT INTO opportunity_catalog.application_partner(organization_id,application_id,partner_id,body) VALUES($1,$2,$3,$4)',[org,id,partnerId,body]);
  const revision=input.expectedRevision+1,kind={partnerCreate:'PARTNER_CREATED',partnerEdit:'PARTNER_EDITED',partnerRemove:'PARTNER_REMOVED'}[method];
  await c.query('UPDATE opportunity_catalog.application_partners SET revision=$3 WHERE organization_id=$1 AND application_id=$2',[org,id,revision]);
  await c.query('INSERT INTO opportunity_catalog.application_partner_change(organization_id,application_id,revision,kind,partner_id,snapshot,actor_subject_id) VALUES($1,$2,$3,$4,$5,$6,$7)',[org,id,revision,kind,partnerId,{...body,id:partnerId,active},actor.id]);
  await audit(c,{eventCode:'APPLICATION_CHANGED',operationCode:'APPLICATION_EDIT',resourceId:id,idempotencyKey:input.idempotencyKey,auditPrefix:'APP_PARTNER'});
  const result={revision,partnerId,active};await c.query('INSERT INTO opportunity_catalog.application_partner_receipt(organization_id,idempotency_key,subject_id,resource_id,intention_digest,result_projection) VALUES($1,$2,$3,$4,$5,$6)',[org,input.idempotencyKey,actor.id,id,hash,result]);return result;
 }
 return {partnersGet,partnersHistory,partnersBrowse,...Object.fromEntries(['partnerCreate','partnerEdit','partnerRemove'].map(method=>[method,(c,id,i)=>mutate(c,method,id,i)]))};
}
module.exports={parse,createPartnersRepository};
