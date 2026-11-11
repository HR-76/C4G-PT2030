'use strict';
const {createHash}=require('node:crypto');
const Ajv=require('ajv/dist/2020');
const addFormats=require('ajv-formats');
const {validateSnapshotV2}=require('../v2/validation');
const {cloneData,deepFreeze}=require('../v2/data');
const {contentDigestV2}=require('../v2/digests');
const {projectTemporalFacts}=require('../v2/temporal');
const {validate}=require('./contractValidation');
const contract=require('./contract.schema.json');
const extensionSchema=require('./extension.schema.json');
const VERSION='gcni-catalog-projection/1.2';
const {financialRules}=require('./financialMapping');
const names={windows:'Window',documents:'DocumentVersion',fundingRules:'FundingRule',conflicts:'Conflict',relationships:'Relationship',history:'Event',evidence:'Evidence'};
// Extension shape reuses the DTO schema. Its custom formats/invariants are
// checked by the contract validator below, not silently treated as proven here.
const ajv=new Ajv({strict:true,validateFormats:false,coerceTypes:false,removeAdditional:false,useDefaults:false});
addFormats(ajv);ajv.addSchema(contract);const extensionShape=ajv.compile(extensionSchema);
const fail=code=>{throw Object.assign(new Error(code),{code});};
const canonical=v=>Array.isArray(v)?'['+v.map(canonical).join(',')+']':v&&typeof v==='object'?'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}':JSON.stringify(v);
const digest=v=>createHash('sha256').update(canonical(v)).digest('hex');
function stableId(...parts){const h=createHash('sha256').update(canonical(['gcni-catalog-read',...parts])).digest('hex');return `${h.slice(0,8)}-${h.slice(8,12)}-8${h.slice(13,16)}-a${h.slice(17,20)}-${h.slice(20,32)}`;}
function requireValid(type,value){if(!validate(type,value).valid)fail('CATALOG_READ_'+type.toUpperCase()+'_INVALID');return value;}
function emptyExtension(snapshot,binding){
  return {version:'gcni-revision-extension/1.0',extensionId:binding.extensionId,opportunityId:binding.opportunityId,revisionId:binding.revisionId,sourceDigest:contentDigestV2(snapshot),acceptanceDigest:binding.acceptanceDigest,recordedAt:binding.recordedAt,kind:null,...Object.fromEntries(Object.keys(names).map(k=>[k,{completeness:'unknown',items:[]}]))};
}
function temporal(value){
  if(value.precision==='DATE')return {kind:'date',date:value.value};
  if(value.precision==='PERIOD')return {kind:'period',from:value.start?{kind:'date',date:value.start}:null,to:value.end?{kind:'date',date:value.end}:null,label:value.label||''};
  if(value.precision==='INSTANT' && value.originalTimezone){
    const tz=value.originalTimezone;let local;
    if(/^[+-]/.test(tz)){const [h,m]=tz.slice(1).split(':').map(Number);local=new Date(Date.parse(value.value)+(h*60+m)*60000*(tz[0]==='-'?-1:1)).toISOString().slice(0,19);}
    else {const p=Object.fromEntries(new Intl.DateTimeFormat('en-GB',{timeZone:tz,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).formatToParts(new Date(value.value)).map(x=>[x.type,x.value]));local=`${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}`;}
    return {kind:'instant',utc:value.value,originalLocal:local,originalTimezone:tz};
  }
  return null;
}
function calendar(snapshot,ext,revisionId,asOf,issues=[]){
  const id=(kind,key)=>stableId(revisionId,kind,key);
  const originalTemporal=projectTemporalFacts(snapshot,{asOf});
  const mappedState={PLANNED:'planned',UPCOMING:'forthcoming',OPEN:'open',CLOSED:'closed',CANCELLED:'cancelled',UNKNOWN:'unknown'};
  let state=mappedState[originalTemporal.effectiveState]||'unknown';
  let deadline={state:'unknown',at:null,label:'Prazo por confirmar',scopeLabel:'Oportunidade',windowId:null};
  const selected=originalTemporal.nextDeadline||originalTemporal.finalDeadline;
  if(selected){const index=snapshot.schedule.deadlines.value.findIndex(w=>canonical(w)===canonical(selected));const at=temporal(selected.at);if(at && index>=0)deadline={state:'supported',at,label:at.date||at.originalLocal||at.label,scopeLabel:'Oportunidade',windowId:id('window',String(index))};}
  if(ext.windows.items.length){state='unknown';deadline={state:'unknown',at:null,label:'Consultar prazos e condições',scopeLabel:'Oportunidade',windowId:null};}
  const conditional=ext.windows.items.filter(w=>w.applicability==='conditional');
  if(conditional.length===1){state='conditional';const w=conditional[0];deadline={state:'conditional',at:w.closing.state==='PRESENT'?w.closing.value:null,label:w.condition,scopeLabel:w.scopeLabel,windowId:w.id};}
  if(conditional.length>1)issues.push('MULTIPLE_CONDITIONAL_WINDOWS');
  if(['CANCELLED','CLOSED'].includes(originalTemporal.publishedState))state=mappedState[originalTemporal.publishedState];
  if(ext.conflicts.items.some(c=>c.status==='unresolved'&&/schedule|deadline|closing|window/i.test(c.fieldPath))||snapshot.schedule.deadlines.state==='CONFLICT'){
    state='unknown';deadline={state:'conflicted',at:null,label:'Prazos em conflito',scopeLabel:'Oportunidade',windowId:null};
  }
  return {state,deadline,originalTemporal};
}
function buildProjection(input,rawExtension,{asOf}={}){
  const snapshot=validateSnapshotV2(input);
  const ext=cloneData(rawExtension,{maxBytes:4*1024*1024});
  if(!extensionShape(ext))fail('CATALOG_READ_EXTENSION_INVALID');
  for(const id of ['extensionId','opportunityId','revisionId'])requireValid('OpportunityPath',{id:ext[id]});
  requireValid('Instant',{kind:'instant',utc:asOf,originalLocal:asOf?.slice(0,19),originalTimezone:'UTC'});
  requireValid('Instant',{kind:'instant',utc:ext.recordedAt,originalLocal:ext.recordedAt.slice(0,19),originalTimezone:'UTC'});
  if(Date.parse(ext.recordedAt)>Date.parse(asOf))fail('CATALOG_READ_EXTENSION_IN_FUTURE');
  if(ext.sourceDigest!==contentDigestV2(snapshot))fail('CATALOG_READ_SOURCE_DIGEST_MISMATCH');
  const {opportunityId,revisionId}=ext;
  const id=(kind,key)=>stableId(revisionId,kind,key);
  const issues=[];
  const unsupported=reason=>{issues.push(reason);return {state:'UNSUPPORTED',value:null,evidenceIds:[]};};
  const refs=f=>(f.evidenceRefs||[]).map(e=>id('evidence',e));
  const fact=(f,convert=x=>x)=>{
    if(f.state!=='PRESENT')return {state:f.state,value:null,evidenceIds:refs(f)};
    const v=convert(f.value);return v===null?{...unsupported('UNREPRESENTABLE_SOURCE_VALUE'),evidenceIds:refs(f)}:{state:'PRESENT',value:v,evidenceIds:refs(f)};
  };
  const observations=new Map(snapshot.provenance.observations.map(o=>[o.id,o]));
  const sources=new Map(snapshot.sourceRecords.map(s=>[s.key,s]));
  const evidence=snapshot.provenance.evidence.map(e=>{
    const o=observations.get(e.observationId),s=sources.get(o.sourceRecordKey);
    return {id:id('evidence',e.id),namespace:s.namespace,retrievedAt:o.observedAt,sourceUrl:s.url,contentSha256:o.artifactSha256,preservation:'reference_only',locator:{pages:[],sheet:o.document?.sheet||null,range:e.locatorType==='CELL_RANGE'?e.locator:null,section:['JSON_POINTER','CELL_RANGE'].includes(e.locatorType)?null:e.locator,jsonPointer:e.locatorType==='JSON_POINTER'?e.locator:null}};
  });
  const originalWindows=snapshot.schedule.deadlines.state==='PRESENT'?snapshot.schedule.deadlines.value.map((w,i)=>({id:id('window',String(i)),scopeLabel:'Oportunidade',phase:w.phase,round:null,sequence:i+1,opening:fact(snapshot.schedule.opening,temporal),closing:{...fact(snapshot.schedule.deadlines,()=>temporal(w.at))},applicability:'confirmed',condition:null,supersedesId:null,effectiveAt:null,evidenceIds:refs(snapshot.schedule.deadlines)})):[];
  const collections={windows:[...originalWindows,...ext.windows.items],documents:ext.documents.items,fundingRules:[...financialRules(snapshot.financing,id,refs),...ext.fundingRules.items],conflicts:ext.conflicts.items,relationships:ext.relationships.items,history:ext.history.items,evidence:[...evidence,...ext.evidence.items]};
  for(const [k,t] of Object.entries(names))for(const item of collections[k])requireValid(t,item);
  for(const [k,items] of Object.entries(collections))if(new Set(items.map(i=>i.id)).size!==items.length)fail('CATALOG_READ_DUPLICATE_'+k.toUpperCase());
  const evidenceSet=new Set(collections.evidence.map(e=>e.id));
  function evidenceRefs(v){if(!v||typeof v!=='object')return;if(v.evidenceIds?.some(e=>!evidenceSet.has(e)))fail('CATALOG_READ_EVIDENCE_REFERENCE');for(const x of Object.values(v))evidenceRefs(x);}
  evidenceRefs(collections);
  for(const k of ['windows','documents']){
    const field=k==='windows'?'supersedesId':'supersedesVersionId',byId=new Map(collections[k].map(x=>[x.id,x]));
    for(const item of collections[k]){
      const seen=new Set([item.id]);let prev=item[field];
      while(prev){if(!byId.has(prev))fail('CATALOG_READ_SUPERSESSION_REFERENCE');if(seen.has(prev))fail('CATALOG_READ_SUPERSESSION_CYCLE');seen.add(prev);const parent=byId.get(prev);if(k==='documents'&&parent.documentId!==item.documentId)fail('CATALOG_READ_DOCUMENT_IDENTITY');prev=parent[field];}
    }
  }
  if(ext.conflicts.items.some(c=>c.severity==='material'&&c.status==='unresolved'))issues.push('UNRESOLVED_MATERIAL_CONFLICT');
  const allocations=snapshot.financing.allocations.state==='PRESENT'?snapshot.financing.allocations.value:[];
  const money=a=>({amount:a.money.amount,currency:a.money.currency.value,scope:a.scope==='CALL_TOTAL'?'call':a.scope==='TOPIC_OR_SHARED'?'topic':'unknown',basis:a.basis.toLowerCase(),sharedGroupId:a.sharedGroup?stableId('shared-allocation',a.sharedGroup):null});
  collections.funding=allocations.map(a=>({id:id('allocation',a.key),label:a.scope==='CALL_TOTAL'?'Dotação da call/aviso':'Dotação com âmbito próprio',money:{state:'PRESENT',value:money(a),evidenceIds:refs(snapshot.financing.allocations)},programmeId:a.programmeRefs.length===1?a.programmeRefs[0]:null,fundCode:a.fundRefs.length===1?a.fundRefs[0]:null,period:a.period,evidenceIds:refs(snapshot.financing.allocations)}));
  let funding;
  const total=allocations.filter(a=>a.scope==='CALL_TOTAL');
  if(snapshot.financing.allocations.state!=='PRESENT')funding=fact(snapshot.financing.allocations);
  else if(total.length===1&&total[0].money.interpretation==='ZERO_UNEXPLAINED')funding=unsupported('UNEXPLAINED_ZERO_NOT_A_CONFIRMED_TOTAL');
  else if(total.length===1)funding={state:'PRESENT',value:money(total[0]),evidenceIds:refs(snapshot.financing.allocations)};
  else funding=unsupported(total.length?'MULTIPLE_CALL_TOTALS_NOT_SUMMED':'CALL_TOTAL_NOT_AVAILABLE');
  const {state,deadline,originalTemporal}=calendar(snapshot,ext,revisionId,asOf,issues);
  if(ext.conflicts.items.some(c=>c.status==='unresolved'&&/funding|financing|budget/i.test(c.fieldPath)))funding={state:'CONFLICT',value:null,evidenceIds:[]};
  const official=snapshot.links.official.state==='PRESENT'?[{label:'Fonte oficial',url:snapshot.links.official.value}]:[];
  const description=fact(snapshot.description.summary);
  const excerpt=description.state==='PRESENT'?{...description,value:[...description.value].slice(0,280).join('')}:description;
  const observed=[...snapshot.provenance.observations.map(o=>o.observedAt)].sort().at(-1)||null;
  let partial=false,conflicted=false;
  function quality(v){if(!v||typeof v!=='object')return;if(['NOT_COLLECTED','UNSUPPORTED'].includes(v.state))partial=true;if(v.state==='CONFLICT')conflicted=true;for(const x of Object.values(v))quality(x);}
  quality(snapshot);quality(collections);
  if(Object.values(ext).some(v=>v&&typeof v==='object'&&['unknown','partial'].includes(v.completeness)))partial=true;
  conflicted ||= ext.conflicts.items.some(c=>c.status==='unresolved');
  const coreKind=snapshot.identity.kind==='CASCADE_CALL'?'cascade_call':snapshot.publication.value==='PLANNED'?'planned_notice':'unknown';
  if(coreKind==='cascade_call'&&ext.kind&&ext.kind!=='cascade_call')fail('CATALOG_READ_KIND_CONFLICT');
  const kind=ext.kind||coreKind;
  const identityKinds=kind==='cascade_call'?['SOURCE_CALL_ID']:kind==='grant_topic'?['TOPIC_REFERENCE']:['TOPIC_REFERENCE','CALL_REFERENCE','SOURCE_CALL_ID','NOTICE_REFERENCE'];
  const external=snapshot.identity.references.state==='PRESENT'?snapshot.identity.references.value.filter(r=>identityKinds.includes(r.kind)):[];
  const externalCode=external.length===1?{state:'PRESENT',value:external[0].value,evidenceIds:refs(snapshot.identity.references)}:external.length>1?unsupported('MULTIPLE_IDENTIFIERS_WITHOUT_PRIMARY_MAPPING'):snapshot.identity.references.state==='PRESENT'?unsupported('PRIMARY_IDENTIFIER_MAPPING_REQUIRED'):fact(snapshot.identity.references);
  const summary={id:opportunityId,revisionId,externalCode,title:fact(snapshot.description.title),kind,descriptionExcerpt:excerpt,programmes:{items:snapshot.programmes.state==='PRESENT'?snapshot.programmes.value.map(p=>({id:p.key,label:p.label})):[],completeness:snapshot.programmes.state==='PRESENT'?'complete':'unknown'},sources:snapshot.sourceRecords.map(s=>({namespace:s.namespace,externalId:s.externalId,officialUrl:s.url})),opening:fact(snapshot.schedule.opening,temporal),deadline,funding,fundingLabel:funding.state==='PRESENT'?'Dotação da call/aviso':'Dotação da call/aviso por confirmar',status:{code:state,label:{open:'Aberto',closed:'Encerrado',conditional:'Condicionado',planned:'Previsto',forthcoming:'A abrir',cancelled:'Cancelado',unknown:'Por confirmar'}[state],basis:'derived',scopeLabel:'Oportunidade'},quality:{flags:[...(partial||issues.length?['partial']:[]),...(conflicted?['conflicted']:[])],reviewRequired:partial||conflicted||Boolean(issues.length)},freshness:{observedAt:observed,reviewedAt:null,expectedRefreshAt:null,state:'unknown'},officialLinks:official};
  const descriptors=Object.fromEntries([...Object.keys(names),'funding'].map(k=>[k,{completeness:k==='funding'?(issues.some(x=>x.startsWith('FINANCIAL'))?'partial':snapshot.financing.allocations.state==='PRESENT'?'complete':'unknown'):ext[k].completeness,href:`/api/catalog-read/v1/opportunities/${opportunityId}/${k==='fundingRules'?'funding-rules':k}`} ]));
  const detail={summary,description,descriptionTruncated:false,descriptionSourceUrl:official[0]?.url||null,sourceStatus:fact(snapshot.status.published),statusExplanation:originalTemporal.reasonCodes.join('; ')+(ext.windows.items.length?'; Consultar condições adicionais.':''),collections:descriptors};
  requireValid('Detail',detail);for(const row of collections.funding)requireValid('FundingLine',row);
  for(const rows of Object.values(collections))for(const row of rows){const recorded=row.recordedAt||row.retrievedAt||row.observedAt||row.decision?.decidedAt;if(recorded&&Date.parse(recorded)>Date.parse(asOf))fail('CATALOG_READ_FUTURE_EVIDENCE');}
  evidenceRefs(detail);
  const bundle={version:VERSION,inputs:{snapshot,extension:ext},opportunityId,revisionId,extensionId:ext.extensionId,extensionDigest:digest(ext),sourceDigest:ext.sourceDigest,asOf,detail,collections,issues};
  return deepFreeze({...bundle,projectionId:stableId('projection',digest(bundle)),projectionDigest:digest(bundle)});
}
module.exports={VERSION,buildProjection,emptyExtension,stableId,digest,canonical,calendar};
