'use strict';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function invalid() { throw Object.assign(new Error('INVALID_INPUT'), { code: 'INVALID_INPUT' }); }
function catalogQuery(input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(k => !['cursor', 'sort', 'q', 'source', 'programme', 'closingFrom', 'closingTo','temporalState','interventionArea'].includes(k))) invalid();
  const result = {};
  for (const [key, value] of Object.entries(input)) {
    if (typeof value !== 'string' || value.length > 200) invalid();
    if (value.trim()) result[key] = value.trim();
  }
  if (result.sort && !['closing_asc','closing_desc','amount_asc','amount_desc'].includes(result.sort)) invalid();
  if (result.cursor && !UUID.test(result.cursor)) invalid();
  if (result.source && !['PORTUGAL2030','EU_FUNDING_TENDERS','PORTUGAL2030_PLAN','PORTUGAL2030_NOTICE','INTERREG_EUROPE','POCTEP','C4G_MANUAL'].includes(result.source)) invalid();
  if(result.temporalState&&!['OPEN','UPCOMING','PLANNED','CLOSED','CANCELLED','UNKNOWN'].includes(result.temporalState))invalid();
  if(result.interventionArea && !['UNCLASSIFIED',...require('../opportunities/interventionAreas').INTERVENTION_AREAS.map(a=>a.code)].includes(result.interventionArea)) invalid();
  for (const key of ['closingFrom', 'closingTo']) {
    const value = result[key];
    if (value && (!/^\d{4}-\d{2}-\d{2}$/.test(value) || value < '0001-01-01' || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value)) invalid();
  }
  if (result.closingFrom && result.closingTo && result.closingFrom > result.closingTo) invalid();
  return result;
}
module.exports = { catalogQuery };
