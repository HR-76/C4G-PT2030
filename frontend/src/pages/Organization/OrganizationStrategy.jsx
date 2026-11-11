import { useId, useRef } from 'react'

function toggleArea(selected, id) {
  return selected.includes(id) ? selected.filter(area => area !== id) : [...selected, id]
}

export function AreaNames({ areas, ids = [], asList = false }) {
  const selected = areas.filter(area => ids.includes(area.id))
  if (!selected.length) return <span className="text-muted">Por indicar</span>
  return asList ? <ul>{selected.map(area => <li key={area.id}>{area.name}</li>)}</ul> : selected.map(area => area.name).join(', ')
}

export function AreaOptions({ areas, selected, onChange }) {
  return <div className="area-checkboxes">
    {areas.map(({ id, name }) => <label key={id} className="checkbox-label">
      <input type="checkbox" checked={selected.includes(id)} disabled={selected.length >= 30 && !selected.includes(id)}
        onChange={() => onChange(toggleArea(selected, id))} />{name}
    </label>)}
  </div>
}

export function StrategyFields({ values, areas, onChange }) {
  const interestId = useId()
  const addedObjectiveId = useRef(null)
  const selectedAreas = areas.filter(area => values.areaIds.includes(area.id))
  const updateObjective = (id, fields) => onChange({
    objectives: values.objectives.map(objective => objective.id === id ? { ...objective, ...fields } : objective),
  })

  return <div className="strategy-fields">
    <fieldset>
      <legend>Áreas estratégicas</legend>
      <AreaOptions areas={areas} selected={values.areaIds} onChange={areaIds => onChange({
        areaIds,
        objectives: values.objectives.map(objective => ({
          ...objective,
          areaIds: objective.areaIds.filter(id => areaIds.includes(id)),
        })),
      })} />
    </fieldset>
    <div className="strategy-interests">
      <label htmlFor={interestId}>Interesses institucionais</label>
      <textarea id={interestId} aria-describedby={`${interestId}-hint`} rows={3} maxLength={7710} value={values.interestText}
        onChange={event => onChange({ interestText: event.target.value })} />
      <small id={`${interestId}-hint`}>Indique um interesse por linha, até 30 interesses.</small>
    </div>
    <div className="strategy-objectives">
      {values.objectives.map((objective, index) => <fieldset key={objective.id} className="strategy-objective">
        <legend>Objetivo {index + 1}</legend>
        <div className="field-grid">
          <label className="dl-full">Objetivo<input autoFocus={addedObjectiveId.current === objective.id} required maxLength={256} value={objective.title} onChange={event => updateObjective(objective.id, { title: event.target.value })} /></label>
          <label>Meta ou indicador<input maxLength={1000} value={objective.target} onChange={event => updateObjective(objective.id, { target: event.target.value })} /></label>
          <label>Prazo<input type="date" max="9999-12-31" value={objective.deadline || ''} onChange={event => updateObjective(objective.id, { deadline: event.target.value || null })} /></label>
        </div>
        {selectedAreas.length > 0 && <details>
          <summary>Áreas associadas</summary>
          <AreaOptions areas={selectedAreas} selected={objective.areaIds} onChange={areaIds => updateObjective(objective.id, { areaIds })} />
        </details>}
        <button type="button" className="btn btn-secondary" onClick={() => onChange({ objectives: values.objectives.filter(item => item.id !== objective.id) })}>Remover objetivo</button>
      </fieldset>)}
      <button type="button" className="btn btn-outline" disabled={values.objectives.length >= 30} onClick={() => {
        const id = crypto.randomUUID()
        addedObjectiveId.current = id
        onChange({ objectives: [...values.objectives, { id, title: '', target: '', deadline: null, areaIds: [] }] })
      }}>Adicionar objetivo</button>
    </div>
  </div>
}

export default function OrganizationStrategy({ strategy, areas, onEdit, editTriggerRef }) {
  return <section className="detail-section organization-card organization-strategy">
    <div className="organization-heading">
      <h3>Estratégia da organização</h3>
      {onEdit && <button type="button" className="btn btn-outline" ref={editTriggerRef} aria-haspopup="dialog" onClick={onEdit}>Editar estratégia</button>}
    </div>
    <dl className="dl-list strategy-summary">
      <div className="dl-row"><dt>Áreas estratégicas</dt><dd><AreaNames areas={areas} ids={strategy.areaIds} /></dd></div>
      <div className="dl-row"><dt>Interesses institucionais</dt><dd>{strategy.interests.length ? <ul>
        {strategy.interests.map(interest => <li key={interest}>{interest}</li>)}
      </ul> : 'Por indicar'}</dd></div>
    </dl>
    <h4>Objetivos estratégicos</h4>
    {strategy.objectives.length ? <ul className="strategy-objectives strategy-objective-list">
      {strategy.objectives.map(objective => <li key={objective.id} className="strategy-objective">
        <strong>{objective.title}</strong>
        {objective.target && <p>Meta ou indicador · {objective.target}</p>}
        {objective.deadline && <p>Prazo · <time dateTime={objective.deadline}>{objective.deadline.split('-').reverse().join('/')}</time></p>}
        {objective.areaIds.length > 0 && <p><AreaNames areas={areas} ids={objective.areaIds} /></p>}
      </li>)}
    </ul> : <p className="text-muted">Por indicar</p>}
  </section>
}

