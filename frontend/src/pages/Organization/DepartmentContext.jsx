const date = value => value.split('-').reverse().join('/')

export const departmentsWithProfile = departments => (departments || []).filter(department => department.areaIds.length || department.objectives.length)

// What a person's departments set out to do, as read with the personal profile.
// `areas` is the thematic taxonomy used to name the departments' areas.
export default function DepartmentContext({ departments, areas = [] }) {
  const names = new Map(areas.map(area => [area.id, area.name]))
  return <ul className="department-context">
    {departmentsWithProfile(departments).map(department => {
      const interests = department.areaIds.map(id => names.get(id)).filter(Boolean)
      return <li key={department.scopeId}>
        <strong>{department.label}{department.isPrimary ? ' · Principal' : ''}</strong>
        {interests.length > 0 && <p className="department-context-areas">Áreas de interesse: {interests.join(', ')}</p>}
        {department.objectives.length ? <ul>{department.objectives.map(objective => <li key={objective.id}>
          <span>{objective.title}</span>
          <small>
            {[objective.target && `Meta: ${objective.target}`, objective.deadline && `Prazo: ${date(objective.deadline)}`,
              objective.strategicObjectives.length ? `Contribui para: ${objective.strategicObjectives.map(goal => goal.title).join(', ')}` : 'Sem ligação a objetivo estratégico'].filter(Boolean).join(' · ')}
          </small>
        </li>)}</ul> : <p className="text-muted">Sem objetivos definidos.</p>}
      </li>
    })}
  </ul>
}
