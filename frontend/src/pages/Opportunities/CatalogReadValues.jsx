import { CatalogMoney } from './CatalogPresentation'

export const labels = {
  archived: 'Conteúdo arquivado',
  reference_only: 'Apenas referência à fonte',
  material: 'Material',
  informational: 'Informativo',
  unresolved: 'Por resolver',
  resolved: 'Resolvido',
  plan_to_notice: 'Correspondência entre plano e aviso',
  call_to_topic: 'Convite e tópico',
  supersedes: 'Substitui',
  related: 'Relacionado',
  probable: 'Provável',
  EU_FUNDING_TENDERS: 'EU Funding & Tenders',
  PORTUGAL2030_PLAN: 'Portugal 2030 · Plano',
  recordedAt: 'Registado em',
  from: 'Desde',
  to: 'Até',
  metadata_only: 'Apenas metadados',
  source_url_only: 'Apenas ligação à fonte',
  bytes_preserved: 'Conteúdo preservado',
  q: 'Código ou título',
  status: 'Estado',
  quality: 'Qualidade',
  programme: 'Programa',
  source: 'Fonte',
  kind: 'Tipo',
  deadline_from: 'Prazo desde',
  deadline_to: 'Prazo até',
  funding_min: 'Dotação mínima',
  currency: 'Moeda',
  sort: 'Ordenação',
  title: 'Título',
  deadline: 'Prazo',
  '-deadline': 'Prazo decrescente',
  '-observed_at': 'Observação mais recente',
  planned: 'Planeado',
  forthcoming: 'Previsto',
  open: 'Aberto',
  closed: 'Encerrado',
  suspended: 'Suspenso',
  cancelled: 'Cancelado',
  conditional: 'Condicionado',
  unknown: 'Desconhecido',
  partial: 'Parcial',
  conflicted: 'Com conflito',
  stale: 'Desatualizado',
  complete: 'Completo',
  not_applicable: 'Não aplicável',
  confirmed: 'Confirmado',
  disputed: 'Em disputa',
  published_notice: 'Aviso publicado',
  planned_notice: 'Aviso planeado',
  grant_topic: 'Tópico',
  cascade_call: 'Financiamento em cascata',
  call_for_proposals: 'Convite a propostas',
  label: 'Designação',
  scopeLabel: 'Âmbito',
  phase: 'Fase',
  round: 'Ronda',
  sequence: 'Sequência',
  opening: 'Abertura',
  closing: 'Fecho',
  applicability: 'Aplicabilidade',
  condition: 'Condição',
  effectiveAt: 'Produz efeitos em',
  money: 'Verba',
  programmeId: 'Programa',
  fundCode: 'Fundo',
  period: 'Período',
  baseRate: 'Taxa base',
  bonusPercentagePoints: 'Majoração (pontos percentuais)',
  capRate: 'Taxa máxima',
  conditions: 'Condições',
  versionLabel: 'Versão',
  role: 'Função',
  publishedAt: 'Publicado em',
  observedAt: 'Observado em',
  sourceUrls: 'Ligações à fonte',
  supersessionScope: 'Âmbito da substituição',
  preservation: 'Preservação',
  fieldPath: 'Campo',
  severity: 'Gravidade',
  reason: 'Motivo',
  alternatives: 'Alternativas',
  decision: 'Decisão',
  targetExternalCode: 'Código de destino',
  relation: 'Relação',
  confidence: 'Confiança',
  explicitOfficialLink: 'Ligação oficial explícita',
  differences: 'Diferenças',
  namespace: 'Fonte',
  retrievedAt: 'Recolhido em',
  sourceUrl: 'Fonte oficial',
  eventType: 'Evento',
  occurredAt: 'Data',
  description: 'Descrição',
  state: 'Estado',
  value: 'Valor',
  basis: 'Base',
  scope: 'Âmbito',
  notice: 'Aviso',
  call: 'Convite',
  topic: 'Tópico',
  project: 'Projeto',
}
const statusReasons = {
  AMBIGUOUS_DEADLINE_PRECISION:
    'A precisão das datas não permite determinar o prazo com segurança.',
  MULTIPLE_DEADLINE_CANDIDATES: 'Existem vários prazos candidatos.',
  DEADLINE_TIME_NOT_PUBLISHED: 'A hora de fecho não foi publicada.',
  DEADLINE_PERIOD_IN_PROGRESS: 'O período de candidatura está em curso.',
  TEMPORAL_CONFLICT: 'Existem informações temporais em conflito.',
  SOURCE_STATUS_FINAL: 'A fonte indica um estado final.',
  PUBLICATION_PLANNED: 'Publicação planeada.',
  PUBLICATION_NOT_CONFIRMED: 'A publicação ainda não está confirmada.',
  OPENING_IN_FUTURE: 'A abertura está prevista para uma data futura.',
  ALL_CONFIRMED_DEADLINES_PASSED: 'Todos os prazos confirmados terminaram.',
  OPENING_REACHED_WITH_FUTURE_DEADLINE:
    'A data de abertura foi atingida e existe um prazo futuro.',
  SOURCE_STATUS_ONLY: 'O estado baseia-se apenas na indicação da fonte.',
  OPENING_TIME_NOT_PUBLISHED: 'A hora de abertura não foi publicada.',
  INSUFFICIENT_TEMPORAL_EVIDENCE:
    'Não existe informação temporal suficiente para determinar o estado.',
}
export const explainStatus = (text) =>
  text
    .split('; ')
    .map(
      (part) =>
        statusReasons[part] ||
        (/^[A-Z_]+$/.test(part)
          ? 'Estado pendente de interpretação; consulte os prazos e a fonte oficial.'
          : part),
    )
    .join(' ')
export const filterKeys = [
  'q',
  'status',
  'quality',
  'programme',
  'source',
  'kind',
  'deadline_from',
  'deadline_to',
  'funding_min',
  'currency',
  'sort',
]
export const sections = [
  ['windows', 'Janelas e prazos'],
  ['funding', 'Financiamento'],
  ['funding-rules', 'Regras de financiamento'],
  ['documents', 'Documentos e versões'],
  ['conflicts', 'Conflitos'],
  ['relationships', 'Correspondências'],
  ['history', 'Histórico'],
  ['evidence', 'Evidências'],
]
export const cleanFilters = (params) =>
  Object.fromEntries(
    filterKeys.filter((k) => params.get(k)).map((k) => [k, params.get(k)]),
  )
export const exactAmount = (value) => {
  const [whole, decimal] = String(value).split('.')
  return (
    whole.replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + (decimal ? ',' + decimal : '')
  )
}
export function safeLink(value) {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && !url.username && !url.password
      ? url.href
      : null
  } catch {
    return null
  }
}
export function OfficialLink({ url, children }) {
  const href = safeLink(url)
  return href ? (
    <a href={href} target="_blank" rel="noopener noreferrer">
      {children || 'Consultar fonte oficial'} ↗
    </a>
  ) : null
}
export function Value({ value }) {
  if (value == null) return <>Não indicado</>
  if (typeof value !== 'object') return <>{labels[value] || String(value)}</>
  if (Array.isArray(value))
    return value.length ? (
      <ul>
        {value.map((v, i) => (
          <li key={i}>
            <Value value={v} />
          </li>
        ))}
      </ul>
    ) : (
      <>Sem elementos registados</>
    )
  if (value.state && 'value' in value)
    return value.state === 'PRESENT' ? (
      <Value value={value.value} />
    ) : (
      <>
        {{
          UNKNOWN: 'Desconhecido',
          NOT_PROVIDED: 'Não fornecido',
          NOT_APPLICABLE: 'Não aplicável',
          CONFLICTED: 'Em conflito',
          MISSING: 'Em falta',
          NOT_FOUND: 'Não encontrado na fonte',
          NOT_COLLECTED: 'Não recolhido',
          CONFLICT: 'Em conflito',
          UNSUPPORTED: 'Formato não suportado',
        }[value.state] || 'Não disponível'}
        {value.reason ? `: ${value.reason}` : ''}
      </>
    )
  if (value.kind === 'date') return <>{value.date}</>
  if (value.kind === 'local_datetime') {
    if (typeof value.local !== 'string') return <>Não disponível</>
    return (
      <>
        {value.local.replace('T', ' ')} (
        {value.timezone || 'fuso horário não indicado'})
      </>
    )
  }
  if (value.kind === 'period')
    return (
      <>
        {value.label} · De <Value value={value.from} /> até{' '}
        <Value value={value.to} />
      </>
    )
  if (value.kind === 'instant')
    return typeof value.utc === 'string' ? <>{value.utc.replace('T', ' ').replace('Z', ' UTC')}</> : <>Não disponível</>
  if ('amount' in value)
    return (
      <>
        <CatalogMoney money={value} /> ·{' '}
        {labels[value.scope] || value.scope} ·{' '}
        {labels[value.basis] || value.basis}
        {value.sharedGroupId ? ' · Verba partilhada' : ''}
      </>
    )
  return (
    <dl>
      {Object.entries(value)
        .filter(
          ([key]) =>
            ![
              'id',
              'evidenceIds',
              'contentSha256',
              'locator',
              'href',
              'targetId',
              'supersedesId',
              'supersedesVersionId',
              'selectedAlternativeId',
              'documentId',
              'revisionId',
            ].includes(key),
        )
        .map(([key, v]) => (
          <div key={key}>
            <dt>{labels[key] || key}</dt>
            <dd>
              {['sourceUrl', 'url'].includes(key) ? (
                <OfficialLink url={v} />
              ) : key === 'sourceUrls' ? (
                Array.isArray(v) ? v.map((url, i) => (
                  <p key={i}>
                    <OfficialLink url={url} />
                  </p>
                )) : <>Não disponível</>
              ) : key === 'alternatives' ? (
                Array.isArray(v) ? <ul>
                  {v.map((alternative) => (
                    <li key={alternative.id}>
                      <strong>
                        {alternative.id === value.selectedAlternativeId
                          ? 'Alternativa selecionada'
                          : 'Alternativa'}
                      </strong>
                      <Value value={alternative} />
                    </li>
                  ))}
                </ul> : <>Não disponível</>
              ) : (
                <>
                  <Value value={v} />
                  {['baseRate', 'capRate'].includes(key) &&
                  v?.state === 'PRESENT'
                    ? ' %'
                    : ''}
                </>
              )}
            </dd>
          </div>
        ))}
    </dl>
  )
}
