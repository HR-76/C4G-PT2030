import { useEffect, useRef, useState } from 'react'
import { privateApplicationsApi as api } from '../../api/api'

export default function useTaskSelection({ applicationId, userId, organizationId, filter, work, onAuthority, onDenied }) {
  const [result, setResult] = useState(null)
  const [error, setError] = useState(false)
  const [loading, setLoading] = useState(false)
  const [retry, setRetry] = useState(0)
  const generation = useRef(0), pending = useRef(false)
  const handlers = useRef({ onAuthority, onDenied })
  handlers.current = { onAuthority, onDenied }
  const key = JSON.stringify([applicationId, userId, organizationId, filter, work?.revision])
  const currentKey = useRef(key)
  currentKey.current = key
  useEffect(() => {
    const epoch = ++generation.current
    const controller = new AbortController()
    let active = true
    pending.current = false
    setResult(null); setError(false)
    if (filter === 'all' || !work) { setLoading(false); return }
    setLoading(true)
    api.work(applicationId, { taskFilter: filter }, controller.signal).then(({ data }) => {
      if (!active || epoch !== generation.current || currentKey.current !== key) return
      handlers.current.onAuthority(data)
      setResult({ key, data })
    }).catch(reason => {
      if (!active || epoch !== generation.current || currentKey.current !== key) return
      setError(true)
      if ([401, 403, 404].includes(reason.response?.status)) handlers.current.onDenied(reason)
    }).finally(() => { if (active && epoch === generation.current) setLoading(false) })
    return () => { active = false; controller.abort(); generation.current += 1 }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- Runs only when the listed keys change; applicationId, filter, work are read at that moment.
  }, [key, retry])

  const data = result?.key === key ? result.data : null
  async function loadMore() {
    if (pending.current || !data?.taskNextCursor || loading) return
    const epoch = generation.current
    pending.current = true; setLoading(true); setError(false)
    try {
      const response = await api.work(applicationId, { taskFilter: filter, taskCursor: data.taskNextCursor })
      if (epoch !== generation.current || currentKey.current !== key) return
      handlers.current.onAuthority(response.data)
      setResult(previous => ({ key, data: { ...response.data,
        members: [...(previous.data.members || []), ...(response.data.members || [])],
        tasks: [...previous.data.tasks, ...response.data.tasks.filter(task => !previous.data.tasks.some(old => old.taskId === task.taskId))],
      } }))
    } catch (reason) {
      if (epoch !== generation.current || currentKey.current !== key) return
      setError(true)
      if ([401, 403, 404].includes(reason.response?.status)) handlers.current.onDenied(reason)
    } finally {
      if (epoch === generation.current && currentKey.current === key) { pending.current = false; setLoading(false) }
    }
  }
  return { data, loading: filter !== 'all' && (loading || (!data && !error)), error, loadMore, retry: () => setRetry(value => value + 1) }
}
