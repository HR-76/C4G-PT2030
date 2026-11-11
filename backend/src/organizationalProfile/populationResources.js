'use strict';
const {OrganizationalProfileContractError}=require('./errors');
const {ORIGINS,effectiveState}=require('./populationService');
function fail(code='F13_RESOURCE_NOT_AVAILABLE'){throw new OrganizationalProfileContractError(code);}
function createPopulationResourceLoader({organizationId}){return Object.freeze({async load(client,method,command,replay,intention){
 const head=(await client.query('SELECT * FROM organization_profile.population_assertion WHERE organization_id=$1 AND assertion_id=$2 FOR UPDATE',[organizationId,command.assertionId])).rows[0];
 let row=null,validationCode=null;
 if(method==='create'){if(head&&!replay)validationCode='F13_STATE_CONFLICT';}else if(!head)fail('F13_AUTHORIZATION_REQUIRED');
 let revision=head?.head_revision,authorRevisionLimit=null;
 if(method==='verify'&&replay){
  // The head is locked, and the immutable source-local record selects the
  // original pre-verification material. Never derive this boundary from CAS
  // supplied by the caller, or include the successful checker in their own retry.
  const stored=(await client.query("SELECT i.assertion_id,i.revision,i.intention_digest,r.operation,r.state FROM organization_profile.population_idempotency_record i JOIN organization_profile.population_assertion_revision r ON r.organization_id=i.organization_id AND r.assertion_id=i.assertion_id AND r.revision=i.revision WHERE i.organization_id=$1 AND i.operation='POPULATION_VERIFY' AND i.idempotency_key=$2",[organizationId,command.idempotencyKey])).rows[0];
  if(!stored||stored.assertion_id!==command.assertionId)validationCode='F13_IDEMPOTENCY_CONFLICT';
  else{
   if(stored.operation!=='VERIFY'||stored.state!=='VERIFIED'||!Number.isSafeInteger(Number(stored.revision))||Number(stored.revision)<2||Number(stored.revision)>Number(head.head_revision))fail('F13_AUTHORIZATION_REQUIRED');
   revision=authorRevisionLimit=Number(stored.revision)-1;
   if(!intention||intention.operation!=='POPULATION_VERIFY'||stored.intention_digest!==intention.digest)validationCode='F13_IDEMPOTENCY_CONFLICT';
  }
 }
 if(method==='read'&&replay){
  const stored=(await client.query("SELECT assertion_id,revision FROM organization_profile.population_idempotency_record WHERE organization_id=$1 AND operation='POPULATION_READ' AND idempotency_key=$2",[organizationId,command.idempotencyKey])).rows[0];
  if(!stored||stored.assertion_id!==command.assertionId)validationCode='F13_IDEMPOTENCY_CONFLICT';
  else revision=stored.revision;
 }
 if(head)row=(await client.query('SELECT *,start_date::text AS start_date,end_date::text AS end_date FROM organization_profile.population_assertion_revision WHERE organization_id=$1 AND assertion_id=$2 AND revision=$3',[organizationId,command.assertionId,revision])).rows[0];
 if(head&&!row)fail('F13_AUTHORIZATION_REQUIRED');
 if(authorRevisionLimit!==null&&(row.operation!=='SUBMIT'||row.state!=='SUBMITTED'))fail('F13_AUTHORIZATION_REQUIRED');
 const now=new Date((await client.query('SELECT clock_timestamp() AS now')).rows[0].now).getTime();
 if(!replay&&ORIGINS[method]&&(!row||!ORIGINS[method].includes(effectiveState(row,now))))validationCode='F13_STATE_CONFLICT';
 if(!validationCode&&!replay&&method!=='create'&&method!=='read'&&Number(head.head_revision)!==command.expectedRevision)validationCode='F13_STALE_REVISION';
 const location=method==='create'||method==='edit'?command.organizationalScopeId:row?.organizational_scope_id;
 if(location){const scope=(await client.query('SELECT scope_id FROM organizational_scope.load_population_location($1,$2)',[organizationId,location])).rows[0];if(!scope)fail('F13_AUTHORIZATION_REQUIRED');}
 const authors=[];if(['verify','reject','revoke'].includes(method))authors.push(...(await client.query("SELECT actor_subject_id FROM organization_profile.population_assertion_revision WHERE organization_id=$1 AND assertion_id=$2 AND operation IN('CREATE','EDIT','SUBMIT','VERIFY') AND ($3::bigint IS NULL OR revision<=$3) ORDER BY revision",[organizationId,command.assertionId,authorRevisionLimit])).rows.map(r=>r.actor_subject_id));
 const docs=method==='create'||method==='edit'?command.documentVersionIds:row?.document_version_ids||[];
 const additionalAuthorizations=[];
 for(const version of docs){const doc=(await client.query('SELECT * FROM document_storage.load_population_reference($1,$2,$3)',[organizationId,version,command.assertionId])).rows[0];if(!doc)fail('F13_AUTHORIZATION_REQUIRED');
  if(['verify','reject','revoke'].includes(method)){authors.push(doc.author_subject_id);const author=(await client.query('SELECT actor_subject_id FROM organization_profile.population_assertion_revision WHERE organization_id=$1 AND assertion_id=$2 AND $3=ANY(document_version_ids) AND ($4::bigint IS NULL OR revision<=$4) ORDER BY revision',[organizationId,command.assertionId,version,authorRevisionLimit])).rows;authors.push(...author.map(r=>r.actor_subject_id));}
  if(!additionalAuthorizations.some(a=>a.resource.id===doc.document_id))additionalAuthorizations.push({operationCode:'DOCUMENT_READ',resource:Object.freeze({id:doc.document_id,resourceType:'DOCUMENT',organizationId,scopeType:'ORGANIZATION',scopeId:null,status:'ACTIVE',distinctFromActorIds:[],unitId:null,teamIds:[],ancestorUnitIds:[]})});
 }
 // Lifecycle/CAS/replay mismatch cannot become an oracle for a caller denied by F5.
 // Resource metadata and locks are server-side; detailed validation is post-authorization.
 return {resource:Object.freeze({id:method==='create'?organizationId:command.assertionId,resourceType:method==='create'?'POPULATION_SCOPE':'POPULATION_ASSERTION',organizationId,scopeType:'ORGANIZATION',scopeId:null,status:'ACTIVE',distinctFromActorIds:Object.freeze([...new Set(authors)]),unitId:null,teamIds:[],ancestorUnitIds:[]}),state:{head,row,now},additionalAuthorizations,validate(){if(validationCode)fail(validationCode);}};
}});}
module.exports={createPopulationResourceLoader};
