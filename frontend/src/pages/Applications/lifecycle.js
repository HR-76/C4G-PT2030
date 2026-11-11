export { applicationStatusLabels as LABEL, applicationStatusChips as CHIP } from '../../utils/applicationStatuses'
export function budgetLabel(value) {
  if(value===null||value===undefined||value==='')return '—'
  // Keep all significant decimal digits, including cents at the contract maximum.
  const [whole,cents='']=String(value).split('.')
  return `${BigInt(whole).toLocaleString('pt-PT')},${cents.padEnd(2,'0')} €`
}
export const dateLabel = value => value ? new Date(value.length===10?`${value}T12:00:00`:value).toLocaleDateString('pt-PT') : '—'
