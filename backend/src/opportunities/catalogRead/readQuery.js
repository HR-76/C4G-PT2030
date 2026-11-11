'use strict';
const {validateQuery,validate}=require('./contractValidation');
const {fail}=require('./readErrors');
const fold=require('./casefold.json').mapping;
const normalize=v=>[...v.normalize('NFD').replace(/\p{M}/gu,'')].map(c=>fold[c]||c).join('').normalize('NFC');
const compare=(a,b)=>a===b?0:a<b?-1:1;
const decimal=v=>{const [whole,part='']=v.split('.');return BigInt(whole)*100000000n+BigInt(part.padEnd(8,'0'));};
function parse(kind,pairs){if(!validateQuery(kind,pairs).valid)fail('INVALID_QUERY');return Object.fromEntries(pairs.map(([k,v])=>[k,['snapshot','cursor','ids'].includes(k)?v:v.trim().normalize('NFC')]));}
function deadlineKey(s){const d=s.deadline;if(d.state!=='supported'||!d.at||d.at.kind==='period')return null;const a=d.at;return a.kind==='date'?[a.date,0,'']:a.kind==='instant'?[a.originalLocal.slice(0,10),1,a.originalLocal.slice(11)]:[a.local.slice(0,10),1,a.local.slice(11)];}
function listKey(s,sort){const value=sort==='title'?(s.title.state==='PRESENT'?[normalize(s.title.value)]:null):sort.includes('deadline')?deadlineKey(s):s.freshness.observedAt?[s.freshness.observedAt]:null;return {value,id:s.id};}
function keyCompare(a,b,descending=false){if(a.value===null||b.value===null)return a.value===b.value?compare(a.id,b.id):a.value===null?1:-1;for(let i=0;i<a.value.length;i++){const n=compare(a.value[i],b.value[i]);if(n)return descending?-n:n;}return compare(a.id,b.id);}
function filter(items,q){
 const supportedCurrencies=new Set(Intl.supportedValuesOf('currency'));
 if(q.currency&&!supportedCurrencies.has(q.currency))fail('FILTER_VALUE_UNKNOWN');
 for(const [field,values] of [['programme',items.flatMap(s=>s.programmes.items.map(p=>p.id))],['source',items.flatMap(s=>s.sources.map(s=>s.namespace))]])if(q[field]&&!values.includes(q[field]))fail('FILTER_VALUE_UNKNOWN');
 return items.filter(s=>{
  if(q.q){const text=normalize([s.title.value||'',s.externalCode.value||''].join(' '));if(!normalize(q.q).split(/\s+/u).every(t=>text.includes(t)))return false;}
  if(q.programme&&!s.programmes.items.some(p=>p.id===q.programme)||q.source&&!s.sources.some(p=>p.namespace===q.source)||q.kind&&s.kind!==q.kind||q.status&&s.status.code!==q.status||q.quality&&!s.quality.flags.includes(q.quality))return false;
  const date=deadlineKey(s)?.[0];if(q.deadline_from&&(!date||date<q.deadline_from)||q.deadline_to&&(!date||date>q.deadline_to))return false;
  if(q.currency){const m=s.funding;if(m.state!=='PRESENT'||!['call','notice'].includes(m.value.scope)||m.value.currency!==q.currency||q.funding_min&&decimal(m.value.amount)<decimal(q.funding_min))return false;}
  return true;
 });
}
function collectionKey(name,row){let value=[];if(name==='windows')value=row.sequence===null?null:[row.sequence];if(name==='documents')value=row.publishedAt?.kind==='date'?[row.publishedAt.date]:row.publishedAt?.kind==='instant'?[row.publishedAt.originalLocal]:row.publishedAt?.kind==='local_datetime'?[row.publishedAt.local]:null;if(name==='relationships')value=[row.targetId];if(name==='history')value=[row.recordedAt];if(name==='evidence')value=[row.retrievedAt];return {value,id:row.id};}
module.exports={normalize,compare,decimal,parse,deadlineKey,listKey,keyCompare,filter,collectionKey};
