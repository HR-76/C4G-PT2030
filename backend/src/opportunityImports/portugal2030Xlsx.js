'use strict';

const crypto = require('node:crypto');
const xlsx = require('xlsx');
const { validateSnapshot } = require('../opportunities/contracts');
const { canonical } = require('../async/envelope');

const MAX_BYTES = 10 * 1024 * 1024;
const MAX_ROWS = 5000;
const PREVIEW_VALID_ROWS = 200;
const SOURCE_NAMESPACE = 'PORTUGAL_2030_XLSX';
const MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const ZERO_UUID = '00000000-0000-4000-8000-000000000000';

const ALIASES = Object.freeze({
  externalIdentifier: Object.freeze(['ID']),
  title: Object.freeze(['Designação do Aviso']),
  funderName: Object.freeze(['Programa']),
  programmeName: Object.freeze(['Programa']),
  summary: Object.freeze(['Objetivo Específico']),
  eligibilitySummary: Object.freeze(['Tipo Ent. Beneficiária']),
  openingDate: Object.freeze(['Data Início Prevista']),
  closingDate: Object.freeze(['Data Fim Prevista'])
});
const REQUIRED_SOURCE_COLUMNS = Object.freeze([
  'ID', 'Designação do Aviso', 'Programa', 'Data Início Prevista', 'Data Fim Prevista'
]);
const PROVEN_IGNORED_COLUMNS = Object.freeze([
  'Natureza Aviso', 'Fundo', 'Dotação Fundo', 'Quadrimestre', 'NUTS II',
  'Modalidade Apresentação Candidatura'
]);

class ImportValidationError extends Error {
  constructor(code, details = {}) { super(code); this.code = code; this.details = Object.freeze({...details}); }
}

function sha(value) { return crypto.createHash('sha256').update(value).digest('hex'); }
function normalizeHeader(value) {
  return String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ').trim();
}
function trim(value) {
  if (value === null || value === undefined) return null;
  const text = String(value).normalize('NFC').trim();
  return text || null;
}
function dateParts(year, month, day) {
  const candidate = `${String(year).padStart(4,'0')}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
  const parsed = new Date(`${candidate}T00:00:00.000Z`);
  return Number.isNaN(parsed.valueOf()) || parsed.toISOString().slice(0,10) !== candidate ? null : candidate;
}
function normalizeYear(value) { const year=Number(value); return year<100?(year>=70?1900+year:2000+year):year; }
function parseDate(value, date1904 = false) {
  if (value === null || value === undefined || value === '') return undefined;
  if (value instanceof Date) return dateParts(value.getUTCFullYear(), value.getUTCMonth()+1, value.getUTCDate()) || undefined;
  if (typeof value === 'number') { const parsed=xlsx.SSF.parse_date_code(value,{date1904}); return parsed?dateParts(parsed.y,parsed.m,parsed.d)||undefined:undefined; }
  const text=trim(value); if(!text)return undefined;
  let match=text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);if(match)return dateParts(match[1],match[2],match[3])||undefined;
  match=text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/);if(match)return dateParts(normalizeYear(match[3]),match[2],match[1])||undefined;
  return undefined;
}
function hasData(row) { return Array.isArray(row)&&row.some(value=>value!==null&&value!==undefined&&String(value).trim()!==''); }
function cellHasFormula(sheet, address) { return Boolean(sheet[address] && typeof sheet[address].f === 'string'); }

function readWorkbook(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 4) throw new ImportValidationError('IMPORT_FILE_INVALID');
  if (buffer.length > MAX_BYTES) throw new ImportValidationError('IMPORT_FILE_TOO_LARGE',{maxBytes:MAX_BYTES});
  try { return xlsx.read(buffer,{type:'buffer',cellDates:false,cellFormula:true,cellNF:false,cellText:false}); }
  catch { throw new ImportValidationError('IMPORT_FILE_INVALID'); }
}

function workbookSheets(buffer) {
  const workbook=readWorkbook(buffer);
  if (!workbook.SheetNames.length) throw new ImportValidationError('IMPORT_WORKBOOK_EMPTY');
  return Object.freeze(workbook.SheetNames.map((name,index)=>Object.freeze({index,name})));
}

function findHeader(matrix) {
  return matrix.findIndex(row=>{
    const normalized=new Set((row||[]).map(normalizeHeader).filter(Boolean));
    return REQUIRED_SOURCE_COLUMNS.every(column=>normalized.has(normalizeHeader(column)));
  });
}
function mappingFor(headers,headerDecisions) {
  const byNormalized=new Map(),duplicates=[];
  headers.forEach((header,index)=>{const normalized=normalizeHeader(header);if(!normalized)return;if(byNormalized.has(normalized))duplicates.push(header);else byNormalized.set(normalized,{header,index});});
  if(duplicates.length)throw new ImportValidationError('IMPORT_DUPLICATE_HEADER',{headers:Object.freeze(duplicates)});
  const fields={};
  for(const [field,aliases] of Object.entries(ALIASES)){
    const found=aliases.map(alias=>byNormalized.get(normalizeHeader(alias))).find(Boolean);
    if(found)fields[field]=Object.freeze({source:found.header,index:found.index});
  }
  const missing=REQUIRED_SOURCE_COLUMNS.filter(column=>!byNormalized.has(normalizeHeader(column)));
  const provenIgnored=headers.filter(header=>header!==null&&PROVEN_IGNORED_COLUMNS.some(alias=>normalizeHeader(alias)===normalizeHeader(header)));
  const unknown=headers.filter(header=>header!==null&&![...Object.values(fields).map(v=>v.source),...provenIgnored].includes(header));
  const decisions=headerDecisions===undefined?{}:headerDecisions;
  if(!decisions||typeof decisions!=='object'||Array.isArray(decisions))throw new ImportValidationError('IMPORT_HEADER_DECISION_INVALID');
  const decisionHeaders=Object.keys(decisions);
  const invalid=decisionHeaders.filter(header=>!unknown.includes(header)||!['IGNORE','REJECT'].includes(decisions[header]));
  if(invalid.length)throw new ImportValidationError('IMPORT_HEADER_DECISION_INVALID',{headers:Object.freeze(invalid)});
  const undecided=unknown.filter(header=>!Object.hasOwn(decisions,header));
  if(undecided.length)throw new ImportValidationError('IMPORT_HEADER_DECISION_REQUIRED',{headers:Object.freeze(undecided)});
  const rejected=unknown.filter(header=>decisions[header]==='REJECT');
  if(rejected.length)throw new ImportValidationError('IMPORT_HEADER_REJECTED',{headers:Object.freeze(rejected)});
  const explicitlyIgnored=unknown.filter(header=>decisions[header]==='IGNORE'),ignored=[...provenIgnored,...explicitlyIgnored];
  // Bind changed date/physical-row semantics to the approved preview. Old queued
  // mappings must fail closed rather than silently processing a different plan.
  const projection={version:2,parserVersion:'portugal2030-civil-physical-v2',source:'PORTUGAL_2030',fields:Object.freeze(fields),ignored:Object.freeze(ignored),unknown:Object.freeze([])};
  if(explicitlyIgnored.length)projection.explicitlyIgnored=Object.freeze(explicitlyIgnored);
  Object.freeze(projection);
  return Object.freeze({...projection,missing:Object.freeze(missing),digest:sha(canonical(projection))});
}
function sourceValue(row,mapping,field){const definition=mapping.fields[field];return definition?row[definition.index]:null;}
function rowDigest(row,mapping){return sha(canonical(Object.fromEntries(Object.keys(mapping.fields).sort().map(field=>[field,sourceValue(row,mapping,field)]))));}

function mapRow(row,mapping,line,sheet,date1904) {
  const errors=[];
  for(const field of ['externalIdentifier','title','funderName'])if(!trim(sourceValue(row,mapping,field)))errors.push(`IMPORT_${field.replace(/[A-Z]/g,c=>`_${c}`).toUpperCase()}_REQUIRED`);
  for(const definition of Object.values(mapping.fields)){
    const address=xlsx.utils.encode_cell({r:line-1,c:definition.index});
    if(cellHasFormula(sheet,address)){errors.push('IMPORT_FORMULA_NOT_ALLOWED');break;}
  }
  const openingRaw=sourceValue(row,mapping,'openingDate'),closingRaw=sourceValue(row,mapping,'closingDate');
  const openingDate=parseDate(openingRaw,date1904),closingDate=parseDate(closingRaw,date1904);
  if(openingRaw!==null&&openingRaw!==undefined&&String(openingRaw).trim()!==''&&!openingDate)errors.push('IMPORT_OPENING_DATE_INVALID');
  if(closingRaw!==null&&closingRaw!==undefined&&String(closingRaw).trim()!==''&&!closingDate)errors.push('IMPORT_CLOSING_DATE_INVALID');
  const snapshot={schemaVersion:1,title:trim(sourceValue(row,mapping,'title'))||'',funderName:trim(sourceValue(row,mapping,'funderName'))||'',
    provenanceId:ZERO_UUID,lifecycleState:'DRAFT',validationState:'PENDING_REVIEW',normalizationVersion:'opportunity-normalization-v1',qualityRuleVersion:'opportunity-quality-v1'};
  for(const field of ['programmeName','summary','eligibilitySummary']){const value=trim(sourceValue(row,mapping,field));if(value!==null)snapshot[field]=value;}
  const externalIdentifier=trim(sourceValue(row,mapping,'externalIdentifier'));
  if(externalIdentifier)snapshot.callReference=externalIdentifier;
  if(openingDate)snapshot.openingDate=openingDate;if(closingDate)snapshot.closingDate=closingDate;
  if(!errors.length){try{validateSnapshot(snapshot);}catch(error){errors.push(error.internalCode||error.code||'IMPORT_ROW_INVALID');}}
  return Object.freeze({line,rowDigest:rowDigest(row,mapping),externalIdentifier,snapshot:Object.freeze(snapshot),errors:Object.freeze([...new Set(errors)])});
}

function inspectPortugal2030Xlsx(buffer,{sheetName,headerDecisions}={}) {
  if(typeof sheetName!=='string'||!sheetName.trim())throw new ImportValidationError('IMPORT_SHEET_REQUIRED');
  const workbook=readWorkbook(buffer),sheet=workbook.Sheets[sheetName];
  if(!sheet)throw new ImportValidationError('IMPORT_SHEET_NOT_FOUND');
  // Keep physical row coordinates for diagnostics, formula checks and replay keys.
  const matrix=xlsx.utils.sheet_to_json(sheet,{header:1,defval:null,raw:true,blankrows:true,range:0});
  const headerIndex=findHeader(matrix);
  if(headerIndex<0)throw new ImportValidationError('IMPORT_REQUIRED_HEADERS_MISSING',{missing:REQUIRED_SOURCE_COLUMNS});
  const headers=(matrix[headerIndex]||[]).map(value=>trim(value));
  const mapping=mappingFor(headers,headerDecisions);
  if(mapping.missing.length)throw new ImportValidationError('IMPORT_REQUIRED_HEADERS_MISSING',{missing:mapping.missing});
  const dataRows=matrix.slice(headerIndex+1).map((row,index)=>({row,line:headerIndex+index+2})).filter(item=>hasData(item.row));
  if(dataRows.length>MAX_ROWS)throw new ImportValidationError('IMPORT_ROW_LIMIT_EXCEEDED',{maxRows:MAX_ROWS,rows:dataRows.length});
  const inspected=dataRows.map(item=>mapRow(item.row,mapping,item.line,sheet,Boolean(workbook.Workbook?.WBProps?.date1904)));
  const valid=inspected.filter(row=>row.errors.length===0),errors=inspected.filter(row=>row.errors.length>0).map(row=>Object.freeze({line:row.line,codes:row.errors,rowDigest:row.rowDigest}));
  return Object.freeze({source:'PORTUGAL_2030',sheetName,headerRow:headerIndex+1,totalRows:inspected.length,validRows:valid.length,errorRows:errors.length,
    mapping,rows:Object.freeze(inspected),preview:Object.freeze(valid.slice(0,PREVIEW_VALID_ROWS).map(row=>Object.freeze({line:row.line,snapshot:row.snapshot,externalIdentifier:row.externalIdentifier,rowDigest:row.rowDigest}))),errors:Object.freeze(errors),
    fileDigest:sha(buffer),limits:Object.freeze({maxBytes:MAX_BYTES,maxRows:MAX_ROWS,previewValidRows:PREVIEW_VALID_ROWS})});
}

module.exports={ALIASES,ImportValidationError,MAX_BYTES,MAX_ROWS,MIME,PREVIEW_VALID_ROWS,PROVEN_IGNORED_COLUMNS,REQUIRED_SOURCE_COLUMNS,SOURCE_NAMESPACE,inspectPortugal2030Xlsx,normalizeHeader,parseDate,workbookSheets};
