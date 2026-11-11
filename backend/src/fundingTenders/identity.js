'use strict';
const CASCADE_PREFIX = 'CASCADE:';
const CASCADE_BASE = 'https://ec.europa.eu/info/funding-tenders/opportunities/portal/screen/opportunities/competitive-calls-cs/';
function invalid() { throw Object.assign(new Error('SOURCE_RECORD_INVALID'), { code: 'SOURCE_RECORD_INVALID' }); }
function cascadeKey(id) {
  if (typeof id !== 'string' || !/^[1-9][0-9]{0,39}$/.test(id)) invalid();
  return CASCADE_PREFIX + id;
}
function externalIdentity(type, topic, callId) {
  if (type === '8') return cascadeKey(callId);
  if (/^(CASCADE|INTERREG_EUROPE|POCTEP):/i.test(topic)) invalid();
  return topic;
}
function cascadeKeyFromUrl(value) {
  if (typeof value !== 'string' || !value.includes('/competitive-calls-cs/')) return null;
  if (!value.startsWith(CASCADE_BASE)) invalid();
  return cascadeKey(value.slice(CASCADE_BASE.length));
}
module.exports = { CASCADE_PREFIX, CASCADE_BASE, cascadeKey, externalIdentity, cascadeKeyFromUrl };
