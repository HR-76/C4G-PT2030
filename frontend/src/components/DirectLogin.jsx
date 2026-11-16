import { useEffect, useRef, useState } from 'react'
import LoadingIndicator from './LoadingIndicator'

const navigate = destination => window.location.replace(destination)

const EXPIRED_RETRY_KEY = 'c4g.login.expiredRetryAt'
const EXPIRED_RETRY_WINDOW_MS = 120000

// An expired attempt reopens the login by itself, but only once per window: a browser that cannot keep the
// session cookie would otherwise bounce between the login and the callback forever.
function claimExpiredRetry() {
  try {
    const now = Date.now()
    const last = Number(window.sessionStorage.getItem(EXPIRED_RETRY_KEY))
    if (last > 0 && now - last < EXPIRED_RETRY_WINDOW_MS) return false
    window.sessionStorage.setItem(EXPIRED_RETRY_KEY, String(now))
    return true
  } catch {
    return false
  }
}

// AppRoutes renders this only after confirming there is no application session.
export default function DirectLogin({ openLogin = navigate, returnTo = '/' }) {
  const safeReturn = typeof returnTo === 'string' && returnTo.startsWith('/') && !returnTo.startsWith('//') && !/[\\\x00-\x20]/.test(returnTo) ? returnTo : '/'
  const destination = `/api/auth/oidc/login?returnTo=${encodeURIComponent(safeReturn)}`
  const started = useRef(false)
  const [failed, setFailed] = useState(false)
  const [expiredAgain, setExpiredAgain] = useState(false)
  const authentication = new URLSearchParams(window.location.search).get('authentication')
  const cancelled = authentication === 'cancelled'
  const expired = authentication === 'expired'
  useEffect(() => {
    if (started.current || cancelled) return
    started.current = true
    if (expired && !claimExpiredRetry()) { setExpiredAgain(true); return }
    try { openLogin(destination) } catch { setFailed(true) }
  }, [openLogin, destination, cancelled, expired])
  // While the browser is being sent to the login, the shared loader continues the one AppRoutes showed for the session check.
  if (!cancelled && !expiredAgain && !failed) return <LoadingIndicator className="page-loading">A abrir o login C4G…</LoadingIndicator>
  const retry = label => <p><a className="btn btn-primary" href={destination}>{label}</a></p>
  return <div className="page-loading direct-login-message">
    {cancelled ? <><p role="status">Autenticação cancelada. Não foi iniciada uma nova sessão.</p>{retry('Voltar a entrar')}</>
      : expiredAgain ? <><p role="status">Esta tentativa de autenticação terminou.</p>{retry('Voltar a entrar')}</>
      : <><p role="alert">Não foi possível abrir o login.</p>{retry('Tentar novamente')}</>}
  </div>
}
