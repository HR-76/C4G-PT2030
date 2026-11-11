'use strict';
const {date}=require('./normalization');
const STATES=Object.freeze(['OPEN','UPCOMING','CLOSED','CANCELLED','UNKNOWN']);
function temporalDate(value){
 if(typeof value!=='string'||value.length>35)throw new TypeError('Invalid temporal date');
 date(value.slice(0,10));
 if(value.length!==10&&(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:?\d{2})$/.test(value)||!Number.isFinite(Date.parse(value))))throw new TypeError('Invalid temporal instant');
 return value;
}
function validateTemporal(value){
 if(!value||Object.getPrototypeOf(value)!==Object.prototype||Object.keys(value).some(k=>!['status','statusCode','deadlines','openings'].includes(k))||!STATES.includes(value.status))throw new TypeError('Invalid temporal metadata');
 const out={status:value.status};
 if(value.statusCode!==undefined){if(typeof value.statusCode!=='string'||!/^[A-Za-z0-9_-]{1,64}$/.test(value.statusCode))throw new TypeError('Invalid status code');out.statusCode=value.statusCode;}
 for(const key of ['deadlines','openings']){
  if(!Array.isArray(value[key])||value[key].length>64)throw new TypeError('Invalid temporal schedule');
  out[key]=value[key].map(temporalDate);
 }
 return out;
}
// Civil dates are inclusive throughout the supplied civil day. No midnight or
// provider time zone is fabricated; offset-bearing values are exact instants.
function temporalState(fields={},now=new Date().toISOString(),corrections={},sourceReview=null){
 const instant=new Date(now).getTime();if(!Number.isFinite(instant))throw new TypeError('Invalid reference instant');
 const today=new Date(instant).toISOString().slice(0,10),source=fields.sourceTemporal;
 const status=source?.status||'UNKNOWN';
 const schedule=!Object.hasOwn(corrections,'closingDate')&&source?.deadlines?.length?source.deadlines:fields.closingDate?[fields.closingDate]:[];
 const pending=schedule.filter(v=>v.length===10?v>=today:Date.parse(v)>instant).sort((a,b)=>Date.parse(a)-Date.parse(b));
 const nextDeadline=pending[0]||null;
 const opening=!Object.hasOwn(corrections,'openingDate')&&source?.openings?.length?[...source.openings].sort((a,b)=>Date.parse(a)-Date.parse(b))[0]:fields.openingDate;
 const future=opening&&(opening.length===10?opening>today:Date.parse(opening)>instant);
 let state='UNKNOWN';
 if(['CANCELLED','CLOSED'].includes(status))state=status;
 else if(schedule.length&&!pending.length)state='CLOSED';
 else if(future)state='UPCOMING';
 else if(status==='UPCOMING'&&!opening)state='UPCOMING';
 else if(pending.length)state='OPEN';
 return {state:sourceReview?'UNKNOWN':state,publishedState:status,nextDeadline,precision:nextDeadline?(nextDeadline.length===10?'DATE':'INSTANT'):null,openingKnown:Boolean(opening)};
}
module.exports={STATES,temporalDate,validateTemporal,temporalState};
