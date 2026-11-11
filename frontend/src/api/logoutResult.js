const key = 'c4g.logout-result.v1'
const lifetime = 10 * 60 * 1000

export function clearLogoutResult() {
  try { sessionStorage.removeItem(key) } catch { /* Storage must not block authentication. */ }
}

export function saveLogoutResult(status) {
  try { sessionStorage.setItem(key, JSON.stringify({ status, at: Date.now() })) } catch { /* Continue federated logout. */ }
}

export function readLogoutResult() {
  try {
    const result = JSON.parse(sessionStorage.getItem(key))
    if (!result || !['complete', 'incomplete'].includes(result.status) || !Number.isFinite(result.at)
      || Date.now() - result.at < 0 || Date.now() - result.at > lifetime) return null
    return result.status
  } catch { return null }
}

export function logoutPageState(pathname, search = '') {
  if (!['/', '/login', '/saida'].includes(pathname)) return null
  if (new URLSearchParams(search).get('logout') === 'incomplete') return 'incomplete'
  return readLogoutResult() || (pathname === '/saida' ? 'unknown' : null)
}
