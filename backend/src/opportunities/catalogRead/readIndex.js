'use strict';
const {calendar}=require('./model');
const Q=require('./readQuery');
const {validate}=require('./contractValidation');
const {fail}=require('./readErrors');
const {deepFreeze}=require('../v2/data');
const labels={open:'Aberto',closed:'Encerrado',conditional:'Condicionado',planned:'Previsto',forthcoming:'A abrir',cancelled:'Cancelado',unknown:'Por confirmar'};
function summarize(row,asOf){
 if(row.version!=='gcni-catalog-projection/1.2')fail('CATALOG_UNAVAILABLE');
 const {state,deadline}=calendar(row.calendar,row.extension,row.summary.revisionId,asOf);
 const summary={...row.summary,deadline,status:{...row.summary.status,code:state,label:labels[state]}};
 if(!validate('Summary',summary).valid)fail('CATALOG_UNAVAILABLE');
 return deepFreeze(summary);
}
// Summary changes only at an exact deadline/opening or a civil interval boundary.
// Millisecond boundaries preserve both equality and date-only uncertainty.
function boundaries(rows){const values=new Set();for(const r of rows){
 const schedule=r.calendar.schedule;
 const times=[...(schedule.opening.state==='PRESENT'?[schedule.opening.value]:[]),...(schedule.deadlines.state==='PRESENT'?schedule.deadlines.value.map(x=>x.at):[])];
 for(const t of times){if(t.precision==='INSTANT')values.add(Date.parse(t.value));else{values.add(Date.parse((t.value||t.start)+'T00:00:00.000Z'));values.add(Date.parse((t.value||t.end)+'T00:00:00.000Z')+86400000);}}
 }return [...values].sort((a,b)=>a-b);}
function interval(bounds,now){let lo=0,hi=bounds.length;while(lo<hi){const m=(lo+hi)>>1;if(bounds[m]<=now)lo=m+1;else hi=m;}return lo;}
function createIndex(rows){
 deepFreeze(rows);
 const ids=new Set(rows.map(r=>r.summary.id));if(ids.size!==rows.length||rows.some(r=>r.relationships.some(id=>!ids.has(id))))fail('CATALOG_UNAVAILABLE');
 const bounds=boundaries(rows);let cached;
 const digests=new Map(rows.map(r=>[r.summary.id,r.payloadDigest]));
 return {digest:id=>digests.get(id),summaries(asOf){const slot=interval(bounds,Date.parse(asOf));if(cached?.slot!==slot)cached={slot,rows:rows.map(r=>summarize(r,asOf)),queries:new Map()};return cached.rows;},select(query,sort,asOf){
 const rows=this.summaries(asOf),q={...query};delete q.snapshot;delete q.cursor;const key=JSON.stringify([q,sort]);
 if(!cached.queries.has(key)){const selected=Q.filter(rows,q),keys=new Map(selected.map(r=>[r,Q.listKey(r,sort)]));selected.sort((a,b)=>Q.keyCompare(keys.get(a),keys.get(b),sort.startsWith('-')));if(cached.queries.size>=8)cached.queries.delete(cached.queries.keys().next().value);cached.queries.set(key,Object.freeze(selected));}
 return cached.queries.get(key);
 }};
}
function atTime(p,asOf){
 if(Date.parse(asOf)<Date.parse(p.asOf))fail('CATALOG_UNAVAILABLE');
 const s=p.inputs.snapshot,e=p.inputs.extension;
 const row={version:p.version,summary:p.detail.summary,calendar:s,extension:e};
 const summary=summarize(row,asOf),{originalTemporal}=calendar(s,e,p.revisionId,asOf);
 return Object.freeze({...p,detail:Object.freeze({...p.detail,summary,statusExplanation:originalTemporal.reasonCodes.join('; ')+(e.windows.items.length?'; Consultar condições adicionais.':'')})});
}
module.exports={createIndex,summarize,boundaries,interval,atTime};
