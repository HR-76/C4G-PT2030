'use strict';
// Pure contract validation promoted from the approved G2 package. No I/O except schema loading.
const fs = require('node:fs');
const path = require('node:path');
const Ajv2020 = require('ajv/dist/2020');
const addFormats = require('ajv-formats');
const ajv = new Ajv2020({ strict: true, allErrors: true, coerceTypes: false, useDefaults: false, removeAdditional: false });
addFormats(ajv, { mode: 'full' });

function civil(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y,m,d] = value.split('-').map(Number);
  if (y < 1 || m < 1 || m > 12) return false;
  const leap = y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0);
  return d >= 1 && d <= [31,leap?29:28,31,30,31,30,31,31,30,31,30,31][m-1];
}
function local(value) {
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})$/.exec(value);
  return Boolean(m && civil(m[1]) && +m[2]<24 && +m[3]<60 && +m[4]<60);
}
function utc(value) {
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value) && local(value.slice(0,19)) && Number.isFinite(Date.parse(value));
}
function timezone(value) {
  if (/^[+-]/.test(value)) return /^[+-](?:0\d|1[0-3]):[0-5]\d$|^[+-]14:00$/.test(value);
  try { new Intl.DateTimeFormat('en', { timeZone: value }); return true; } catch { return false; }
}
function safeHttps(value) {
  if (/\s|[\u0000-\u001f\u007f\\]/u.test(value)) return false;
  try {
    const u = new URL(value);
    const forbidden = /^(?:access_token|refresh_token|id_token|token|authorization|password|secret|api_key|apikey|signature|x-amz-signature|x-amz-credential|code)$/i;
    return u.protocol==='https:' && !u.username && !u.password && Boolean(u.hostname) && [...u.searchParams.keys()].every(k=>!forbidden.test(k));
  } catch { return false; }
}
const decimal = v => /^(?:0|[1-9]\d{0,23})(?:\.\d{1,8})?$/.test(v);
const rate = v => decimal(v) && (()=>{const [a,b='']=v.split('.');return BigInt(a)*100000000n+BigInt(b.padEnd(8,'0'))<=10000000000n;})();
const uuid = /^[\da-f]{8}-[\da-f]{4}-[1-8][\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/i;
for (const [name, validate] of Object.entries({ 'civil-date':civil,'local-datetime':local,'utc-instant':utc,'known-timezone':timezone,'public-https':safeHttps,'decimal-exact':decimal,'rate-decimal':rate,'uuid-csv':v=>{const values=v.split(',');return values.length<=25&&values.every(x=>uuid.test(x))&&new Set(values.map(x=>x.toLowerCase())).size===values.length;} })) ajv.addFormat(name, { type:'string', validate });
const schema = JSON.parse(fs.readFileSync(path.join(__dirname,'contract.schema.json'),'utf8'));
ajv.addSchema(schema);
const compiled = new Map(Object.keys(schema.$defs).map(name=>[name,ajv.getSchema(`${schema.$id}#/$defs/${name}`)]));

function instantMatches(v) {
  const time = Date.parse(v.utc);
  if (/^[+-]/.test(v.originalTimezone)) {
    const [h,m]=v.originalTimezone.slice(1).split(':').map(Number);
    const offset=(h*60+m)*(v.originalTimezone[0]==='-'?-1:1);
    return new Date(time+offset*60000).toISOString().slice(0,19)===v.originalLocal;
  }
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB',{timeZone:v.originalTimezone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).formatToParts(new Date(time)).map(p=>[p.type,p.value]));
  return `${parts.year.padStart(4,'0')}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}`===v.originalLocal;
}
function semantic(name,data) {
  const errors=[];
  const fail=(code,at)=>errors.push({keyword:'semantic',code,instancePath:at});
  if (data.deadline_from && data.deadline_to && data.deadline_from>data.deadline_to) fail('DATE_RANGE','/deadline_to');
  if (data.meta) {
    if (Date.parse(data.meta.expiresAt)-Date.parse(data.meta.asOf)!==900000) fail('SNAPSHOT_TTL','/meta/expiresAt');
    if (Buffer.byteLength(JSON.stringify(data),'utf8')>(name==='ListResponse'?1048576:524288)) fail('BYTE_BUDGET','');
  }
  if (data.page) {
    if (data.page.returned!==data.data.length) fail('PAGE_COUNT','/page/returned');
    if (new Set(data.data.map(v=>v.id)).size!==data.data.length) fail('DUPLICATE_ID','/data');
  }
  const asOf=data.meta?.asOf;
  function walk(v,at) {
    if (!v || typeof v!=='object') return;
    if (Array.isArray(v)) {v.forEach((x,i)=>walk(x,`${at}/${i}`));return;}
    if (v.kind==='period' && v.from && v.to && v.from.date>v.to.date) fail('PERIOD_RANGE',at);
    if (v.kind==='instant' && !instantMatches(v)) fail('INSTANT_LOCAL_MISMATCH',at);
    if (v.supersedesVersionId && v.supersedesVersionId===v.id) fail('SELF_SUPERSESSION',at);
    if (v.supersedesId && v.supersedesId===v.id) fail('SELF_SUPERSESSION',at);
    if (v.alternatives) {
      const ids=v.alternatives.map(x=>x.id);
      if(new Set(ids).size!==ids.length)fail('DUPLICATE_ALTERNATIVE',at);
      if(v.selectedAlternativeId && !ids.includes(v.selectedAlternativeId))fail('UNKNOWN_ALTERNATIVE',at);
    }
    if (v.summary && v.collections) for (const [k,d] of Object.entries(v.collections)) {
      const route=k==='fundingRules'?'funding-rules':k;
      if(d.href!==`/api/catalog-read/v1/opportunities/${v.summary.id}/${route}`)fail('COLLECTION_BINDING',`${at}/collections/${k}`);
    }
    if (v.programmes) {
      const ps=v.programmes.items.map(p=>p.id);
      if(new Set(ps).size!==ps.length)fail('DUPLICATE_PROGRAMME',at);
    }
    if (v.sources) {
      const ss=v.sources.map(s=>JSON.stringify([s.namespace,s.externalId]));
      if(new Set(ss).size!==ss.length)fail('DUPLICATE_SOURCE',at);
    }
    for (const [k,x] of Object.entries(v)) {
      if(asOf && ['observedAt','reviewedAt','retrievedAt','recordedAt','decidedAt'].includes(k) && x!==null && Date.parse(x)>Date.parse(asOf))fail('AFTER_SNAPSHOT',`${at}/${k}`);
      walk(x,`${at}/${k}`);
    }
  }
  walk(data,'');return errors;
}
function validate(name,data) {
  const fn=compiled.get(name);
  if(!fn) throw new Error('Unknown schema name');
  if(!fn(data)) return {valid:false,errors:structuredClone(fn.errors)};
  const errors=semantic(name,data);
  return {valid:!errors.length,errors};
}
function validateQuery(name,pairs) {
  if (!Array.isArray(pairs)) return {valid:false,errors:[{code:'QUERY_PAIRS_REQUIRED'}]};
  const data=Object.create(null);
  for(const pair of pairs) {
    if(!Array.isArray(pair)||pair.length!==2||pair.some(x=>typeof x!=='string'))return {valid:false,errors:[{code:'QUERY_SCALAR_REQUIRED'}]};
    const [k,v]=pair;
    if(Object.hasOwn(data,k))return {valid:false,errors:[{code:'DUPLICATE_PARAMETER'}]};
    data[k]=['snapshot','cursor','ids'].includes(k)?v:v.trim().normalize('NFC');
  }
  return validate(name,data);
}
// Fixture comparison, not a server-side snapshot implementation.
function consistentFixturePair(list,detail) {
  if(!validate('ListResponse',list).valid || !validate('DetailResponse',detail).valid)return false;
  const m=['contractVersion','generationId','snapshot','asOf','expiresAt','normalizationVersion'];
  if(!m.every(k=>list.meta[k]===detail.meta[k]))return false;
  const row=list.data.find(v=>v.id===detail.data.summary.id);
  return Boolean(row && JSON.stringify(row)===JSON.stringify(detail.data.summary));
}
module.exports={validate,validateQuery,consistentFixturePair,definitions:[...compiled.keys()]};
