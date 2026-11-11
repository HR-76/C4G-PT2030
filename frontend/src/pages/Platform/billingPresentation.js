export const cycleStates = {
  DRAFT: 'Rascunho', READY_TO_ISSUE: 'Pronto a emitir', ISSUED: 'Emitido',
  CREDITED: 'Creditado', CANCELLED: 'Cancelado',
}

export const paymentStates = {
  UNPAID: 'Por pagar', PARTIALLY_PAID: 'Parcialmente pago', PAID: 'Pago', REVERSED: 'Estornado',
}

export const documentTypes = {
  INVOICE: 'Fatura', SIMPLIFIED_INVOICE: 'Fatura simplificada', INVOICE_RECEIPT: 'Fatura-recibo',
  CREDIT_NOTE: 'Nota de crédito', DEBIT_NOTE: 'Nota de débito',
}

export const documentStates = { ISSUED: 'Emitido', CREDITED: 'Creditado', CANCELLED: 'Cancelado' }
export const paymentMethods = {
  BANK_TRANSFER: 'Transferência bancária', DIRECT_DEBIT: 'Débito direto',
  CARD_PROVIDER: 'Prestador de cartão', OTHER: 'Outro',
}

export const activityLabels = {
  ACCOUNT_CREATED: 'Conta de faturação criada', ACCOUNT_VERSION_CREATED: 'Dados de faturação atualizados',
  CYCLE_CREATED: 'Ciclo criado', CYCLE_EDITED: 'Ciclo atualizado',
  CYCLE_READY_TO_ISSUE: 'Ciclo pronto a emitir', CYCLE_CANCELLED: 'Ciclo cancelado',
  PRIMARY_DOCUMENT_RECORDED: 'Documento fiscal registado', CORRECTIVE_DOCUMENT_RECORDED: 'Documento retificativo registado',
  DOCUMENT_CANCELLED: 'Documento cancelado', DOCUMENT_CREDITED: 'Documento creditado',
  PAYMENT_RECORDED: 'Pagamento registado', PAYMENT_REVERSED: 'Estorno registado',
}

const integerFormatter = new Intl.NumberFormat('pt-PT', { maximumFractionDigits: 0 })

export function formatMoney(value, currency) {
  if (typeof value !== 'string' || !/^-?(0|[1-9]\d*)(\.\d{1,6})?$/.test(value)) return '—'
  const negative = value.startsWith('-'), unsigned = negative ? value.slice(1) : value
  const [integer, rawFraction = ''] = unsigned.split('.')
  const fraction = rawFraction.replace(/0+$/, '').padEnd(2, '0')
  const amount = `${negative ? '−' : ''}${integerFormatter.format(BigInt(integer))}${fraction ? `,${fraction}` : ''}`
  return currency ? `${amount} ${currency}` : amount
}

export function formatDate(value) {
  if (!value) return '—'
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  return match ? `${match[3]}/${match[2]}/${match[1]}` : '—'
}

export function formatInstant(value) {
  if (!value) return '—'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '—' : new Intl.DateTimeFormat('pt-PT', {
    dateStyle: 'short', timeStyle: 'short', timeZone: 'Europe/Lisbon',
  }).format(date)
}

export function nullable(value) {
  const clean = String(value ?? '').trim()
  return clean || null
}

export function cleanParams(params) {
  return Object.fromEntries([...params.entries()].filter(([, value]) => value !== ''))
}

export function errorCode(error) {
  return error?.response?.data?.error?.code || ''
}

export function billingError(error) {
  const messages = {
    INVALID_INPUT: 'Existem dados inválidos. Reveja os campos assinalados e as datas.',
    C4G_ADMIN_REQUIRED: 'Esta área está reservada à administração C4G. O seu acesso pode ter sido alterado.',
    RESOURCE_NOT_AVAILABLE: 'O registo já não está disponível.',
    STALE_REVISION: 'O registo foi alterado entretanto. Atualize os dados antes de confirmar.',
    IDEMPOTENCY_CONFLICT: 'Este envio já foi usado com dados diferentes. Inicie novamente a ação.',
    BILLING_DOCUMENT_DUPLICATE: 'Este documento fiscal já está registado.',
    BILLING_CYCLE_NOT_EDITABLE: 'Este ciclo já não pode ser editado.',
    CYCLE_TRANSITION_NOT_ALLOWED: 'Esta alteração de estado do ciclo já não é permitida.',
    DOCUMENT_TRANSITION_NOT_ALLOWED: 'Esta alteração de estado do documento já não é permitida.',
    BILLING_CYCLE_NOT_READY: 'O ciclo ainda não está pronto para receber uma fatura.',
    BILLING_CURRENCY_MISMATCH: 'A moeda não coincide com a do ciclo.',
    BILLING_DOCUMENT_TOTAL_MISMATCH: 'O total do documento não coincide com o valor do ciclo.',
    BILLING_CREDIT_EXCEEDS_BALANCE: 'A nota de crédito excede o saldo disponível.',
    BILLING_DOCUMENT_HAS_PAYMENTS: 'O documento tem pagamentos e não pode ser cancelado.',
    BILLING_DOCUMENT_NOT_PAYABLE: 'Este documento não aceita pagamentos.',
    BILLING_DEBIT_CANCELLATION_EXCEEDS_BALANCE: 'A nota de débito não pode ser cancelada porque existem pagamentos acima do novo total.',
    BILLING_PAYMENT_EXCEEDS_BALANCE: 'O pagamento excede o saldo em aberto.',
    BILLING_REVERSAL_INVALID: 'O estorno excede o valor ainda disponível para estornar.',
    STATE_CONFLICT: 'O estado mudou entretanto. Atualize os dados antes de continuar.',
  }
  return messages[errorCode(error)] || 'Não foi possível concluir a operação. Tente novamente.'
}

export function isConflict(error) {
  return error?.response?.status === 409
}

export const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Lisbon' })

