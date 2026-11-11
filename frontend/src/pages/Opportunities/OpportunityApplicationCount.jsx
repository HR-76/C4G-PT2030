import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { privateApplicationsApi } from '../../api/api'

export default function OpportunityApplicationCount({ organizationId, opportunityId }) {
  if (!organizationId) return <span>Sem organização ativa</span>
  return <Count key={`${organizationId}:${opportunityId}`} opportunityId={opportunityId} />
}
function Count({ opportunityId }) {
  const [count, setCount] = useState(null), [failed, setFailed] = useState(false), [retry, setRetry] = useState(0)
  useEffect(() => {
    let active = true
    const controller = new AbortController()
    setCount(null); setFailed(false)
    privateApplicationsApi.opportunitySummaries([opportunityId], controller.signal).then(({ data }) => {
      const item = data?.items?.[0]
      if (data?.items?.length !== 1 || item?.opportunityId !== opportunityId || !Number.isSafeInteger(item.count) || item.count < 0) throw new Error('Incomplete summary')
      if (active) setCount(item.count)
    }).catch(error => { if (active && error?.code !== 'ERR_CANCELED') setFailed(true) })
    return () => { active = false; controller.abort() }
  }, [opportunityId, retry])
  if (failed) return <><span>Indisponível</span><button className="btn btn-outline btn-sm" onClick={() => setRetry(value => value + 1)}>Repetir contagem</button></>
  return count === null ? <span>A consultar…</span> : <Link to={`/candidaturas?oportunidade=${opportunityId}`} aria-label={`${count} candidaturas acessíveis nesta organização`}>{count}</Link>
}
