export const emptyCatalogFilters = Object.freeze({ q: '', source: '', interventionArea: '', programme: '', closingFrom: '', closingTo: '', temporalState: '' })

const utcToday = () => new Date().toISOString().slice(0, 10)
const nonEmpty = values => Object.fromEntries(Object.entries(values).filter(([, value]) => value))

export const catalogSourceOptions = Object.freeze([['PORTUGAL2030', 'Portugal 2030'], ['EU_FUNDING_TENDERS', 'EU Funding & Tenders'], ['INTERREG_EUROPE', 'Interreg Europe'], ['POCTEP', 'Interreg POCTEP']])
const publicSource = value => ['PORTUGAL2030_PLAN', 'PORTUGAL2030_NOTICE'].includes(value) ? 'PORTUGAL2030' : value === 'C4G_MANUAL' ? '' : value

export function initialCatalogFilters(params) {
  return params.has('view')
    ? Object.fromEntries(Object.keys(emptyCatalogFilters).map(key => [key, key === 'source' ? publicSource(params.get(key) || '') : params.get(key) || '']))
    : { ...emptyCatalogFilters }
}

export function catalogQuery(filters, cursor) {
  return nonEmpty({ ...filters, cursor })
}

export function catalogFilterParams(filters, period) {
  return { view: 'filtered', period, ...nonEmpty(filters) }
}

export function catalogPaginationParams(params, pages) {
  const query = new URLSearchParams(params)
  query.delete('catalogPrevious'); query.delete('catalogCursor')
  pages.slice(0, -1).forEach(value => query.append('catalogPrevious', value || ''))
  if (pages.at(-1)) query.set('catalogCursor', pages.at(-1))
  return query
}

export function catalogPeriodDates(period, today = utcToday()) {
  const offset = days => new Date(Date.parse(today) + days * 86400000).toISOString().slice(0, 10)
  return period === 'all' ? { closingFrom: '', closingTo: '' }
    : period === 'past' ? { closingFrom: '', closingTo: offset(-1) }
    : { closingFrom: today, closingTo: period === 'current' ? '' : offset(Number(period)) }
}
