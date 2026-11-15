export const emailTypes = {
  'member-invitation': 'Convite de colaborador',
  'password-reset': 'Reposição de palavra-passe',
}

// The invitation remains available with the original API. Authentication
// templates additionally require an affirmative capability from the server.
export const emailTypeCatalog = [
  { type: 'member-invitation', label: emailTypes['member-invitation'], sender: 'Aplicação', scope: 'Global e por entidade', configurable: true },
  { type: 'password-reset', label: emailTypes['password-reset'], sender: 'Serviço de autenticação', scope: 'Global', note: 'O texto é definido no serviço de autenticação.' },
]

export const isConfigurableType = (type, summary) => type === 'member-invitation'
  || (type === 'password-reset' && summary?.configurable === true)

// What the server reports about a configurable type, in words.
export function typeStatus(summary) {
  const count = Number(summary?.organizations || 0)
  return [
    summary?.globalCustomized ? 'Template global alterado' : 'Texto original da plataforma',
    ...(count ? [`${count} ${count === 1 ? 'entidade' : 'entidades'} com template próprio`] : []),
  ]
}

export const variableLabels = {
  Organizacao: 'Nome da entidade',
  LigacaoAtivacao: 'Ligação de ativação',
  LigacaoRecuperacao: 'Ligação de recuperação',
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
    RESOURCE_NOT_AVAILABLE: 'O template ou a entidade já não está disponível.',
    STALE_REVISION: 'O template foi alterado entretanto. Recarregue antes de guardar.',
    IDEMPOTENCY_CONFLICT: 'Este pedido já foi usado com dados diferentes. Repita a ação.',
    EMAIL_TEMPLATE_NOT_CUSTOMIZED: 'Este template já não tem alterações próprias para repor.',
    STATE_CONFLICT: 'O template foi alterado entretanto. Recarregue e repita.',
    // The server answers these while sending is not built yet, or where the logos are not installed.
    EMAIL_DELIVERY_UNAVAILABLE: 'O envio de teste ainda não está disponível.',
    EMAIL_PUBLISH_UNAVAILABLE: 'Não foi possível confirmar a publicação no serviço de autenticação. Recarregue o template antes de repetir.',
    EMAIL_PUBLICATION_DRIFT: 'O texto no serviço de autenticação foi alterado entretanto. Recarregue o template antes de guardar.',
    OPERATION_NOT_AVAILABLE: 'Esta função ainda não está disponível.',
    EMAIL_LOGO_INVALID: 'O ficheiro não é uma imagem PNG ou JPEG válida.',
    EMAIL_LOGO_TOO_LARGE: 'A imagem excede 512 KB.',
    EMAIL_LOGO_DIMENSIONS: 'A imagem excede 1200 × 600 píxeis.',
    EMAIL_LOGO_NOT_SET: 'O logótipo original já está em uso.',
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
