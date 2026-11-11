import LoadingIndicator from '../components/LoadingIndicator'
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ShieldCheck, KeyRound, Mail, ArrowLeft } from 'lucide-react'
import { authApi } from '../api/api'
import './AccountSecurity.css'

function SecurityMethod({ name, icon: Icon, iconTone, state, tone = 'neutral', announce = false, children, action }) {
  return <section className="account-security-row" aria-label={name}>
    <span className="account-security-icon" data-icon-tone={iconTone}><Icon size={23} aria-hidden="true"/></span>
    <div className="account-security-method"><div className="account-security-method-heading"><h2>{name}</h2>
      <span className="security-method-state" data-tone={tone} role={announce ? 'status' : undefined}>{state}</span></div>{children}</div>
    <div className="account-security-method-action">{action}</div>
  </section>
}

export default function AccountSecurity({ showProfile = false }) {
  const [settings, setSettings] = useState(null)
  const [error, setError] = useState(false)
  const [revision, setRevision] = useState(0)
  const [busy, setBusy] = useState(false)
  const [actionError, setActionError] = useState(false)
  const email = settings?.emailVerification
  const confirmedEmail = email?.available === true && typeof email.enabled === 'boolean'
  const cancelled = new URLSearchParams(window.location.search).get('verification') === 'cancelled'
  async function changeVerification() {
    if (busy || !confirmedEmail) return
    setBusy(true); setActionError(false)
    try {
      const { data } = await authApi.emailVerification(settings.emailVerification.enabled ? 'disable' : 'enable')
      window.location.assign(data.redirectUrl)
    } catch { setActionError(true); setBusy(false) }
  }
  useEffect(() => {
    let current = true
    setSettings(null); setError(false)
    authApi.accountSecurity().then(({ data }) => { if (current) setSettings(data) })
      .catch(e => { if (current) setError(e.response?.data?.code || 'UNAVAILABLE') })
    return () => { current = false }
  }, [revision])
  return <div className="page account-security">
    <header className="account-security-heading"><div><p>A minha conta</p><h1>Segurança da conta</h1></div>
      {showProfile && <Link className="btn btn-secondary" to="/perfil"><ArrowLeft size={16} aria-hidden="true"/>Voltar ao perfil pessoal</Link>}
    </header>
    {cancelled && <p role="status">Operação cancelada. O estado apresentado é confirmado no fornecedor de identidade.</p>}
    {error ? <div className="account-security-error" role="alert"><p>{error === 'ACCOUNT_REAUTH_REQUIRED' ? 'Volte a autenticar-se para consultar as definições de segurança.' : 'Não foi possível carregar as definições.'}</p>{error === 'ACCOUNT_REAUTH_REQUIRED'
      ? <a className="btn btn-outline" href="/api/auth/oidc/login?returnTo=%2Fconta%2Fseguranca">Confirmar sessão</a>
      : <button className="btn btn-outline" onClick={()=>setRevision(n=>n+1)}>Tentar novamente</button>}</div>
      : !settings ? <LoadingIndicator className="account-security-loading">A carregar definições…</LoadingIndicator>
      : <div className="account-security-layout">
        <section className="account-security-panel" aria-label="Definições de acesso">
          <SecurityMethod name="Palavra-passe" icon={KeyRound} iconTone="amber" state="Consultar no fornecedor"
            action={<a className="btn btn-outline" href="/api/auth/account">Gerir palavra-passe</a>}>
            <p>A configuração da palavra-passe é consultada e gerida no fornecedor de identidade.</p>
          </SecurityMethod>
          <SecurityMethod name="Aplicação autenticadora" icon={ShieldCheck} iconTone="blue" state="Consultar no fornecedor"
            action={<a className="btn btn-outline" href="/api/auth/account">Gerir aplicação autenticadora</a>}>
            <p>Consulte ou configure os códigos da aplicação autenticadora no fornecedor de identidade.</p>
          </SecurityMethod>
          <SecurityMethod name="Verificação adicional por email" icon={Mail} iconTone="violet" announce={confirmedEmail}
            state={confirmedEmail ? (email.enabled ? 'Ativa' : 'Desativada') : email?.reauthenticationRequired ? 'Confirmar sessão' : 'Indisponível'}
            tone={confirmedEmail ? (email.enabled ? 'success' : 'neutral') : 'warning'}
            action={confirmedEmail ? <button className={email.enabled ? 'btn btn-outline' : 'btn btn-primary'} data-action={email.enabled ? 'disable' : 'enable'} disabled={busy} onClick={changeVerification}>
              {busy ? 'A encaminhar…' : email.enabled ? 'Desativar verificação por email' : 'Ativar verificação por email'}</button>
              : email?.reauthenticationRequired ? <a className="btn btn-outline" href="/api/auth/oidc/login?returnTo=%2Fconta%2Fseguranca">Confirmar sessão</a>
              : <button className="btn btn-outline" disabled aria-describedby="email-verification-unavailable">Ativar verificação por email</button>}>
            {confirmedEmail ? <p>Estado confirmado pelo fornecedor de identidade.</p>
              : email?.reauthenticationRequired ? <p role="status">Confirme a sessão para consultar ou alterar a verificação por email.</p>
              : <p role="status" id="email-verification-unavailable">{email?.available ? 'Não foi possível confirmar o estado da verificação por email.' : 'Por configurar neste ambiente. A verificação por email ainda não pode ser ativada aqui.'}</p>}
            {actionError && <p role="alert">Não foi possível iniciar a alteração. A preferência não foi confirmada; tente novamente.</p>}
            <p className="account-security-detail">Sem acesso ao email, contacte o apoio para conhecer as opções de recuperação. Não existe um procedimento de recuperação aprovado para esta verificação.</p>
          </SecurityMethod>
        </section>
        <details className="account-security-guide"><summary>Como funciona?</summary>
          <p>Os métodos de autenticação já configurados na sua conta mantêm-se.</p>
          <p>«Consultar no fornecedor» significa que o estado desse método não é disponibilizado nesta página. A gestão abre o fornecedor de identidade.</p>
          {!settings.mfaOptional && <p>Algumas operações fora da revisão documental podem exigir autenticação reforçada.</p>}
          <p>A revisão documental depende da sua sessão e das permissões de acesso, sem exigir um código adicional para decidir.</p>
          <a className="btn btn-outline" href="/api/auth/account">Gerir segurança no fornecedor de identidade</a>
        </details>
      </div>}
  </div>
}
