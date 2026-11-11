import { Plus, Pencil, ArrowRightLeft, ChevronDown } from 'lucide-react'
import { LABEL, budgetLabel, dateLabel } from './lifecycle'
import { unitLabel } from '../Interests/UnitSelector'
import './application-timeline.css'

function snapshot(revision, responsibles) {
  const names = revision.units || []
  const units = revision.unitIds?.map(id => unitLabel(names.find(unit => unit.unitId === id) || {unitId:id,label:id}, names)).sort()
  const responsible = responsibles.find(person => person.membershipId === revision.responsibleMembershipId)
  return [
    ['Título', revision.title],
    ['Responsável', revision.responsibleName || responsible?.name || revision.responsibleMembershipId],
    ['Prazo interno', dateLabel(revision.deadline)],
    ['Orçamento total', budgetLabel(revision.totalBudget)],
    ['Orçamento da organização', budgetLabel(revision.organizationBudget)],
    ...(units ? [['Departamentos / Unidades', units.join('; ') || 'Sem unidade atribuída']] : []),
    ['Notas', revision.notes || 'Sem notas'],
  ]
}

const historicalLabel = status => status === 'INTENTION' ? 'Intenção' : LABEL[status] || status
const eventDate = new Intl.DateTimeFormat('pt-PT', {
  dateStyle: 'medium',
  timeStyle: 'short',
  timeZone: 'Europe/Lisbon',
})

export default function ApplicationTimeline({ history, record, responsibles }) {
  if (!history.length) return <p className="revision-empty">Ainda não existem eventos no histórico desta candidatura.</p>

  return <ol className="revision-timeline" aria-label="Cronologia de revisões">{history.map((revision, index) => {
    const created = revision.kind === 'CREATE', edited = revision.kind === 'EDIT'
    const Icon = created ? Plus : edited ? Pencil : ArrowRightLeft
    const previous = history[index + 1]
    const fields = snapshot(revision, responsibles)
    const earlier = previous?.revision === revision.revision - 1 ? new Map(snapshot(previous, responsibles)) : null
    const changes = earlier ? fields.filter(([key,value]) => earlier.has(key) && earlier.get(key) !== value) : []
    const current = revision.revision === record.revision
    const title = created ? 'Candidatura criada' : edited ? 'Dados alterados' : 'Estado alterado'
    const date = Date.parse(revision.recordedAt)

    return <li key={revision.revision} className="revision-event" data-current={current}>
      <span className="revision-marker"><Icon size={17} aria-hidden="true" /></span>
      <article>
        <details>
          <summary className="revision-summary">
            <span className="revision-summary-content">
              <span className="revision-title">
                <strong>{title}</strong>
                {current && <span className="revision-latest">Mais recente</span>}
              </span>
              {created && <span className="revision-status">Estado inicial: <strong>{historicalLabel(revision.toStatus)}</strong></span>}
              {!created && !edited && <span className="revision-status">{historicalLabel(revision.fromStatus)} → <strong>{historicalLabel(revision.toStatus)}</strong></span>}
              {Number.isFinite(date)
                ? <time dateTime={revision.recordedAt}>{eventDate.format(date)}</time>
                : <span className="revision-status">Data não registada</span>}
            </span>
            <span className="revision-disclosure">Detalhes <ChevronDown size={16} aria-hidden="true" /></span>
          </summary>
          <div className="revision-detail">
            <p className="revision-number">Revisão {revision.revision}</p>
            {revision.reason && <p className="revision-reason"><strong>Motivo</strong> {revision.reason}</p>}
            {changes.length > 0 && <ul className="revision-changes" aria-label="Campos alterados">
              {changes.map(([key, value]) => <li key={key}>
                <strong>{key}</strong>
                <div><span>Antes</span> {earlier.get(key) || '—'}</div>
                <div><span>Depois</span> {value || '—'}</div>
              </li>)}
            </ul>}
            {edited && !earlier && <p>A comparação requer a revisão anterior.</p>}
            {edited && earlier && !changes.length && <p>Sem diferenças nos campos comparáveis.</p>}
            <dl className="revision-fields" aria-label="Dados desta revisão">
              {fields.map(([key, value]) => <div key={key}><dt>{key}</dt><dd>{value || '—'}</dd></div>)}
            </dl>
          </div>
        </details>
      </article>
    </li>
  })}</ol>
}
