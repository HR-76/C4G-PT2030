import { useEffect, useState } from 'react'
import { sharedDirectoryRead } from './directoryCache'

// How the departments answer the entity strategy: who contributes to each strategic
// objective, which department objectives are not linked yet and which areas the
// departments chose that the entity does not have. Archived departments are left out.
export default function DepartmentContributions({ strategy, areas, api, cacheKey, onAdopt }) {
  const [units, setUnits] = useState(null)
  const hasProfiles = Object.keys(strategy.units || {}).length > 0
  useEffect(() => {
    if (!hasProfiles) return
    let active = true
    sharedDirectoryRead(cacheKey, 'units', () => api.units()).then(result => { if (active) setUnits(result.data.items) }, () => { if (active) setUnits(null) })
    return () => { active = false }
  }, [api, cacheKey, hasProfiles])
  if (!hasProfiles || !units) return null
  const departments = units.filter(unit => unit.lifecycle === 'ACTIVE' && strategy.units[unit.scopeId])
    .map(unit => ({ ...strategy.units[unit.scopeId], label: unit.label, scopeId: unit.scopeId }))
    .filter(department => department.areaIds.length || department.objectives.length)
    .sort((a, b) => a.label.localeCompare(b.label, 'pt'))
  if (!departments.length) return null
  const contributions = departments.flatMap(department => department.objectives.map(objective => ({ ...objective, department: department.label, key: department.scopeId + objective.id })))
  const unlinked = contributions.filter(item => !item.objectiveIds.length)
  const proposed = areas.filter(area => !strategy.areaIds.includes(area.id))
    .map(area => ({ ...area, departments: departments.filter(department => department.areaIds.includes(area.id)).map(department => department.label) }))
    .filter(area => area.departments.length)
  const line = item => <li key={item.key}><strong>{item.department}</strong> · {item.title}{item.target && <small> · Meta: {item.target}</small>}</li>

  return <section className="detail-section organization-card department-contributions" aria-label="Contributos dos departamentos">
    <h3>Contributos dos departamentos</h3>
    {strategy.objectives.length > 0 && <ul className="strategy-objectives strategy-objective-list">
      {strategy.objectives.map(goal => {
        const supporting = contributions.filter(item => item.objectiveIds.includes(goal.id))
        return <li key={goal.id} className="strategy-objective">
          <strong>{goal.title}</strong>
          {supporting.length ? <ul>{supporting.map(line)}</ul> : <p className="text-muted">Sem contributos de departamentos.</p>}
        </li>
      })}
    </ul>}
    {unlinked.length > 0 && <>
      <h4>Objetivos de departamento sem ligação a objetivo estratégico</h4>
      <ul>{unlinked.map(line)}</ul>
    </>}
    {proposed.length > 0 && <>
      <h4>Áreas escolhidas por departamentos fora da estratégia</h4>
      <ul className="department-proposed">{proposed.map(area => <li key={area.id}>
        <span><strong>{area.name}</strong> · {area.departments.join(', ')}</span>
        {onAdopt && strategy.areaIds.length < 30 && <button type="button" className="btn btn-outline btn-sm" aria-label={`Adotar ${area.name} como área estratégica`} onClick={() => onAdopt(area.id)}>Adotar como estratégica</button>}
      </li>)}</ul>
    </>}
  </section>
}
