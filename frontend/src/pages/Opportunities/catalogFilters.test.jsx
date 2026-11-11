import { expect, it } from 'vitest'
import { emptyCatalogFilters, initialCatalogFilters, catalogFilterParams, catalogPaginationParams, catalogPeriodDates, catalogQuery, catalogSourceOptions } from './catalogFilters'

it('starts with all deadlines and restores only supported applied filters', () => {
  expect(initialCatalogFilters(new URLSearchParams(), '2026-11-01')).toEqual(emptyCatalogFilters)
  expect(initialCatalogFilters(new URLSearchParams('view=filtered&q=water&temporalState=PLANNED&organizationId=other&closingFrom='))).toEqual({ ...emptyCatalogFilters, q: 'water', temporalState: 'PLANNED' })
})

it.each([
  ['all', '2026-11-01', '', ''],
  ['past', '2026-01-01', '', '2025-12-31'],
  ['current', '2026-11-01', '2026-11-01', ''],
  ['7', '2028-02-25', '2028-02-25', '2028-03-03'],
  ['14', '2026-12-25', '2026-12-25', '2027-01-08'],
  ['30', '2026-10-15', '2026-10-15', '2026-11-14'],
])('keeps inclusive %s deadlines independent of daylight-saving changes', (period, today, closingFrom, closingTo) => {
  expect(catalogPeriodDates(period, today)).toEqual({ closingFrom, closingTo })
})

it('preserves filter text and cursor history without modifying the previous URL', () => {
  const params = new URLSearchParams('view=filtered&q=climate%26water&period=all&catalogCursor=stale&catalogPrevious=stale-first')
  const next = catalogPaginationParams(params, [null, 'opaque+cursor', 'next/=='])
  expect(next.get('q')).toBe('climate&water')
  expect(next.getAll('catalogPrevious')).toEqual(['', 'opaque+cursor'])
  expect(next.get('catalogCursor')).toBe('next/==')
  expect(params.get('catalogCursor')).toBe('stale')
  const previous = catalogPaginationParams(next, [null])
  expect(previous.has('catalogCursor')).toBe(false)
  expect(previous.has('catalogPrevious')).toBe(false)
  expect(previous.get('q')).toBe('climate&water')
})

it('applies filters without carrying a stale cursor and clears every deadline', () => {
  const selected = { ...emptyCatalogFilters, q: 'climate', temporalState: 'PLANNED' }
  expect(catalogFilterParams(selected, 'all')).toEqual({ view: 'filtered', period: 'all', q: 'climate', temporalState: 'PLANNED' })
  expect(catalogQuery(selected, 'opaque')).toEqual({ q: 'climate', temporalState: 'PLANNED', cursor: 'opaque' })
  expect(catalogQuery(emptyCatalogFilters, null)).toEqual({})
  expect(catalogFilterParams(emptyCatalogFilters, 'all')).toEqual({ view: 'filtered', period: 'all' })
})

it('restores source and retains it across cursor navigation, then clears it', () => {
 const filters=initialCatalogFilters(new URLSearchParams('view=filtered&source=POCTEP&programme=Horizon'))
 expect(filters.source).toBe('POCTEP')
 expect(catalogQuery(filters,'next')).toEqual({source:'POCTEP',programme:'Horizon',cursor:'next'})
 const params=catalogPaginationParams(new URLSearchParams(catalogFilterParams(filters,'all')),[null,'next'])
 expect(params.get('source')).toBe('POCTEP')
 expect(catalogFilterParams({...filters,source:''},'all')).toEqual({view:'filtered',period:'all',programme:'Horizon'})
})

it('presents one Portugal 2030 source and no manual source, restoring old links compatibly',()=>{
 expect(catalogSourceOptions.filter(([,label])=>label==='Portugal 2030')).toHaveLength(1)
 expect(catalogSourceOptions.some(([code])=>code==='C4G_MANUAL'||code==='PORTUGAL2030_PLAN'||code==='PORTUGAL2030_NOTICE')).toBe(false)
 for(const old of ['PORTUGAL2030_PLAN','PORTUGAL2030_NOTICE'])expect(initialCatalogFilters(new URLSearchParams('view=filtered&source='+old)).source).toBe('PORTUGAL2030')
 expect(initialCatalogFilters(new URLSearchParams('view=filtered&source=C4G_MANUAL')).source).toBe('')
})
