// Aggregate only the records returned by the existing authorized list endpoints.
// A failed/incomplete read must never become a zero or a partial total.
export async function collectPages(list, isCurrent = () => true, { maxPages = 100, maxItems = 10000 } = {}) {
  const items = [], cursors = new Set()
  let cursor, pages = 0
  do {
    if (++pages > maxPages) throw new Error('Read limit exceeded')
    if (!isCurrent()) throw new Error('Context changed')
    const { data } = await list(cursor ? { cursor } : {})
    if (!isCurrent() || !Array.isArray(data?.items)) throw new Error('Incomplete read')
    items.push(...data.items)
    if (items.length > maxItems) throw new Error('Read limit exceeded')
    cursor = data.nextCursor
    if (cursor && cursors.has(cursor)) throw new Error('Repeated cursor')
    cursors.add(cursor)
  } while (cursor)
  return items
}

export function lisbonDay(date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Lisbon', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date)
}

export function sumMoney(items, field) {
  let cents = 0n, missing = 0
  for (const item of items) {
    const value = item[field]
    if (value == null) { missing++; continue }
    if (!/^\d+(\.\d{1,2})?$/.test(String(value))) throw new Error('Invalid budget')
    const [whole, fraction = ''] = String(value).split('.')
    cents += BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'))
  }
  return { total: items.length && missing === items.length ? null : `${cents / 100n}.${String(cents % 100n).padStart(2, '0')}`, missing, count: items.length }
}

export function exactMoney(value) {
  if (value == null) return 'Não disponível'
  const [whole, fraction = ''] = String(value).split('.')
  return `${whole.replace(/\B(?=(\d{3})+(?!\d))/g, '\u00a0')},${fraction.padEnd(2, '0')} €`
}

const ACTIVE = ['IDENTIFIED', 'INTENTION', 'PREPARATION', 'SUBMITTED']
export function applicationMetrics(items) {
  const approved = items.filter(item => item.status === 'APPROVED')
  const rejected = items.filter(item => item.status === 'REJECTED')
  return { total: items.length, active: items.filter(item => ACTIVE.includes(item.status)).length,
    submitted: items.filter(item => ['SUBMITTED', 'APPROVED', 'REJECTED'].includes(item.status)).length,
    approved: approved.length, rejected: rejected.length, decisions: approved.length + rejected.length,
    successRate: approved.length + rejected.length ? approved.length / (approved.length + rejected.length) * 100 : null,
    organizationBudget: sumMoney(items, 'organizationBudget'), totalBudget: sumMoney(items, 'totalBudget'), approvedBudget: sumMoney(approved, 'organizationBudget'),
    submittedBudget: sumMoney(items.filter(item => ['SUBMITTED', 'APPROVED', 'REJECTED'].includes(item.status)), 'organizationBudget'),
  }
}

export function summarizeOrganizationDashboard(central, privateItems, applications, today, report = {}) {
  const days = date => date && /^\d{4}-\d{2}-\d{2}/.test(date) ? Math.round((Date.parse(date.slice(0, 10)) - Date.parse(today)) / 86400000) : null
  const opportunities = [...central.map(item => ({ ...item, source: item.source || 'Fonte não indicada', root: '/catalogo' })),
    ...privateItems.map(item => ({ ...item, source: 'Registo privado', root: '/oportunidades' }))]
  const current = opportunities.filter(item => item.lifecycleState === 'ACTIVE' && days(item.closingDate) !== null && days(item.closingDate) >= 0)
  const active = applications.filter(item => ACTIVE.includes(item.status))
  const metrics = applicationMetrics(applications)
  const byStatus = applications.reduce((result, item) => ({ ...result, [item.status]: (result[item.status] || 0) + 1 }), {})
  return {
    role: 'ORGANIZATION', today, report,
    opportunities: { total: opportunities.length, open: current.length, closing_soon: current.filter(item => days(item.closingDate) <= 14).length },
    applications: { ...metrics, by_status: byStatus },
    budget: { approved: metrics.approvedBudget.total, total: metrics.organizationBudget.total, approvedMissing: metrics.approvedBudget.missing, missing: metrics.organizationBudget.missing },
    budget_by_status: Object.keys(byStatus).map(status => ({ status, ...sumMoney(applications.filter(item => item.status === status), 'organizationBudget') })),
    deadlines: active.filter(item => days(item.deadline) !== null && days(item.deadline) <= 30).sort((a,b) => a.deadline.localeCompare(b.deadline)).map(item => ({ id: item.applicationId, title: item.title, opportunity_title: item.opportunityTitle || 'Consultar candidatura', days_left: days(item.deadline), deadline: item.deadline })),
    source_totals: [...new Set(opportunities.map(item => item.source))].sort().map(source => ({ source, total: opportunities.filter(item => item.source === source).length, open: current.filter(item => item.source === source).length })),
    recent_opportunities: current.sort((a,b) => a.closingDate.localeCompare(b.closingDate)).slice(0, 10).map(item => ({ id: `${item.root}:${item.opportunityId}`, title: item.title, source: item.source, closing_date: item.closingDate, href: `${item.root}/${item.opportunityId}` })),
    unit_totals: report.unitsAvailable ? report.units.map(unit => ({ ...unit, ...applicationMetrics(applications.filter(item => item.unitId === unit.unitId)) })) : null,
  }
}

