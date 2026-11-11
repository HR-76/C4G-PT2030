import { CheckCircle2, AlertTriangle, LogOut } from 'lucide-react'
import { clearLogoutResult } from '../api/logoutResult'
import './logout-result.css'

export default function LogoutResult({ status }) {
  const complete = status === 'complete', incomplete = status === 'incomplete'
  const Icon = complete ? CheckCircle2 : incomplete ? AlertTriangle : LogOut
  return <main className="logout-result">
    <div className="logout-result-brand">C4G <span>Funding Platform</span></div>
    <section className="logout-result-card" aria-labelledby="logout-result-title" data-state={status}>
      <span className="logout-result-icon"><Icon size={34} aria-hidden="true"/></span>
      <h1 id="logout-result-title">{complete ? 'Saída concluída' : incomplete ? 'Saída incompleta' : 'Resultado da saída não confirmado'}</h1>
      <p role="status">{complete ? 'A sessão da APP foi terminada.' : incomplete ? 'Não foi possível concluir todos os passos da saída.' : 'Não existe uma confirmação recente da saída neste separador.'}</p>
      {incomplete && <div className="logout-result-next"><h2>O que fazer agora</h2><p>Quando o serviço estiver disponível, volte a entrar e selecione «Sair» novamente para repetir a saída.</p></div>}
      {complete && <p className="logout-result-note">Pode voltar a entrar quando precisar de continuar o seu trabalho.</p>}
      {!complete && !incomplete && <p>Volte a entrar para verificar a sessão. Se pretender terminar o acesso, selecione «Sair» na APP.</p>}
      <a className="btn btn-primary logout-result-login" href="/api/auth/oidc/login?returnTo=%2F" onClick={clearLogoutResult}>Voltar a entrar</a>
    </section>
    <p className="logout-result-footer">C4G — Consulting and Training Network</p>
  </main>
}
