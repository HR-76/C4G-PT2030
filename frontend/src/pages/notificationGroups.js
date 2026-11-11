import { lisbonDay } from '../api/organizationDashboard'

export function notificationGroups(rows, now = new Date()) {
  const today = lisbonDay(now)
  const yesterdayDate = new Date(`${today}T12:00:00Z`)
  yesterdayDate.setUTCDate(yesterdayDate.getUTCDate() - 1)
  const yesterday = yesterdayDate.toISOString().slice(0, 10)
  const groups = ['Hoje', 'Ontem', 'Anteriores', 'Outras datas'].map(label => ({ label, rows: [] }))
  const timestamp = row => Date.parse(row.created_at)
  for (const row of [...rows].sort((a, b) => (timestamp(b) || 0) - (timestamp(a) || 0))) {
    const valid = Number.isFinite(timestamp(row))
    const day = valid ? lisbonDay(new Date(row.created_at)) : null
    const index = day === today ? 0 : day === yesterday ? 1 : day && day < yesterday ? 2 : 3
    groups[index].rows.push(row)
  }
  return groups.filter(group => group.rows.length)
}
