import { clearLogoutResult, saveLogoutResult } from '../api/logoutResult'
import { createContext, useContext, useState, useEffect, useRef } from 'react'
import { authApi, clearCsrfToken } from '../api/api'
import { clearEditorialIntentions } from '../pages/Editorial/intentions'
import { clearInterestIntentions } from '../pages/Interests/intentions'
import { clearApplicationIntentions } from '../pages/Applications/intentions'
import { clearDirectoryIntentions } from '../pages/Organization/intentions'
import { clearConfirmedReads } from '../api/confirmedReads'
import { beginLogoutNavigation, cancelLogoutNavigation } from '../api/logoutNavigation'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const sessionGeneration = useRef(0)
  const [user, setUser]       = useState(null)
  const [loading, setLoading] = useState(true)
  const [loggingOut, setLoggingOut] = useState(false)
  const [organization, setOrganization] = useState(null)
  const [admissions, setAdmissions] = useState(null)
  const [sessionError, setSessionError] = useState(false)
  const [sessionAttempt, setSessionAttempt] = useState(0)
  const applySession = data => {
    if (data.user) clearLogoutResult()
    setUser(data.user)
    setOrganization(data.organization || null)
    setAdmissions(data.admissions || null)
  }

  useEffect(() => {
    let active = true
    const controller = new AbortController()
    const generation = sessionGeneration.current
    setLoading(true)
    setSessionError(false)
    authApi.me({ signal: controller.signal })
      .then(response => { if (active && generation === sessionGeneration.current) applySession(response.data) })
      .catch(error => {
        if (!active || generation !== sessionGeneration.current) return
        setUser(null); setOrganization(null); setAdmissions(null)
        setSessionError(error.response?.status !== 401)
      })
      .finally(() => { if (active && generation === sessionGeneration.current) setLoading(false) })
    return () => { active = false; controller.abort() }
  }, [sessionAttempt])

  const login = (returnTo = '/') => {
    authApi.login(returnTo)
  }

  const selectOrganization = async organizationId => {
    const generation = ++sessionGeneration.current
    setOrganization(null)
    // The confirmed POST is the authority; no dependent session GET can undo it.
    const response = await authApi.selectOrganization(organizationId)
    if (generation !== sessionGeneration.current) throw new Error('Contexto de sessão alterado.')
    applySession(response.data)
    if (!response.data.organization) throw new Error('A organização não ficou ativa.')
  }

  const logout = async () => {
    clearLogoutResult()
    beginLogoutNavigation()
    setLoggingOut(true)
    sessionGeneration.current++
    clearEditorialIntentions()
    clearInterestIntentions()
    clearDirectoryIntentions()
    clearConfirmedReads()
    try {
      const response = await authApi.logout()
      clearApplicationIntentions()
      sessionGeneration.current++
      clearCsrfToken()
      setUser(null)
      saveLogoutResult(response.data.identityLogoutUnavailable ? 'incomplete' : 'complete')
      window.location.assign(response.data.redirectUrl || '/saida')
    } catch (error) {
      sessionGeneration.current++
      if (error.response?.status === 503 && error.response?.data?.code === 'LOGOUT_INCOMPLETE') {
        clearApplicationIntentions()
        clearCsrfToken()
        setUser(null)
        saveLogoutResult('incomplete')
        window.location.assign(error.response.data.redirectUrl || '/saida?logout=incomplete')
        return
      }
      cancelLogoutNavigation()
      setLoggingOut(false)
      throw error
    }
  }

  const isAdmin = user?.role === 'ADMIN' || user?.platformRoles?.includes('C4G_ADMIN')
  const refreshSession = async (config) => {
    const generation = sessionGeneration.current
    const response = await authApi.me(config)
    if (generation !== sessionGeneration.current) throw new Error('Contexto de sessão alterado.')
    applySession(response.data)
    return response.data
  }

  return (
    <AuthContext.Provider value={{ user, login, logout, loading: loading || loggingOut, isAdmin,
      organization, admissions, selectOrganization, refreshSession }}>
      {sessionError ? <main className="page-loading"><div role="alert" className="alert alert-error">
        <p>Não foi possível verificar a sessão. Tente novamente.</p>
        <button className="btn btn-outline" onClick={() => { setLoading(true); setSessionError(false); setSessionAttempt(value => value + 1) }}>Tentar novamente</button>
      </div></main> : children}
    </AuthContext.Provider>
  )
}

export const useAuth = () => useContext(AuthContext)
