import { useEffect, useRef, useState } from 'react'

const navigate = destination => window.location.replace(destination)

// AppRoutes renders this only after confirming there is no application session.
export default function DirectLogin({ openLogin = navigate, returnTo = '/' }) {
  const safeReturn = typeof returnTo === 'string' && returnTo.startsWith('/') && !returnTo.startsWith('//') && !/[\\\x00-\x20]/.test(returnTo) ? returnTo : '/'
  const destination = `/api/auth/oidc/login?returnTo=${encodeURIComponent(safeReturn)}`
  const started = useRef(false)
  const [failed, setFailed] = useState(false)
  const authentication = new URLSearchParams(window.location.search).get('authentication')
  const cancelled = authentication === 'cancelled'
  const expired = authentication === 'expired'
  useEffect(() => {
    if (started.current || cancelled || expired) return
    started.current = true
    try { openLogin(destination) } catch { setFailed(true) }
  }, [openLogin, destination, cancelled, expired])
  return <div className="page-loading">
    {cancelled ? <p role="status">Autenticação cancelada. Não foi iniciada uma nova sessão. <a href={destination}>Voltar a entrar</a></p>
      : expired ? <p role="status">Esta tentativa de autenticação terminou. <a href={destination}>Voltar a entrar</a></p>
      : failed ? <p role="alert">Não foi possível abrir o login. <a href={destination}>Tentar novamente</a></p>
      : <p role="status">A abrir o login C4G…</p>}
  </div>
}
