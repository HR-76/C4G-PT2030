import { useEffect, useRef, useState } from 'react'
import { Check, Circle, ListChecks } from 'lucide-react'
import { privateApplicationsApi as api } from '../../api/api'
import FormModal from '../../components/FormModal'

// Points to settle in each phase and the transition that follows them.
// See context/features/application-pending-modal.md.
const POINTS = Object.freeze({
  IDENTIFIED: ['responsible', 'deadline'],
  INTENTION: ['team'],
  PREPARATION: ['team', 'partners', 'documents'],
})
const NEXT = Object.freeze({
  IDENTIFIED: ['PREPARATION', 'Iniciar a preparação'],
  INTENTION: ['PREPARATION', 'Iniciar a preparação'],
  PREPARATION: ['SUBMITTED', 'Registar a submissão'],
})
const TEXT = Object.freeze({
  responsible: { label: 'Responsável definido', action: 'Definir responsável', run: 'edit' },
  deadline: { label: 'Prazo interno definido', action: 'Definir prazo', run: 'edit' },
  team: { label: 'Equipa com pelo menos um participante', action: 'Abrir equipa', run: 'team' },
  partners: { label: 'Parceiros associados', action: 'Abrir parceiros', run: 'partners', optional: true },
  documents: { label: 'Documentação com pelo menos um documento', action: 'Abrir documentos', run: 'documents' },
})
const STATE_TEXT = { done: 'Feito', pending: 'Por tratar', loading: 'A consultar…', unavailable: 'Consulta indisponível' }
const sourceState = source => !source || source.state === 'loading' || source.state === 'updating' ? 'loading' : 'unavailable'

// Each state comes from the application data, so it is the same for every reader.
export function pendingPoints(status, record, work, documents, partners) {
  const state = {
    responsible: () => record?.responsibleMembershipId ? 'done' : 'pending',
    deadline: () => record?.deadline ? 'done' : 'pending',
    team: () => {
      if (work?.state !== 'ready') return sourceState(work)
      if (work.data.participants?.some(item => item.active)) return 'done'
      return work.data.participantNextCursor ? 'loading' : 'pending'
    },
    documents: () => documents?.state !== 'ready' ? sourceState(documents) : documents.data.documents?.length ? 'done' : 'pending',
    partners: () => partners?.state !== 'ready' ? sourceState(partners) : partners.total > 0 ? 'done' : 'pending',
  }
  return (POINTS[status] || []).map(id => ({ id, ...TEXT[id], state: state[id]() }))
}

export default function ApplicationPending({ status, record, work, documents, applicationId, organizationId, transitions = [], actions = {} }) {
  const [open, setOpen] = useState(false), [partners, setPartners] = useState(null)
  const trigger = useRef(null)
  const asksPartners = Boolean(POINTS[status]?.includes('partners'))
  // Partners are only read when the list is opened, and again each time it is.
  useEffect(() => {
    if (!open || !asksPartners) return
    const controller = new AbortController()
    let active = true
    setPartners({ state: 'loading' })
    api.partnersGet(applicationId, {}, organizationId, controller.signal)
      .then(({ data }) => { if (active) setPartners({ state: 'ready', total: data.total ?? data.items?.length ?? 0 }) })
      .catch(() => { if (active) setPartners({ state: 'unavailable' }) })
    return () => { active = false; controller.abort() }
  }, [open, asksPartners, applicationId, organizationId])
  if (!POINTS[status]) return null
  const points = pendingPoints(status, record, work, documents, partners)
  const required = points.filter(point => !point.optional)
  const count = required.filter(point => point.state === 'pending').length
  const settled = required.every(point => point.state === 'done')
  const [nextStatus, nextLabel] = NEXT[status]
  // The modal gives the focus back when it closes; the destination is opened after that.
  const follow = run => { setOpen(false); setTimeout(run, 0) }
  return <>
    <button type="button" ref={trigger} className="btn btn-outline application-pending-button" aria-haspopup="dialog"
      aria-label={count ? `Pendências: ${count} por tratar` : 'Pendências'} onClick={() => setOpen(true)}>
      <ListChecks size={16} aria-hidden="true" /> Pendências{count > 0 && <span className="application-pending-count" aria-hidden="true">{count}</span>}
    </button>
    {open && <FormModal title="Pendências da candidatura" returnFocusRef={trigger} onClose={() => setOpen(false)}>
      <div className="application-pending-modal">
        <ul className="application-pending-list" role="list">
          {points.map(point => {
            const run = actions[point.run]
            return <li key={point.id} className="application-pending-item" data-state={point.state}>
              <span className="application-pending-mark" aria-hidden="true">{point.state === 'done' ? <Check size={18} /> : <Circle size={18} />}</span>
              <div>
                <strong>{point.label}</strong>{point.optional && <span className="application-pending-optional"> (se aplicável)</span>}
                <span className="application-pending-state">{STATE_TEXT[point.state]}</span>
              </div>
              {point.state !== 'done' && run && <button type="button" className="btn btn-outline btn-sm" onClick={() => follow(run)}>{point.action}</button>}
            </li>
          })}
        </ul>
        {settled && actions.transition && transitions.includes(nextStatus) && <p className="application-pending-next" role="status">
          Pontos obrigatórios tratados. <button type="button" className="btn btn-primary btn-sm" onClick={() => follow(actions.transition)}>{nextLabel}</button>
        </p>}
        <p className="text-muted">Verificação interna: não confirma elegibilidade nem prontidão para submissão.</p>
      </div>
    </FormModal>}
  </>
}
