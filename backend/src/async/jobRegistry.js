function createJobRegistry(definitions = []) {
  if (!Array.isArray(definitions)) throw new TypeError('Job registry must be an array.');
  const map = new Map();
  for (const raw of definitions) {
    if (!raw || !/^[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)+$/.test(raw.type) || !Number.isInteger(raw.version) || !Number.isInteger(raw.payloadVersion) || typeof raw.handler !== 'function') throw new TypeError('Job definition is invalid.');
    if (map.has(raw.type)) throw new TypeError('Job type is duplicated.');
    map.set(raw.type, Object.freeze({...raw}));
  }
  return Object.freeze({ supports(type, jobVersion, payloadVersion) { const d=map.get(type); return Boolean(d && [d.version,d.version-1].includes(jobVersion) && [d.payloadVersion,d.payloadVersion-1].includes(payloadVersion)); }, resolve(type) { return map.get(type) || null; }, types: Object.freeze([...map.keys()]) });
}
function createJobCatalog(definitions = []) {
  if (!Array.isArray(definitions) || !Object.isFrozen(definitions)) throw new TypeError('Job catalog must be a frozen array.');
  const seen = new Set();
  for (const entry of definitions) {
    if (!entry || !Object.isFrozen(entry) || Reflect.ownKeys(entry).length !== 3
      || !/^[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)+$/.test(entry.type)
      || entry.version !== 1 || entry.payloadVersion !== 1 || seen.has(entry.type)) throw new TypeError('Job catalog entry is invalid.');
    seen.add(entry.type);
  }
  return Object.freeze({ version: 'f12-opportunity-jobs-v1', types: Object.freeze([...seen]), resolve: type => definitions.find(item => item.type === type) || null });
}
module.exports = { createJobCatalog, createJobRegistry };
