export const weekdays = ['Segunda-feira', 'Terça-feira', 'Quarta-feira', 'Quinta-feira', 'Sexta-feira', 'Sábado', 'Domingo']
export const monthLabel = new Intl.DateTimeFormat('pt-PT', { month: 'long', year: 'numeric', timeZone: 'UTC' })
export const dayLabel = new Intl.DateTimeFormat('pt-PT', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' })
export const atNoon = day => new Date(day + 'T12:00:00Z')
export const isoDay = date => date.toISOString().slice(0, 10)

export function shiftMonth(month, offset) {
  const date = atNoon(month + '-01')
  date.setUTCMonth(date.getUTCMonth() + offset)
  return isoDay(date).slice(0, 7)
}

export function monthWeeks(month) {
  const start = atNoon(month + '-01')
  const firstColumn = (start.getUTCDay() + 6) % 7
  const end = new Date(start)
  end.setUTCMonth(start.getUTCMonth() + 1, 0)
  const days = end.getUTCDate()
  return Array.from({ length: Math.ceil((firstColumn + days) / 7) }, (_, week) =>
    weekdays.map((_, column) => {
      const day = week * 7 + column - firstColumn + 1
      return day >= 1 && day <= days ? `${month}-${String(day).padStart(2, '0')}` : null
    }))
}
