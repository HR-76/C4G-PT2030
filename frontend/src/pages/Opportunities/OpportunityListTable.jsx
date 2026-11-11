import { useEffect, useState } from 'react'
import { privateApplicationsApi as api } from '../../api/api'
import { OpportunityTable } from './OpportunityPresentation'
import { parseApplicationSummaries } from './applicationSummaries'

export default function OpportunityListTable(props) {
  if (props.interestOnly) return <OpportunityTable {...props} showApplications={Boolean(props.organizationId)} />
  if (!props.organizationId) return <OpportunityTable {...props} showApplications={false} />
  return <OrganizationTable key={`${props.organizationId}:${props.items.map(item => item.opportunityId).join(',')}`} {...props} />
}
function OrganizationTable({ organizationId, items, ...props }) {
  const [summaries, setSummaries] = useState({}), [state, setState] = useState('loading'), [retry, setRetry] = useState(0)
  const ids = items.map(item => item.opportunityId).join(',')
  useEffect(() => {
    let active = true
    const controller = new AbortController()
    setState('loading'); setSummaries({})
    if (!organizationId || !ids) { setState('error'); return }
    api.opportunitySummaries(ids.split(','), controller.signal).then(({ data }) => {
      if (!active) return
      setSummaries(parseApplicationSummaries(data, ids.split(','))); setState('ready')
    }).catch(() => { if (active) setState('error') })
    return () => { active = false; controller.abort() }
  }, [organizationId, ids, retry])
  return <>
    <span className="sr-only">Candidaturas da organização ativa a que tem acesso.</span>
    {state === 'error' && <p role="alert">Não foi possível consultar candidaturas ou não tem permissão. <button className="btn btn-outline btn-sm" onClick={() => setRetry(value => value + 1)}>Repetir consulta de candidaturas</button></p>}
    <OpportunityTable {...props} items={items} summaries={summaries} summaryState={state} />
  </>
}
