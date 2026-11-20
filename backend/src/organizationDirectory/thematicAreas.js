'use strict';
const {createHash}=require('node:crypto');
const {THEMATIC_AREAS}=require('./thematicCatalog');
const {suggestResearchAreas}=require('../utils/researchAreaMatcher');
// This persisted identifier is retained so existing tenant UUIDs remain stable.
const version='c4g-pilot-areas-v1';
const areas=Object.freeze(THEMATIC_AREAS.map(area=>{
 const hex=createHash('sha256').update(version+':'+area.name).digest('hex');
 const id=`${hex.slice(0,8)}-${hex.slice(8,12)}-5${hex.slice(13,16)}-a${hex.slice(17,20)}-${hex.slice(20,32)}`;
 return Object.freeze({...area,id});
}));
const ids=new Set(areas.map(a=>a.id));
// The suggestion depends only on these five texts, never on the person: it is
// computed once per distinct text and reused. Frozen, so no caller can alter
// what the next one receives.
const suggested=new Map(),SUGGESTED_LIMIT=4000;
function classify(snapshot){
 const text={title:snapshot.title,programme:snapshot.programmeName||snapshot.programme,
  description:snapshot.summary||snapshot.description,eligibility:snapshot.eligibility,funding_entity:snapshot.funderName};
 const key=createHash('sha256').update(JSON.stringify(text)).digest('base64');
 let held=suggested.get(key);
 if(!held){
  held=Object.freeze(suggestResearchAreas(text,areas,{minScore:1,maxSuggestions:3}).map(area=>Object.freeze({...area,matches:Object.freeze([...area.matches])})));
  if(suggested.size>=SUGGESTED_LIMIT)suggested.delete(suggested.keys().next().value);
  suggested.set(key,held);
 }
 return held;
}
function match(person,opportunities,today){
 if(!person.active)return [];
 const selected=new Set(person.areaIds);
 return opportunities.filter(o=>o.lifecycleState==='ACTIVE'&&(o.sourceVersion===2?!['CLOSED','CANCELLED'].includes(o.temporalState):!o.closingDate||o.closingDate.slice(0,10)>=today))
 .map(o=>({...o,matchedAreas:classify(o).filter(a=>selected.has(a.id)).map(({id,name,matches})=>({id,name,keywords:[...matches]}))}))
 .filter(o=>o.matchedAreas.length).sort((a,b)=>b.matchedAreas.length-a.matchedAreas.length
  ||(a.closingDate||'9999').localeCompare(b.closingDate||'9999')||a.opportunityId.localeCompare(b.opportunityId)
  ||String(a.origin||'').localeCompare(String(b.origin||'')));
}
module.exports={areas,ids,version,classify,match};
