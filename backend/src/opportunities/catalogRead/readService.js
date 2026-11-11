'use strict';
const {randomUUID}=require('node:crypto');
const {buildProjection,digest}=require('./model');
const {validate}=require('./contractValidation');
const {createTokens}=require('./tokens');
const Q=require('./readQuery');
const {fail}=require('./readErrors');
const TTL=900000,VERSION='gcni-catalog-read/1.0',NORMALIZATION='gcni-nfc-fold/1.0';
const collections={windows:'Window',funding:'FundingLine','funding-rules':'FundingRule',documents:'DocumentVersion',conflicts:'Conflict',relationships:'Relationship',history:'Event',evidence:'Evidence'};
function createReadService({repository,authorize,key,clock=()=>Date.now(),exposure=null,describe=projection=>projection.detail,presentSummary=null}){
 if(typeof authorize!=='function'||!repository?.load)throw new TypeError('Authority and repository required');
 const tokens=createTokens(key);
 async function request({principal,path,pairs=[],requestId=randomUUID()}){
  const started=clock();let authority;
  try{authority=await authorize(principal,started);}catch(e){if(e.status)throw e;fail('CATALOG_UNAVAILABLE');}
  if(!authority?.scope||authority.expiresAt<=started)fail('ACCESS_DENIED');
  const ticket=exposure?await exposure.begin(authority):null;
  if(path==='/availability'&&exposure){if(pairs.length)fail('INVALID_QUERY');const current=await authorize(principal,clock());if(current?.scope!==authority.scope||current.expiresAt<=clock())fail('ACCESS_DENIED');return exposure.check(ticket,current);}
  const route=/^\/opportunities(?:\/([^/]+)(?:\/([^/]+))?)?$/.exec(path);
  const options=path==='/options';if(!route&&!options)fail('RESOURCE_NOT_FOUND');
  const id=route?.[1]?.toLowerCase(),name=route?.[2];if(id&&!validate('OpportunityPath',{id}).valid)fail('INVALID_QUERY');
  if(name&&!Object.hasOwn(collections,name))fail('RESOURCE_NOT_FOUND');
  const type=options?'OptionsQuery':!id?'ListQuery':!name?'DetailQuery':name==='evidence'?'EvidenceQuery':'CollectionQuery';
  if(pairs.length>20)fail('INVALID_QUERY');const q=Q.parse(type,pairs);
  const filters={...q};delete filters.snapshot;delete filters.cursor;if(!id&&!options){filters.limit='25';filters.sort||='-observed_at';if(filters.q)filters.q=Q.normalize(filters.q).split(/\s+/u).join(' ');}
  let snapshot,token=q.snapshot;
  if(token){snapshot=tokens.open('snapshot',token);if(snapshot.v!==VERSION||!Number.isFinite(snapshot.asOf)||snapshot.expiresAt!==snapshot.asOf+TTL)fail('INVALID_SNAPSHOT');if(snapshot.scope!==authority.scope)fail('SNAPSHOT_SCOPE_MISMATCH');if(started>=snapshot.expiresAt)fail('SNAPSHOT_EXPIRED');}
  if(snapshot&&exposure)await exposure.check(ticket,authority,snapshot.generationId);
  let generation;try{generation=await repository.load(snapshot?.generationId,{opportunityId:id});}catch(error){if(error.status)throw error;fail('CATALOG_UNAVAILABLE');}
  if(!validate('OpportunityPath',{id:generation.id}).valid||Date.parse(generation.asOf)>started)fail('CATALOG_UNAVAILABLE');
  if(snapshot&&generation.id!==snapshot.generationId)fail('SNAPSHOT_UNAVAILABLE');
  if(exposure)await exposure.check(ticket,authority,generation.id);
  if(!snapshot){snapshot={v:VERSION,generationId:generation.id,scope:authority.scope,asOf:started,expiresAt:started+TTL};token=tokens.seal('snapshot',snapshot);}
  const context=digest({snapshot:digest(token),path,filters,scope:authority.scope,normalization:NORMALIZATION});
  let last=null;if(q.cursor){const cursor=tokens.open('cursor',q.cursor);if(cursor.context!==context)fail('CURSOR_CONTEXT_MISMATCH');last=cursor.last;}
  const meta={contractVersion:VERSION,requestId,generationId:generation.id,snapshot:token,asOf:new Date(snapshot.asOf).toISOString(),expiresAt:new Date(snapshot.expiresAt).toISOString(),normalizationVersion:NORMALIZATION};
  const byId=new Map();
  for(const stored of generation.rows||[]){
   if(stored.version!=='gcni-catalog-projection/1.2'||!stored.inputs)fail('CATALOG_UNAVAILABLE');
   let rebuilt,current;try{
    rebuilt=generation.verified?stored:buildProjection(stored.inputs.snapshot,stored.inputs.extension,{asOf:stored.asOf});
    if(!generation.verified&&digest(rebuilt)!==digest(stored))fail('CATALOG_UNAVAILABLE');
    current=generation.verified?require('./readIndex').atTime(stored,meta.asOf):buildProjection(stored.inputs.snapshot,stored.inputs.extension,{asOf:meta.asOf});
   }catch{fail('CATALOG_UNAVAILABLE');}
   if(byId.has(current.opportunityId))fail('CATALOG_UNAVAILABLE');byId.set(current.opportunityId,current);
  }
  // No private tenant overlays are present. Relationships must still point into
  // this authorized generation; never leak or silently drop inaccessible targets.
  for(const p of byId.values())if(!generation.relationshipsChecked&&p.collections.relationships.some(r=>!byId.has(r.targetId)))fail('CATALOG_UNAVAILABLE');
  if(generation.index)for(const summary of generation.index.summaries(meta.asOf))byId.set(summary.id,{detail:{summary}});
  let rows,schema,keys,descending=false,ordered=false,optionOrigins;
  if(options){
   const values=new Map();optionOrigins=new Map();for(const p of byId.values()){
    const s=p.detail.summary;
    const candidates=q.dimension==='programme'?s.programmes.items.map(p=>({id:p.id,label:p.label,namespace:null,deprecated:false})):q.dimension==='source'?s.sources.map(s=>({id:s.namespace,label:s.namespace,namespace:s.namespace,deprecated:false})):[{id:s.kind,label:s.kind,namespace:null,deprecated:false}];
    for(const v of candidates){const prior=values.get(v.id);if(!prior||Q.compare(v.label,prior.label)<0){values.set(v.id,v);optionOrigins.set(v.id,s);}}
   }
   rows=[...values.values()].filter(r=>!q.q||Q.normalize(r.label).startsWith(Q.normalize(q.q)));keys=r=>({value:[Q.normalize(r.label)],id:r.id});schema='OptionResponse';
  }else if(!id){
   rows=generation.index?generation.index.select(q,filters.sort,meta.asOf):Q.filter([...byId.values()].map(p=>p.detail.summary),q);ordered=Boolean(generation.index);keys=r=>Q.listKey(r,filters.sort);descending=filters.sort.startsWith('-');schema='ListResponse';
  }else{
   const p=byId.get(id);if(!p)fail('OPPORTUNITY_NOT_FOUND');
   if(!name){const result={data:await describe(p),meta};await finish(result,'DetailResponse');return result;}
   rows=[...p.collections[name==='funding-rules'?'fundingRules':name]];schema=collections[name]+'Response';
   keys=r=>Q.collectionKey(name,r);descending=['documents','history','evidence'].includes(name);
   if(q.ids){const ids=q.ids.toLowerCase().split(',');if(ids.some(id=>!rows.some(r=>r.id===id)))fail('RESOURCE_NOT_FOUND');rows=rows.filter(r=>ids.includes(r.id));keys=r=>({value:[],id:r.id});descending=false;}
  }
  if(!ordered)rows.sort((a,b)=>Q.keyCompare(keys(a),keys(b),descending));
  if(last)rows=rows.filter(row=>Q.keyCompare(keys(row),last,descending)>0);
  const data=[];const cap=schema==='ListResponse'?1048576:524288;
  let response;
  for(let i=0;i<Math.min(rows.length,25);i++){
   data.push(rows[i]);const hasMore=i+1<rows.length,nextCursor=hasMore?tokens.seal('cursor',{context,last:keys(rows[i])}):null;
   const attempt={data:[...data],page:{limit:25,returned:data.length,hasMore,nextCursor},meta};
   if(Buffer.byteLength(JSON.stringify(attempt))>cap){data.pop();if(!data.length)fail('PROJECTION_ITEM_TOO_LARGE');break;}
   response=attempt;
  }
  response||={data:[],page:{limit:25,returned:0,hasMore:false,nextCursor:null},meta};
  if(schema==='ListResponse'){
   const verified=generation.verify?await generation.verify(response.data,meta.asOf):response.data.map(summary=>byId.get(summary.id));
   if(presentSummary){
    const projections=new Map((verified||[]).map(projection=>[projection.opportunityId,projection]));
    response.data=response.data.map(summary=>{const projection=projections.get(summary.id);if(!projection)fail('CATALOG_UNAVAILABLE');return presentSummary(summary,projection);});
    while(Buffer.byteLength(JSON.stringify(response))>cap){
     if(response.data.length===1)fail('PROJECTION_ITEM_TOO_LARGE');
     response.data.pop();response.page={limit:25,returned:response.data.length,hasMore:true,nextCursor:tokens.seal('cursor',{context,last:keys(response.data.at(-1))})};
    }
   }
  }
  if(schema==='OptionResponse'&&generation.verify)await generation.verify([...new Map(response.data.map(r=>{const s=optionOrigins.get(r.id);return [s.id,s];})).values()],meta.asOf);
  await finish(response,schema);return response;
  async function finish(response,schema){
   if(Buffer.byteLength(JSON.stringify(response))>(schema==='ListResponse'?1048576:524288))fail('PROJECTION_ITEM_TOO_LARGE');
   if(!validate(schema,response).valid)fail('CATALOG_UNAVAILABLE');
   let final;try{final=await authorize(principal,clock());}catch(e){if(e.status)throw e;fail('CATALOG_UNAVAILABLE');}
   if(final?.scope!==authority.scope||final.expiresAt<=clock())fail('ACCESS_DENIED');
   if(exposure)await exposure.check(ticket,final,generation.id);
  }
 }
 return Object.freeze({request});
}
module.exports={createReadService,TTL};
