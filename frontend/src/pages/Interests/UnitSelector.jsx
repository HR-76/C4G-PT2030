import './interests.css'
export function unitLabel(unit, units = []) {
  if (unit.path) return Array.isArray(unit.path) ? unit.path.join(' › ') : unit.path
  const labels = [unit.label], seen = new Set([unit.unitId]); let parent = units.find(row => row.unitId === unit.parentUnitId)
  while (parent && !seen.has(parent.unitId)) { seen.add(parent.unitId); labels.unshift(parent.label); parent = units.find(row => row.unitId === parent.parentUnitId) }
  return labels.join(' › ')
}
export default function UnitSelector({ units = [], selectedIds = [], onChange, disabled = false, label = 'Departamentos / Unidades', emptyLabel = 'Sem unidade atribuída' }) {
  const unavailable = selectedIds.filter(id => !units.some(unit => unit.unitId === id))
  return <fieldset className="interest-units" disabled={disabled}><legend>{label}</legend>
    {!selectedIds.length && emptyLabel && <p className="text-muted">{emptyLabel}</p>}
    {units.map(unit => { const selected = selectedIds.includes(unit.unitId), archived = unit.lifecycle !== 'ACTIVE'
      return <label key={unit.unitId}><input type="checkbox" checked={selected} disabled={!selected && (archived || selectedIds.length >= 50)} onChange={event => onChange(event.target.checked ? [...selectedIds, unit.unitId] : selectedIds.filter(id => id !== unit.unitId))}/>{unitLabel(unit, units)}{archived ? ' (arquivada)' : ''}</label>
    })}
    {unavailable.map(id => <label key={id}><input type="checkbox" checked onChange={() => onChange(selectedIds.filter(value => value !== id))}/>Unidade associada indisponível</label>)}
    {selectedIds.length >= 50 && <p>Máximo de 50 unidades.</p>}
  </fieldset>
}
