import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { organizationDirectoryApi } from '../../api/api'
import { clearDirectoryCache } from '../Organization/directoryCache'

const maxLinks = 200
const linkedTo = (objective, applicationId) => (objective.applicationIds || []).includes(applicationId)

// The organization's strategic objectives this application supports. The links
// live in the organization strategy, so only who may edit it can change them.
export default function ApplicationObjectives({ applicationId, organizationId }) {
  const api = useMemo(() => organizationDirectoryApi(organizationId), [organizationId])
  const [profile, setProfile] = useState(null), [canEdit, setCanEdit] = useState(false)
  const [selected, setSelected] = useState([]), [refresh, setRefresh] = useState(0)
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState(''), [readFailed, setReadFailed] = useState(false)
  const alive = useRef(false), attempt = useRef(null)
  useEffect(() => { alive.current = true; return () => { alive.current = false } }, [])
  useEffect(() => {
    const controller = new AbortController()
    let active = true
    setReadFailed(false)
    api.context(controller.signal).then(result => {
      if (!active) return
      const strategy = result.data.profile?.strategy
      setProfile(strategy ? result.data.profile : null)
      setCanEdit(Boolean(result.data.permissions?.edit))
      setSelected(strategy ? strategy.objectives.filter(objective => linkedTo(objective, applicationId)).map(objective => objective.id) : [])
    }).catch(failure => {
      if (!active) return
      setProfile(null)
      // Without access to the directory there is nothing to show; other failures can be repeated.
      setReadFailed(![403, 404].includes(failure?.response?.status))
    })
    return () => { active = false; controller.abort() }
  }, [api, applicationId, refresh])

  if (readFailed) return <section className="detail-section application-objectives" aria-label="Objetivos estratégicos">
    <h2>Objetivos estratégicos</h2>
    <p role="alert">Não foi possível carregar os objetivos. <button type="button" className="btn btn-outline btn-sm" onClick={() => setRefresh(value => value + 1)}>Repetir consulta</button></p>
  </section>
  if (!profile) return null
  const objectives = profile.strategy.objectives
  const stored = objectives.filter(objective => linkedTo(objective, applicationId)).map(objective => objective.id)
  if (!canEdit && !stored.length) return null
  const changed = stored.length !== selected.length || stored.some(id => !selected.includes(id))

  async function save(event) {
    event.preventDefault()
    if (busy || !changed) return
    const signature = JSON.stringify([profile.revision, [...selected].sort()])
    // The same selection on the same revision repeats the same request.
    if (attempt.current?.signature !== signature) attempt.current = { signature, idempotencyKey: crypto.randomUUID() }
    const { areaIds, interests } = profile.strategy
    const body = { areaIds, interests, expectedRevision: profile.revision, idempotencyKey: attempt.current.idempotencyKey,
      objectives: objectives.map(({ id, title, target, deadline, areaIds: objectiveAreas, applicationIds = [] }) => ({
        id, title, target, deadline, areaIds: objectiveAreas,
        applicationIds: selected.includes(id) ? [...new Set([...applicationIds, applicationId])] : applicationIds.filter(linked => linked !== applicationId),
      })) }
    setBusy(true); setError(''); setNotice('')
    try {
      const result = (await api.strategyEdit(body)).data
      clearDirectoryCache()
      if (!alive.current) return
      setProfile(previous => ({ ...previous, strategy: result.strategy, revision: result.revision }))
      setNotice('Objetivos guardados.')
    } catch (failure) {
      if (!alive.current) return
      const status = failure?.response?.status
      if (status === 409) { setError('A estratégia da organização mudou. Reveja a seleção e guarde novamente.'); setRefresh(value => value + 1) }
      else setError(status === 403 ? 'Sem permissão para alterar os objetivos.' : 'Não foi possível guardar. Repita o mesmo pedido.')
    } finally { if (alive.current) setBusy(false) }
  }

  return <section className="detail-section application-objectives" aria-label="Objetivos estratégicos">
    <h2>Objetivos estratégicos</h2>
    {!canEdit ? <ul>{objectives.filter(objective => stored.includes(objective.id)).map(objective => <li key={objective.id}>{objective.title}</li>)}</ul>
      : !objectives.length ? <p>A organização ainda não definiu objetivos. <Link to="/perfil-organizacao">Consultar estratégia</Link></p>
      : <form onSubmit={save}>
        <fieldset disabled={busy}>
          <legend>Objetivos da organização que esta candidatura apoia</legend>
          {objectives.map(objective => {
            const checked = selected.includes(objective.id)
            const full = !checked && !linkedTo(objective, applicationId) && (objective.applicationIds || []).length >= maxLinks
            return <label key={objective.id} className="checkbox-label">
              <input type="checkbox" checked={checked} disabled={full} onChange={() => {
                setNotice('')
                setSelected(current => checked ? current.filter(id => id !== objective.id) : [...current, objective.id])
              }} />{objective.title}{full && ' (limite de candidaturas atingido)'}
            </label>
          })}
        </fieldset>
        {error && <p role="alert">{error}</p>}
        {notice && <p role="status">{notice}</p>}
        <button type="submit" className="btn btn-outline" disabled={busy || !changed}>Guardar objetivos</button>
      </form>}
  </section>
}
