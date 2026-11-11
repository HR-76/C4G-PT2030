'use strict';
const {OrganizationalProfileContractError}=require('./errors');
const {ORIGINS,effectiveState}=require('./financialService');
function fail(code='F13_RESOURCE_NOT_AVAILABLE'){throw new OrganizationalProfileContractError(code);}
function createFinancialResourceLoader({organizationId}){return Object.freeze({async load(client,method,command,replay){
 const head=(await client.query('SELECT * FROM organization_profile.financial_assertion WHERE organization_id=$1 AND assertion_id=$2 FOR UPDATE',[organizationId,command.assertionId])).rows[0];
 let row=null;
 if(method==='create'){if(head&&!replay)fail('F13_STATE_CONFLICT');}else if(!head)fail();
 let revision=head?.head_revision;
 if(method==='read'&&replay){
  const stored=(await client.query("SELECT assertion_id,revision FROM organization_profile.financial_idempotency_record WHERE organization_id=$1 AND operation='FINANCIAL_READ' AND idempotency_key=$2",[organizationId,command.idempotencyKey])).rows[0];
  if(!stored||stored.assertion_id!==command.assertionId)fail('F13_IDEMPOTENCY_CONFLICT');
  revision=stored.revision;
 }
 if(head)row=(await client.query('SELECT *,start_date::text AS start_date,end_date::text AS end_date FROM organization_profile.financial_assertion_revision WHERE organization_id=$1 AND assertion_id=$2 AND revision=$3',[organizationId,command.assertionId,revision])).rows[0];
 if(head&&!row)fail();
 const now=new Date((await client.query('SELECT clock_timestamp() AS now')).rows[0].now).getTime();
 if(!replay&&ORIGINS[method]&&(!row||!ORIGINS[method].includes(effectiveState(row,now))))fail('F13_STATE_CONFLICT');
 if(!replay&&method!=='create'&&method!=='read'&&Number(head.head_revision)!==command.expectedRevision)fail('F13_STALE_REVISION');
 const authors=[];if(['verify','reject'].includes(method))authors.push(...(await client.query("SELECT actor_subject_id FROM organization_profile.financial_assertion_revision WHERE organization_id=$1 AND assertion_id=$2 AND operation IN('CREATE','EDIT','SUBMIT') ORDER BY revision",[organizationId,command.assertionId])).rows.map(r=>r.actor_subject_id));
 const docs=method==='create'||method==='edit'?command.documentVersionIds:row?.document_version_ids||[];
 const additionalAuthorizations=[];
 for(const version of docs){const doc=(await client.query('SELECT * FROM document_storage.load_financial_reference($1,$2,$3)',[organizationId,version,command.assertionId])).rows[0];if(!doc)fail();
  if(['verify','reject'].includes(method)){authors.push(doc.author_subject_id);const author=(await client.query('SELECT actor_subject_id FROM organization_profile.financial_assertion_revision WHERE organization_id=$1 AND assertion_id=$2 AND $3=ANY(document_version_ids) ORDER BY revision',[organizationId,command.assertionId,version])).rows;authors.push(...author.map(r=>r.actor_subject_id));}
  if(!additionalAuthorizations.some(a=>a.resource.id===doc.document_id))additionalAuthorizations.push({operationCode:'DOCUMENT_READ',resource:Object.freeze({id:doc.document_id,resourceType:'DOCUMENT',organizationId,scopeType:'ORGANIZATION',scopeId:null,status:'ACTIVE',distinctFromActorIds:[],unitId:null,teamIds:[],ancestorUnitIds:[]})});
 }
 return {resource:Object.freeze({id:method==='create'?organizationId:command.assertionId,resourceType:method==='create'?'FINANCIAL_SCOPE':'FINANCIAL_FACT',organizationId,scopeType:'ORGANIZATION',scopeId:null,status:'ACTIVE',distinctFromActorIds:Object.freeze([...new Set(authors)]),unitId:null,teamIds:[],ancestorUnitIds:[]}),state:{head,row,now},additionalAuthorizations};
}});}
module.exports={createFinancialResourceLoader};
