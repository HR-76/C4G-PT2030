import LoadingIndicator from '../../components/LoadingIndicator'
import { useEffect, useState } from 'react'
import { RefreshCw, ShieldAlert, ShieldCheck } from 'lucide-react'
import { platformDirectoryApi } from '../../api/api'
import { useAuth } from '../../contexts/AuthContext'
import './platform-directory.css'
import './directory-workspace.css'
import './platform-backups.css'

const date = value => new Intl.DateTimeFormat('pt-PT', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Europe/Lisbon' }).format(new Date(value))
const megabytes = new Intl.NumberFormat('pt-PT', { minimumFractionDigits: 1, maximumFractionDigits: 1 })
const size = bytes => typeof bytes === 'number' ? `${megabytes.format(bytes / 1048576)} MB` : '—'
const databaseLabel = name => name.startsWith('c4g_central') ? 'Central' : name.startsWith('c4g_tenant') ? 'Entidades' : name
const STATE = {
  AVAILABLE: ['active', 'Disponível'],
  RESTORE_TESTED: ['active', 'Disponível · restauro testado'],
  INCOMPLETE: ['suspended', 'Incompleta'],
}

export default function PlatformBackups() { const { user } = useAuth(); return <BackupsView key={user?.id} /> }

export function BackupsView({ api = platformDirectoryApi }) {
  const [data, setData] = useState(null), [error, setError] = useState(''), [busy, setBusy] = useState(true), [revision, setRevision] = useState(0)
  useEffect(() => {
    let active = true
    const controller = new AbortController()
    setBusy(true); setError('')
    api.backups(controller.signal).then(response => { if (active) setData(response.data) }).catch(failure => {
      if (!active) return
      setData(null)
      const code = failure.response?.data?.error?.code
      setError(failure.response?.status === 403 ? 'Esta área está reservada à administração C4G.'
        : code === 'BACKUPS_NOT_CONFIGURED' ? 'A consulta das cópias de segurança não está ligada neste ambiente.'
          : 'Não foi possível consultar as cópias de segurança. Tente novamente.')
    }).finally(() => { if (active) setBusy(false) })
    return () => { active = false; controller.abort() }
  }, [api, revision])

  const late = data?.databases.filter(item => !item.ok) || []
  return <div className="page platform-directory directory-workspace platform-backups">
    <div className="directory-heading"><h1>Cópias de segurança</h1>
      <button className="btn btn-outline" disabled={busy} onClick={() => setRevision(value => value + 1)}><RefreshCw size={16} aria-hidden="true" /> {error ? 'Tentar novamente' : 'Atualizar'}</button></div>
    {busy && <LoadingIndicator>A consultar as cópias de segurança…</LoadingIndicator>}
    {error && <div role="alert" className="alert alert-error">{error}</div>}
    {data && <div className={busy ? 'directory-stale' : undefined} inert={busy ? '' : undefined} aria-busy={busy || undefined}>
      <section className={`backup-summary backup-summary-${data.status === 'OK' ? 'ok' : 'late'}`} role="status" aria-label="Estado das cópias de segurança">
        {data.status === 'OK' ? <ShieldCheck size={28} aria-hidden="true" /> : <ShieldAlert size={28} aria-hidden="true" />}
        <div>
          <h2>{data.status === 'OK' ? 'As cópias de segurança estão em dia' : data.status === 'EMPTY' ? 'Ainda não existem cópias de segurança' : 'As cópias de segurança estão em atraso'}</h2>
          {data.status !== 'EMPTY' && <p>{data.lastGoodAt ? <>Última cópia boa: <strong>{date(data.lastGoodAt)}</strong>. </> : 'Há bases sem cópia completa. '}
            Cópias disponíveis: <strong>{data.items.length}</strong>.</p>}
          {late.length > 0 && <p>Em atraso: {late.map(item => `${databaseLabel(item.database)} (${item.lastAt ? `última em ${date(item.lastAt)}` : 'sem cópia completa'})`).join('; ')}.</p>}
          <p className="backup-summary-note">É feita uma cópia cifrada por noite; guardam-se {data.retention.daily} diárias e {data.retention.weekly} semanais.
            {data.lastRestoreTestAt ? ` Último teste de restauro: ${date(data.lastRestoreTestAt)}.` : ' O restauro é testado todas as semanas.'}</p>
        </div>
      </section>
      <section className="directory-register" aria-label="Cópias guardadas">
        <div className="directory-register-heading"><h2>Cópias guardadas</h2><p>A recuperação de dados é feita pela equipa técnica a partir destas cópias.</p></div>
        {data.items.length ? <div className="table-wrap"><table role="table" className="data-table mobile-card-table directory-table"><caption className="sr-only">Cópias de segurança guardadas, mais recentes primeiro</caption>
          <thead role="rowgroup"><tr role="row"><th role="columnheader" scope="col">Data</th><th role="columnheader" scope="col">Base de dados</th><th role="columnheader" scope="col">Estado</th><th role="columnheader" scope="col" className="backup-size">Tamanho</th><th role="columnheader" scope="col">Ficheiro</th></tr></thead>
          <tbody role="rowgroup">{data.items.map(item => {
            const [tone, label] = STATE[item.state] || STATE.INCOMPLETE
            return <tr role="row" key={`${item.database}/${item.file}`}>
              <td role="cell" data-label="Data"><time dateTime={item.at}>{date(item.at)}</time></td>
              <td role="cell" data-label="Base de dados">{databaseLabel(item.database)}</td>
              <td role="cell" data-label="Estado"><span className={`directory-status directory-status-${tone}`}>{label}</span>{item.restoreTestedAt && <small>Testado em {date(item.restoreTestedAt)}</small>}</td>
              <td role="cell" data-label="Tamanho" className="backup-size">{size(item.sizeBytes)}</td>
              <td role="cell" data-label="Ficheiro" className="backup-file">{item.database}/{item.file}</td>
            </tr>
          })}</tbody></table></div> : <div className="directory-empty"><h2>Sem cópias</h2><p>A primeira cópia aparecerá aqui depois da próxima execução noturna.</p></div>}
      </section>
    </div>}
  </div>
}
