import { useEffect, useRef, useState } from 'react'
import { dashboardApi } from '../api/api'
import { readScope, startConfirmedRead } from '../api/confirmedReads'

export default function useOrganizationDashboard({ organizationId, userId }) {
  // Indicators this user and organization already received are shown at once
  // and read again on every entry.
  const scope = organizationId && userId ? readScope(userId, organizationId) : null
  const [dashboard, setDashboard] = useState(() => startConfirmedRead(scope, 'dashboard').held)
  const [loading, setLoading] = useState(!dashboard)
  const [error, setError] = useState('')
  const [retry, setRetry] = useState(0)
  const [exporting, setExporting] = useState(false)
  const [exportError, setExportError] = useState('')
  const generation = useRef(0)
  const refreshed = useRef(0)

  useEffect(() => {
    const current = ++generation.current
    const controller = new AbortController()
    let active = true
    const isCurrent = () => active && !controller.signal.aborted && generation.current === current
    // An explicit refresh waits for the server and shows nothing meanwhile.
    const read = startConfirmedRead(scope, 'dashboard'), held = refreshed.current === retry ? read.held : null
    refreshed.current = retry
    setLoading(!held); setError(''); setExporting(false); setExportError(''); setDashboard(held)
    if (organizationId) {
      dashboardApi.organization({ organizationId, isCurrent, signal: controller.signal })
        .then(response => { read.keep(response.data); if (isCurrent()) setDashboard(response.data) })
        .catch(() => { if (isCurrent()) { read.drop(); setDashboard(null) } if (isCurrent()) setError('Não foi possível consultar todos os indicadores autorizados. Tente novamente.') })
        .finally(() => { if (isCurrent()) setLoading(false) })
    }
    return () => { active = false; generation.current += 1; controller.abort() }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- Runs only when the listed keys change; scope is read at that moment.
  }, [organizationId, userId, retry])

  async function exportReport() {
    if (exporting || !dashboard) return
    const current = generation.current
    setExporting(true); setExportError('')
    try {
      const response = await dashboardApi.organizationReport({ organizationId, digest: dashboard.report.digest })
      if (generation.current !== current) return
      const url = URL.createObjectURL(response.data), link = document.createElement('a')
      link.href = url; link.download = 'relatorio-candidaturas-c4g.xlsx'; document.body.appendChild(link); link.click(); link.remove(); URL.revokeObjectURL(url)
    } catch (err) {
      if (generation.current === current) {
        if (err.response?.status === 429) setExportError('Há exportações em curso. Tente novamente dentro de momentos.')
        else if (err.response?.status === 409) setExportError('Os dados mudaram. Atualize os indicadores antes de exportar.')
        else setExportError('Não foi possível exportar com o acesso atual.')
      }
    } finally { if (generation.current === current) setExporting(false) }
  }

  return { dashboard, loading, error, exporting, exportError, refresh: () => setRetry(value => value + 1), exportReport }
}
