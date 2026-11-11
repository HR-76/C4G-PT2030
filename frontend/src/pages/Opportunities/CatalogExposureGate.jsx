import React, { useEffect, useState } from 'react'
import { catalogReadApi } from '../../api/api'
import { clearCatalogSessions } from './catalogReadSession'

// Availability gates both isolated and connected entry points; the server
// remains authoritative for every API read.
export default function CatalogExposureGate({ scope, children, api = catalogReadApi, quiet = false }) {
  const [state, setState] = useState({ available: false, revision: null, checking: true, scope })
  const [retry, setRetry] = useState(0)
  useEffect(() => {
    let disposed = false, serial = 0, controller, expiry, poll, revision = null
    clearCatalogSessions(403, scope)
    setState({ available: false, revision: null, checking: true, scope })
    const hide = () => {
      clearTimeout(expiry)
      clearCatalogSessions(403, scope)
      setState({ available: false, revision: null, checking: false, scope })
    }
    async function check() {
      const mine = ++serial
      controller?.abort()
      controller = new AbortController()
      try {
        const response = await api('/availability', {}, controller.signal)
        if (disposed || mine !== serial) return
        const ttl = Math.min(30000, Date.parse(response?.validUntil) - Date.now())
        if (response?.version !== 'gcni-catalog-exposure/1.0' || response.available !== true || !Number.isSafeInteger(response.revision) || !Number.isFinite(ttl) || ttl <= 0) {
          hide()
          return
        }
        if (revision !== response.revision) clearCatalogSessions(403, scope)
        revision = response.revision
        const confirmedRevision = revision
        clearTimeout(expiry)
        expiry = setTimeout(hide, ttl)
        setState(previous => previous.available && previous.revision === confirmedRevision && !previous.checking && previous.scope === scope
          ? previous : { available: true, revision: confirmedRevision, checking: false, scope })
      } catch {
        if (!disposed && mine === serial) hide()
      }
    }
    const visible = () => { if (document.visibilityState === 'visible') { hide(); check() } }
    check()
    poll = setInterval(check, 15000)
    document.addEventListener('visibilitychange', visible)
    return () => {
      disposed = true
      serial++
      controller?.abort()
      clearTimeout(expiry)
      clearInterval(poll)
      clearCatalogSessions(403, scope)
      document.removeEventListener('visibilitychange', visible)
    }
  }, [scope, retry, api])
  if (state.scope !== scope || state.checking) return quiet ? null : <p role="status">A verificar disponibilidade do catálogo…</p>
  if (!state.available) return quiet ? null : <section role="alert"><h1>Catálogo temporariamente indisponível</h1><button type="button" onClick={() => setRetry(x => x + 1)}>Voltar a verificar</button></section>
  return <React.Fragment key={`${scope}:${state.revision}`}>{children}</React.Fragment>
}
