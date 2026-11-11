'use strict';
// Programme adapters: no database, tenant or notification dependencies.
const xlsx = require('xlsx');
const { inflateRawSync } = require('node:zlib');
const { date } = require('../opportunities/normalization');
const { sourceDescription } = require('./sourceDescription');
const { LIMITS, CAPS } = require('./source');
const SOURCES = Object.freeze({
  INTERREG_EUROPE: { url: 'https://www.interregeurope.eu/sites/default/files/2024-08/Calls_planning_web.xlsx', page: 'https://www.interregeurope.eu/call-for-projects', programme: 'Interreg Europe 2021-2027', funder: 'Interreg Europe' },
  POCTEP: { url: 'https://www.poctep.eu/wp-json/wp/v2/pages/2831', page: 'https://www.poctep.eu/convocatorias/', details: 'https://www.poctep.eu/wp-json/wp/v2/pages/9396', detailsPage: 'https://www.poctep.eu/convocatorias-abiertas-poctep-2021-2027/', programme: 'POCTEP 2021-2027', funder: 'Interreg Spain-Portugal (POCTEP)' }
});
function fail(code = 'SOURCE_RESPONSE_INVALID') { throw Object.assign(new Error(code), { code }); }
function plain(value) { return (sourceDescription(String(value ?? '').replace(/\[\/?vc_[^\]]*\]/g,''), LIMITS.bytes) || '').replace(/\s+/g, ' ').trim(); }
function header(value) { return plain(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase(); }
function civil(value) {
  let iso;
  if (typeof value === 'number' && Number.isSafeInteger(value)) {
    const p = xlsx.SSF.parse_date_code(value); if (p) iso = `${p.y}-${String(p.m).padStart(2,'0')}-${String(p.d).padStart(2,'0')}`;
  } else if (typeof value === 'string') {
    const m = value.trim().match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    iso = m ? `${m[3]}-${m[2]}-${m[1]}` : value;
  }
  try { return date(iso); } catch { fail(); }
}
function record(source, number, title, opening, closing, summary, officialUrl = SOURCES[source].page) {
  const openingDate = civil(opening), closingDate = civil(closing);
  if (openingDate > closingDate || !Number.isSafeInteger(number) || number < 1 || number > 999 || !title || [...title].length>300) fail();
  return { externalIdentifier: `${source}:2021-2027:CALL:${number}`, fields: {
    title, programmeName: SOURCES[source].programme, funderName: SOURCES[source].funder,
    callReference: `${source === 'POCTEP' ? 'POCTEP' : 'Interreg Europe'} 2021-2027 / ${number}`,
    openingDate, closingDate, officialUrl, summary: sourceDescription(summary)
  } };
}
function unique(records) {
  const map = new Map();
  for (const r of records) {
    const old = map.get(r.externalIdentifier);
    if (old && JSON.stringify(old) !== JSON.stringify(r)) fail();
    map.set(r.externalIdentifier, r);
  }
  return [...map.values()].sort((a,b) => a.externalIdentifier.localeCompare(b.externalIdentifier));
}
// Bound ZIP expansion before SheetJS reads the official workbook. ZIP64,
// encryption and oversized archives are outside this small source contract.
function checkWorkbookZip(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 22 || buffer.length > LIMITS.bytes) fail();
  let end = -1;
  for (let i = buffer.length - 22; i >= Math.max(0,buffer.length - 65557); i--) if (buffer.readUInt32LE(i) === 0x06054b50 && i + 22 + buffer.readUInt16LE(i+20) === buffer.length) { end=i; break; }
  if (end < 0 || buffer.readUInt16LE(end+4) || buffer.readUInt16LE(end+6)) fail();
  const count=buffer.readUInt16LE(end+10), size=buffer.readUInt32LE(end+12), start=buffer.readUInt32LE(end+16);
  if (!count || count>500 || buffer.readUInt16LE(end+8)!==count || start+size!==end) fail();
  let offset=start,total=0;
  for(let i=0;i<count;i++) {
    if(offset+46>end || buffer.readUInt32LE(offset)!==0x02014b50 || buffer.readUInt16LE(offset+8)&1) fail();
    total+=buffer.readUInt32LE(offset+24); if(total>10*1024*1024) fail('SOURCE_RESPONSE_TOO_LARGE');
    const local=buffer.readUInt32LE(offset+42);
    if(local+30>start || buffer.readUInt32LE(local)!==0x04034b50) fail();
    if(buffer.readUInt32LE(local+22)!==buffer.readUInt32LE(offset+24) && !(buffer.readUInt16LE(local+6)&8)) fail();
    const method=buffer.readUInt16LE(offset+10), compressed=buffer.readUInt32LE(offset+20), expanded=buffer.readUInt32LE(offset+24);
    const dataAt=local+30+buffer.readUInt16LE(local+26)+buffer.readUInt16LE(local+28);
    if(dataAt+compressed>start || ![0,8].includes(method) || buffer.readUInt16LE(local+8)!==method) fail();
    try {
      const bytes=buffer.subarray(dataAt,dataAt+compressed), decoded=method===0?bytes:inflateRawSync(bytes,{maxOutputLength:Math.max(1,expanded+1)});
      if(decoded.length!==expanded)fail();
    } catch(e) { fail(e.code==='ERR_BUFFER_TOO_LARGE'?'SOURCE_RESPONSE_TOO_LARGE':'SOURCE_RESPONSE_INVALID'); }
    offset+=46+buffer.readUInt16LE(offset+28)+buffer.readUInt16LE(offset+30)+buffer.readUInt16LE(offset+32);
  }
  if(offset!==end) fail();
}
function parseInterreg(buffer) {
  checkWorkbookZip(buffer);
  let wb; try { wb=xlsx.read(buffer,{type:'buffer',cellDates:false,cellFormula:true,sheetRows:110}); } catch { fail(); }
  if(wb.SheetNames.length!==1 || wb.Workbook?.WBProps?.date1904) fail();
  const sheet=wb.Sheets[wb.SheetNames[0]];
  if(Object.values(sheet).some(c=>c && typeof c==='object' && c.f)) fail();
  const matrix=xlsx.utils.sheet_to_json(sheet,{header:1,defval:null});
  const at=matrix.findIndex(row=>row.some(c=>plain(c)==='Call number'));
  if(at<0 || matrix.length>100) fail();
  const heads=matrix[at].map(plain), expected=['Call number','Start date of the call','End date of the call','Type of eligible applicants','Total amount of support for the call***'];
  if(expected.some(h=>heads.filter(x=>x===h).length!==1)) fail();
  const cell=(row,name)=>row[heads.indexOf(name)]; const records=[];
  for(const row of matrix.slice(at+1)) {
    const title=plain(cell(row,'Call number'));
    if(!title && row.every(x=>!plain(x))) continue;
    if(title.startsWith('*') || /^No additional calls are planned by Interreg Europe[.]?$/.test(title)) continue;
    const n={'First call':1,'Second call':2,'Third call':3}[title]; if(!n) fail();
    const summary=heads.map((h,i)=>h && row[i]!==null && !['Start date of the call','End date of the call'].includes(h)?`${h}: ${plain(row[i])}`:null).filter(Boolean).join('\n');
    records.push(record('INTERREG_EUROPE',n,`${title} — Interreg Europe`,cell(row,'Start date of the call'),cell(row,'End date of the call'),summary+'\nCobertura: chamadas gerais; não inclui chamadas restritas ou ações-piloto. Consulte as condições completas na fonte oficial.'));
  }
  if(!records.length) fail();
  return unique(records);
}
function pageHtml(data,id,link) {
  if(!data || data.id!==id || data.link!==link || typeof data.content?.rendered!=='string' || data.content.rendered.length>LIMITS.bytes) fail();
  return data.content.rendered;
}
function tableCalls(html) {
  const tables=[...html.matchAll(/<table\b[^>]*>([\s\S]*?)<\/table\s*>/gi)];
  if(!tables.length || tables.length>20) fail();
  const records=[]; let recognized=0;
  for(const table of tables) {
    if(/<table\b/i.test(table[1])) fail();
    const rows=[...table[1].matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr\s*>/gi)];
    const cells=row=>[...row.matchAll(/<(td|th)\b([^>]*)>([\s\S]*?)<\/\1\s*>/gi)].map(m=>{if(/(?:rowspan|colspan)\s*=\s*["']?(?!1(?:["'\s>]|$))\d/i.test(m[2]))fail();return plain(m[3]);});
    const first=rows.length?cells(rows[0][1]):[];
    if(!first.some(c=>header(c)==='convocatoria')) continue;
    const heads=first.map(header),required=['convocatoria','prioridad','feder','apertura','cierre','resolucion'];
    if(required.some(h=>heads.filter(x=>x===h).length!==1)) fail();
    recognized++;
    for(const row of rows.slice(1)) {
      const values=cells(row[1]); if(values.every(v=>!v))continue;
      if(values.length!==heads.length || records.length>=100)fail();
      const value=name=>values[heads.indexOf(name)], label=value('convocatoria');
      const match=label.match(/^(\d{1,3})[.\s]*[ªa]\s+Convocatoria\b/i);if(!match)fail();
      const summary=`${label}\nPrioridades: ${value('prioridad')}\nDotação FEDER da convocatória (não por candidatura): ${value('feder')}\nResolução: ${value('resolucion')}`;
      records.push({...record('POCTEP',Number(match[1]),`${label.replace(/\s*\((?:ABIERTA|CERRADA)\)/gi,'')} — POCTEP`,value('apertura'),value('cierre'),summary),declaredClosed:/\(CERRADA\)/i.test(label)});
    }
  }
  if(!recognized || !records.length)fail();
  return unique(records);
}
function parsePoctep(calendar,details) {
  const rows=tableCalls(pageHtml(calendar,2831,SOURCES.POCTEP.page));
  if(details===null)return rows;
  const html=pageHtml(details,9396,SOURCES.POCTEP.detailsPage);
  const open=tableCalls(html);
  for(const detail of open) {
    const row=rows.find(r=>r.externalIdentifier===detail.externalIdentifier);
    if(!row || row.declaredClosed || row.fields.openingDate!==detail.fields.openingDate || row.fields.closingDate!==detail.fields.closingDate)fail();
    // Pair each table with its following detail block; repeated headings and
    // document titles outside tables never create records.
    const tables=[...html.matchAll(/<table\b[^>]*>[\s\S]*?<\/table\s*>/gi)];
    const at=tables.findIndex(t=>tableCalls(t[0]).some(r=>r.externalIdentifier===detail.externalIdentifier));
    if(at<0)fail();
    const section=html.slice(tables[at].index+tables[at][0].length,tables[at+1]?.index??html.length);
    const text=plain(section);
    const deadlines=text.match(/El plazo para la presentaci[oó]n de candidaturas[^.]+\./gi)||[];
    const eligibility=section.match(/<h3\b[^>]*>¿Qui[eé]n puede presentar una candidatura\?<\/h3>([\s\S]*?)(?=<h3\b|$)/i);
    row.fields.officialUrl=SOURCES.POCTEP.detailsPage;
    row.fields.summary=sourceDescription(row.fields.summary+'\n'+deadlines.join('\n')+'\nBases, documentos e condições: '+SOURCES.POCTEP.detailsPage+'\n'+(eligibility?plain(eligibility[1]):'')+'\n'+plain(section));
  }
  return rows;
}
async function fetchDocument(url,{fetchImpl,signal,clock,started,limits,sleep,documents}) {
  for(let attempt=0;attempt<=limits.retries;attempt++) {
    const remaining=limits.totalMs-(clock()-started);if(remaining<=0 || signal?.aborted)fail('SOURCE_TIMEOUT');
    const controller=new AbortController(),abort=()=>controller.abort();signal?.addEventListener('abort',abort,{once:true});
    const timer=setTimeout(abort,Math.min(limits.requestMs,remaining));let retry=false,response,retryAfter=0;
    try {
      const r=response=await fetchImpl(url,{redirect:'error',signal:controller.signal,headers:{Accept:url.endsWith('.xlsx')?'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet':'application/json'}});
      if(r.redirected || r.url && r.url!==url)fail('SOURCE_REJECTED');
      if(r.status===429 || r.status>=500){const after=r.headers.get('retry-after');retryAfter=after && /^\d+$/.test(after)?Number(after)*1000:Math.max(0,Date.parse(after)-clock())||0;await r.body?.cancel();retry=true;fail('SOURCE_UNAVAILABLE');}
      if(!r.ok){await r.body?.cancel();fail('SOURCE_REJECTED');}
      const mime=r.headers.get('content-type')||'';
      if(!(url.endsWith('.xlsx')?mime.includes('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'):mime.includes('application/json')))fail();
      if(Number(r.headers.get('content-length'))>limits.bytes)fail('SOURCE_RESPONSE_TOO_LARGE');
      if(!r.body)fail();const reader=r.body.getReader(),chunks=[];let size=0;
      try {while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>limits.bytes)fail('SOURCE_RESPONSE_TOO_LARGE');chunks.push(Buffer.from(value));}}
      finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
      const body=Buffer.concat(chunks);
      if(documents)documents.push({url,mediaType:mime.split(';')[0].trim(),bodyBase64:body.toString('base64')});
      if(url.endsWith('.xlsx'))return body;
      try{return JSON.parse(body.toString('utf8'));}catch{fail();}
    } catch(e) {
      if(signal?.aborted)fail('SOURCE_TIMEOUT');
      retry ||= controller.signal.aborted || e instanceof TypeError;
      if(!retry || attempt===limits.retries)fail(controller.signal.aborted?'SOURCE_TIMEOUT':e.code||'SOURCE_UNAVAILABLE');
    } finally {clearTimeout(timer);signal?.removeEventListener('abort',abort);await response?.body?.cancel().catch(()=>{});}
    const delay=Math.max(retryAfter,500*2**attempt);if(clock()-started+delay>=limits.totalMs)fail('SOURCE_TIMEOUT');await sleep(delay);
  }
}
function createOfficialSource({fetchImpl,clock=()=>Date.now(),sleep=ms=>new Promise(r=>setTimeout(r,ms)),limits=LIMITS,canonicalV2Enabled=false}={}) {
  if(typeof fetchImpl!=='function')throw new TypeError('Explicit transport required');
  if(typeof canonicalV2Enabled!=='boolean')throw new TypeError('Invalid canonical configuration');
  for(const key of Object.keys(LIMITS))if(!Number.isSafeInteger(limits[key])||limits[key]<(key==='retries'?0:1)||limits[key]>CAPS[key])throw new TypeError('Invalid source limits');
  return {async collect({source,signal,knownIdentifiers=[]}={}) {
    if(!Object.hasOwn(SOURCES,source))fail('INVALID_INPUT');
    const documents=canonicalV2Enabled?[]:null;
    const started=clock(),options={fetchImpl,signal,clock,started,limits,sleep,documents},config=SOURCES[source];
    const data=await fetchDocument(config.url,options);
    const asOf=new Date(started).toISOString().slice(0,10);
    let parsed=source==='INTERREG_EUROPE'?parseInterreg(data):parsePoctep(data,null);
    let pages=1;
    if(source==='POCTEP' && parsed.some(r=>!r.declaredClosed && r.fields.closingDate>=asOf)){parsed=parsePoctep(data,await fetchDocument(config.details,options));pages++;}
    const known=new Set(knownIdentifiers);
    const observedAt=new Date(clock()).toISOString();
    const eligible=parsed.filter(r=>known.has(r.externalIdentifier)||!r.declaredClosed && r.fields.closingDate>=observedAt.slice(0,10));
    const result={records:eligible.slice(0,limits.results).map(({externalIdentifier,fields,declaredClosed})=>({externalIdentifier,fields:{...fields,sourceTemporal:{status:declaredClosed?'CLOSED':'UNKNOWN',deadlines:[fields.closingDate],openings:[fields.openingDate]}}})),received:parsed.length,excluded:parsed.length-eligible.length,failed:0,pages,limited:eligible.length>limits.results,observedAt};
    if(canonicalV2Enabled){
      const {createOfficialProgrammeEvidenceV2,adaptOfficialProgrammeV2}=require('./officialAdapterV2');
      result.canonicalEvidence=createOfficialProgrammeEvidenceV2({source,observedAt:result.observedAt,documents});
      // Validate every observed row, including a legitimate empty selection.
      const snapshots=new Map(parsed.map(({externalIdentifier})=>[externalIdentifier,adaptOfficialProgrammeV2({sourceEvidence:result.canonicalEvidence,externalIdentifier})]));
      result.canonicalCandidates=result.records.map(({externalIdentifier})=>({externalIdentifier,canonicalSnapshot:snapshots.get(externalIdentifier)}));
    }
    return result;
  }};
}
module.exports={SOURCES,civil,parseInterreg,parsePoctep,tableCalls,createOfficialSource};
