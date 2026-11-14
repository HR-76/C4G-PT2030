export const emailTypes = {
  'member-invitation': 'Convite de colaborador',
}

export const variableLabels = {
  Organizacao: 'Nome da entidade',
  LigacaoAtivacao: 'Ligação de ativação',
  Validade: 'Validade da ligação',
  Logotipo: 'Logótipo',
}

export const limits = { subject: 200, html: 20000 }

const removedLabels = {
  script: 'código (script)',
  style: 'estilos',
  iframe: 'conteúdo incorporado',
  img: 'imagens',
  form: 'formulários',
  input: 'campos de formulário',
  'a[href]': 'ligações que não são https',
}

// Turns the server's list of removed markup into words an administrator reads.
export function removedSummary(removed = []) {
  const labels = removed.map(item => removedLabels[item] || (item.includes('[') ? 'formatação não suportada' : `elemento ${item}`))
  return [...new Set(labels)]
}

const reasonMessages = {
  SUBJECT_REQUIRED: () => 'Indique o assunto.',
  SUBJECT_TOO_LONG: () => `O assunto tem mais de ${limits.subject} caracteres.`,
  SUBJECT_LINE_BREAK: () => 'O assunto não pode ter quebras de linha.',
  BODY_REQUIRED: () => 'Escreva o corpo do email.',
  BODY_TOO_LONG: () => 'O corpo do email é demasiado longo.',
  RESERVED_TEXT: () => 'O texto contém uma marca reservada pelo sistema. Retire-a.',
  UNKNOWN_VARIABLE: reason => `A variável {${reason.variable}} não existe.`,
  VARIABLE_NOT_ALLOWED_IN_SUBJECT: reason => `A variável {${reason.variable}} não pode ser usada no assunto.`,
  REQUIRED_VARIABLE_MISSING: reason => `Falta ${(variableLabels[reason.variable] || reason.variable).toLowerCase()} no corpo do email.`,
}

export function reasonList(reasons = []) {
  return reasons.map(reason => (reasonMessages[reason.code] || (() => 'O template tem um problema por corrigir.'))(reason))
}

export function emailError(error) {
  const code = error?.response?.data?.error?.code
  const messages = {
    EMAIL_TEMPLATE_INVALID: 'O template não pode ser guardado. Corrija os pontos indicados.',
    INVALID_INPUT: 'Existem dados inválidos. Reveja os campos.',
    C4G_ADMIN_REQUIRED: 'Esta área está reservada à administração C4G. O seu acesso pode ter sido alterado.',
    RESOURCE_NOT_AVAILABLE: 'A entidade já não está disponível.',
    STALE_REVISION: 'O template foi alterado entretanto. Recarregue antes de guardar.',
    IDEMPOTENCY_CONFLICT: 'Este pedido já foi usado com dados diferentes. Repita a ação.',
    EMAIL_LOGO_INVALID: 'O ficheiro não é uma imagem PNG ou JPEG válida.',
    EMAIL_LOGO_TOO_LARGE: 'A imagem excede 512 KB.',
    EMAIL_LOGO_DIMENSIONS: 'A imagem excede 1200 × 600 píxeis.',
  }
  if (error?.response?.status === 403 && !messages[code]) return messages.C4G_ADMIN_REQUIRED
  return messages[code] || 'Não foi possível concluir. Tente novamente.'
}

export function errorReasons(error) {
  return reasonList(error?.response?.data?.error?.reasons)
}

// Immediate feedback only. The server repeats and extends these checks.
export function missingVariables(html, required = []) {
  return required.filter(name => !String(html).includes(`{${name}}`))
}

export const testStatus = {
  ACCEPTED: to => `Email de teste enviado para ${to}.`,
  NOT_CONFIGURED: () => 'O envio de email não está configurado neste ambiente.',
  UNCONFIRMED: () => 'O envio não foi confirmado. Verifique a caixa de correio antes de repetir.',
}

export function formatInstant(value) {
  return new Intl.DateTimeFormat('pt-PT', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Europe/Lisbon' }).format(new Date(value))
}
