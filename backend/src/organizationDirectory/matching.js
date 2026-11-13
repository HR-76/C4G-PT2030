'use strict';
const {uuid,fail}=require('./contracts');
const {match,version}=require('./thematicAreas');
const dayFormatter=new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Lisbon',year:'numeric',month:'2-digit',day:'2-digit'});
function civilToday(value){return dayFormatter.format(value);}
const {projectMatchOpportunity,currentForMatching}=require('./matchingProjection');
async function pages(read){
 const all=[],seen=new Set();let cursor,pageCount=0;
 do{const page=await read(cursor?{cursor}:{});pageCount++;if(!Array.isArray(page?.items))fail('SERVICE_UNAVAILABLE');
  all.push(...page.items);if(all.length>1000)fail('LIMIT_EXCEEDED');
  cursor=page.nextCursor;if(cursor&&seen.has(cursor))fail('SERVICE_UNAVAILABLE');seen.add(cursor);
  if(cursor&&pageCount>=1001)fail('LIMIT_EXCEEDED');
 }while(cursor);return all;
}
function createOrganizationMatching({directory,opportunities,central,clock=()=>new Date()}){
 return {async execute(query,request){
  if(Object.keys(query).some(k=>!['personId','opportunityId','origin'].includes(k)))fail('INVALID_INPUT');
  const byOpportunity=Boolean(query.opportunityId);
  if(byOpportunity){uuid(query.opportunityId);if(query.personId||!['CENTRAL','PRIVATE'].includes(query.origin))fail('INVALID_INPUT');}
  else if(query.origin)fail('INVALID_INPUT');
  const id=query.personId?uuid(query.personId):null;
  const initial=await directory.execute(byOpportunity?'context':id?'person':'self',{},id,request);
  if(!byOpportunity&&!initial.person)return {state:'PROFILE_NOT_LINKED',items:[],areaCatalogVersion:version};
  if(!byOpportunity&&!initial.profile.areaIds.length)return {state:'NO_AREAS',person:initial.person,items:[],areaCatalogVersion:version};
  const initialMatchingProfile=byOpportunity?null:JSON.stringify({active:initial.person.active,areas:[...initial.profile.areaIds].sort()});
  const asOf=clock().toISOString();
  const load=async(origin,opportunityId)=>{
   if(origin==='CENTRAL'&&!central)fail('SERVICE_UNAVAILABLE');
   const detail=origin==='CENTRAL'?await central.get(opportunityId):await opportunities.get(opportunityId,request);
   const snapshot=detail.snapshot;
   if(!snapshot)fail('SERVICE_UNAVAILABLE');
   return projectMatchOpportunity(detail,{origin,opportunityId,asOf});
  };
  let items,privateIncluded=true;
  const today=civilToday(new Date(asOf));
  if(byOpportunity){
   const opportunity=await load(query.origin,query.opportunityId);
   // Without organisation-wide people access the answer is a clear refusal, not a dependency failure.
   const people=await pages(q=>directory.execute('peopleWithResearchAreas',q,null,request)).catch(error=>{if(['AUTHORITY_DENIED','AUTHORIZATION_DENIED','NOT_AUTHORIZED'].includes(error?.code))fail('NOT_AUTHORIZED');throw error;});
   items=[];
   for(const person of people){
    if(!Array.isArray(person.areaIds))fail('SERVICE_UNAVAILABLE');
    const matches=match(person,[opportunity],today);
    const {areaIds,...projection}=person;
    if(matches.length)items.push({...projection,matchedAreas:matches[0].matchedAreas});
   }
   items.sort((a,b)=>b.matchedAreas.length-a.matchedAreas.length||a.name.localeCompare(b.name,'pt')||a.personId.localeCompare(b.personId));
  }else{
   if(!central)fail('SERVICE_UNAVAILABLE');
   // A technician has no organization-wide read of private opportunities: match against the catalog only.
   privateIncluded=typeof directory.canReadPrivateOpportunities==='function'?await directory.canReadPrivateOpportunities(request)===true:true;
   const privateList=typeof opportunities.listForMatching==='function'?opportunities.listForMatching.bind(opportunities):opportunities.list.bind(opportunities);
   const [publicItems,privateItems]=await Promise.all([pages(q=>central.list(q)),privateIncluded?pages(q=>privateList(q,request)):Promise.resolve([])]),all=[];
   for(const [origin,list] of [['CENTRAL',publicItems],['PRIVATE',privateItems]]){
    for(const item of list){if(currentForMatching(item,today))all.push(item.snapshot||item.readModel?
      projectMatchOpportunity(item,{origin,opportunityId:item.opportunityId,asOf}):await load(origin,item.opportunityId));}
   }
   items=match({...initial.person,areaIds:initial.profile.areaIds},all,today);
  }
  // Revalidate authority after all source reads; never publish a result from an old context.
  const current=await directory.execute(byOpportunity?'context':id?'person':'self',{},id,request);
  if(!byOpportunity&&(!current?.person||!Array.isArray(current.profile?.areaIds)||JSON.stringify({active:current.person.active,areas:[...current.profile.areaIds].sort()})!==initialMatchingProfile))fail('CONTEXT_CHANGED');
  return {state:'READY',person:initial.person||null,items,areaCatalogVersion:version,...(byOpportunity?{}:{privateIncluded}),
   explanation:'Áreas sugeridas por palavras-chave, cruzadas com as áreas da pessoa. Não determina elegibilidade.'};
 }};
}
module.exports={createOrganizationMatching,pages,civilToday,projectMatchOpportunity,currentForMatching};
