export const money = value => Array.isArray(value) && value.length
  ? value.map(part => `${new Intl.NumberFormat('pt-PT', { maximumFractionDigits: 2 }).format(Number(part.amount))} ${part.currencyState === 'PRESENT' ? '€' : '(moeda por confirmar)'}`).join('; ')
  : 'Sem dotação publicada'
export const time = value => new Intl.DateTimeFormat('pt-PT', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Europe/Lisbon' }).format(new Date(value))
export const code = error => error?.response?.data?.error?.code || error?.message || 'SERVICO_INDISPONIVEL'
