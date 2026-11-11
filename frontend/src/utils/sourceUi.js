const sourceNames = {
  PORTUGAL_2030: 'Portugal 2030',
  EU_FUNDING_TENDERS: 'EU Funding',
  CORDIS: 'CORDIS',
  ERASMUS: 'Erasmus+',
  INTERREG_EUROPE: 'Interreg Europe',
  POCTEP: 'Interreg POCTEP',
  Manual: 'Manual',
}

export function getSourceName(source) {
  return Object.hasOwn(sourceNames, source) ? sourceNames[source] : source || 'Manual'
}
