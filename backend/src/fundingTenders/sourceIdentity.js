'use strict';
const OFFICIAL = Object.freeze(['INTERREG_EUROPE','POCTEP']);
const PATTERN = /^(INTERREG_EUROPE|POCTEP):2021-2027:CALL:[1-9][0-9]{0,2}$/;
function namespaceForSelection(source) { return OFFICIAL.includes(source) ? source : 'EU_FUNDING_TENDERS'; }
function namespaceForIdentity(identifier) { return PATTERN.exec(identifier)?.[1] || 'EU_FUNDING_TENDERS'; }
function validateSourceIdentity(source, identifier) {
  const namespace=namespaceForSelection(source);
  const reserved=/^(INTERREG_EUROPE|POCTEP):/i.test(identifier);
  if(typeof identifier!=='string' || namespaceForIdentity(identifier)!==namespace || reserved && !PATTERN.test(identifier))
    throw Object.assign(new Error('SOURCE_RECORD_INVALID'),{code:'SOURCE_RECORD_INVALID'});
  return namespace;
}
module.exports={OFFICIAL,namespaceForSelection,namespaceForIdentity,validateSourceIdentity};
