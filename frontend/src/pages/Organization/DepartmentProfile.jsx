import { useRef, useState } from 'react'
import FormModal from '../../components/FormModal'
import { AreaOptions } from './OrganizationStrategy'

const maxObjectives = 20
const clean = value => value.trim().replace(/\s+/g, ' ')
const failures = {
  STRATEGIC_AREA_REQUIRED: 'Inclua pelo menos uma área estratégica da entidade.',
  STRATEGIC_OBJECTIVE_UNAVAILABLE: 'Um objetivo estratégico associado já não existe. Feche e abra o perfil para rever.',
  STALE_REVISION: 'A estratégia da organização mudou entretanto. Feche e abra o perfil para rever.',
  UNIT_UNAVAILABLE: 'Este departamento já não está ativo.',
  INVALID_INPUT: 'Verifique os campos.',
}

// A department's interests and objectives inside the entity strategy. Areas may go
// beyond the strategic ones; those are kept and shown as outside the strategy.
export default function DepartmentProfile({ unit, profile, api, canEdit, onSaved, onClose, returnFocusRef }) {
  const strategy = profile.strategy, taxonomy = profile.strategyAreas || []
  const stored = strategy.units?.[unit.scopeId]
  const [areaIds, setAreaIds] = useState(stored?.areaIds || [])
  const [objectives, setObjectives] = useState(stored?.objectives || [])
  const [busy, setBusy] = useState(false), [error, setError] = useState('')
  const attempt = useRef(null), added = useRef(null)
  const strategic = taxonomy.filter(area => strategy.areaIds.includes(area.id))
  const others = taxonomy.filter(area => !strategy.areaIds.includes(area.id))
  const chosen = taxonomy.filter(area => areaIds.includes(area.id))
  const outside = chosen.filter(area => !strategy.areaIds.includes(area.id))
  const update = (id, fields) => setObjectives(list => list.map(objective => objective.id === id ? { ...objective, ...fields } : objective))
  const chooseAreas = next => {
    setAreaIds(next)
    setObjectives(list => list.map(objective => ({ ...objective, areaIds: objective.areaIds.filter(id => next.includes(id)) })))
  }
  const toggle = (list, id) => list.includes(id) ? list.filter(item => item !== id) : [...list, id]

  async function submit(event) {
    event.preventDefault()
    if (busy || !canEdit) return
    const body = { areaIds, objectives: objectives.map(objective => ({ ...objective, title: clean(objective.title), target: clean(objective.target) })) }
    if (body.objectives.some(objective => !objective.title)) { setError('Indique o nome de cada objetivo.'); return }
    if (areaIds.length && strategy.areaIds.length && !areaIds.some(id => strategy.areaIds.includes(id))) { setError(failures.STRATEGIC_AREA_REQUIRED); return }
    const signature = JSON.stringify([profile.revision, body])
    // The same content on the same revision repeats the same request.
    if (attempt.current?.signature !== signature) attempt.current = { signature, idempotencyKey: crypto.randomUUID() }
    setBusy(true); setError('')
    try {
      await api.departmentProfileEdit(unit.scopeId, { ...body, expectedRevision: profile.revision, idempotencyKey: attempt.current.idempotencyKey })
      onSaved()
    } catch (failure) {
      const code = failure?.response?.data?.error?.code
      setError(failures[code] || (failure?.response?.status === 403 ? 'Sem permissão para alterar este perfil.' : 'Não foi possível guardar. Repita o mesmo pedido.'))
      setBusy(false)
    }
  }

  return <FormModal title={`Perfil de ${unit.label}`} locked={busy} onClose={onClose} className="strategy-edit-modal" returnFocusRef={returnFocusRef}>
    <div className="strategy-edit-content">
      {error && <p className="notice notice-warn" role="alert">{error}</p>}
      <form className="organization-form" onSubmit={submit}>
        <fieldset className="strategy-fields department-profile" disabled={!canEdit || busy}>
          <legend className="sr-only">Perfil do departamento</legend>
          <fieldset>
            <legend>Áreas de interesse</legend>
            {strategic.length > 0 && <>
              <h4>Áreas estratégicas da entidade</h4>
              <AreaOptions areas={strategic} selected={areaIds} onChange={chooseAreas} />
            </>}
            <details open={outside.length > 0 || !strategic.length}>
              <summary>{strategic.length ? 'Outras áreas' : 'Áreas temáticas'}</summary>
              <AreaOptions areas={others} selected={areaIds} onChange={chooseAreas} />
            </details>
            {outside.length > 0 && <p className="department-outside">Fora da estratégia da entidade: {outside.map(area => area.name).join(', ')}.</p>}
          </fieldset>
          <div className="strategy-objectives">
            {objectives.map((objective, index) => <fieldset key={objective.id} className="strategy-objective">
              <legend>Objetivo {index + 1}</legend>
              <div className="field-grid">
                <label className="dl-full">Objetivo<input autoFocus={added.current === objective.id} required maxLength={256} value={objective.title} onChange={event => update(objective.id, { title: event.target.value })} /></label>
                <label>Meta ou indicador<input maxLength={1000} value={objective.target} onChange={event => update(objective.id, { target: event.target.value })} /></label>
                <label>Prazo<input type="date" max="9999-12-31" value={objective.deadline || ''} onChange={event => update(objective.id, { deadline: event.target.value || null })} /></label>
              </div>
              {chosen.length > 0 && <details>
                <summary>Áreas associadas</summary>
                <AreaOptions areas={chosen} selected={objective.areaIds} onChange={next => update(objective.id, { areaIds: next })} />
              </details>}
              {strategy.objectives.length > 0 ? <details open>
                <summary>Objetivos estratégicos que apoia</summary>
                <div className="area-checkboxes">
                  {strategy.objectives.map(goal => <label key={goal.id} className="checkbox-label">
                    <input type="checkbox" checked={objective.objectiveIds.includes(goal.id)}
                      onChange={() => update(objective.id, { objectiveIds: toggle(objective.objectiveIds, goal.id) })} />{goal.title}
                  </label>)}
                </div>
              </details> : <p className="text-muted">A entidade ainda não definiu objetivos estratégicos.</p>}
              {strategy.objectives.length > 0 && !objective.objectiveIds.length && <p className="department-outside">Sem ligação a objetivo estratégico.</p>}
              {canEdit && <button type="button" className="btn btn-secondary" onClick={() => setObjectives(list => list.filter(item => item.id !== objective.id))}>Remover objetivo</button>}
            </fieldset>)}
            {!objectives.length && !canEdit && <p className="text-muted">Sem objetivos definidos.</p>}
            {canEdit && <button type="button" className="btn btn-outline" disabled={objectives.length >= maxObjectives} onClick={() => {
              const id = crypto.randomUUID()
              added.current = id
              setObjectives(list => [...list, { id, title: '', target: '', deadline: null, areaIds: [], objectiveIds: [] }])
            }}>Adicionar objetivo</button>}
          </div>
        </fieldset>
        {canEdit && <div className="organization-actions">
          <button type="button" className="btn btn-secondary" disabled={busy} onClick={onClose}>Cancelar</button>
          <button type="submit" className="btn btn-primary" disabled={busy}>Guardar perfil</button>
        </div>}
      </form>
    </div>
  </FormModal>
}
