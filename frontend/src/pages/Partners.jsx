import FormModal from '../components/FormModal'
import { PartnerCards } from './Applications/PartnerComponents'
import FilterBar from '../components/FilterBar'
import SearchInput from '../components/SearchInput'
import './Applications/applications.css'
import { useEffect, useRef, useState } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { readScope, startConfirmedRead } from '../api/confirmedReads'
import { Link } from 'react-router-dom'
import { privateApplicationsApi } from '../api/api'
import { ArrowRight, SlidersHorizontal } from 'lucide-react'
import { APPLICATION_STATUS_CHIPS, APPLICATION_STATUS_LABELS } from '../utils/applicationUi'
import './Partners.css'
import EmptyStatePanel from '../components/EmptyStatePanel'

import { LABEL, CHIP } from './Applications/lifecycle'

const STATUS_LABELS = {...APPLICATION_STATUS_LABELS,...LABEL}
const STATUS_CLASS = {...APPLICATION_STATUS_CHIPS,...CHIP}

const PERSON_ROLES = {
  RESPONSAVEL: 'Responsável',
  INVESTIGADOR: 'Investigador',
  OUTRO: 'Outro',
}

function ContactDetails({ contact, email }) {
  const details = [contact, email].filter(Boolean)
  if (details.length === 0) return null

  return (
    <span className="partner-contact-mini">
      {details.join(' | ')}
    </span>
  )
}

function ResponsibleSummary({ name, contact, email }) {
  if (!name && !contact && !email) return null

  return (
    <div className="partner-responsible-summary">
      {name && <span><strong>Responsável:</strong> {name}</span>}
      <ContactDetails contact={contact} email={email} />
    </div>
  )
}

export default function Partners() { const {organization,user}=useAuth();return <PartnersView key={`${user?.id}:${organization?.organizationId||organization?.id}`} organizationName={organization?.displayName || organization?.name} organizationId={organization?.organizationId||organization?.id} scope={readScope(user?.id,organization?.organizationId||organization?.id)}/> }
function PartnersView({organizationId, organizationName, scope=null}) {
  // The first page of a query already confirmed is shown at once and read again.
  const readName=(query,next)=>next?null:`partners:${JSON.stringify(query)}`
  const [opening]=useState(()=>startConfirmedRead(scope,readName({ q: '', country: '', person_role: '' },null)).held)
  const opener = useRef(null)
  const [selected,setSelected]=useState(null)
  const [rows, setRows] = useState(opening?.items||[])
  const [countries, setCountries] = useState(opening?.countries||[])
  const [loading, setLoading] = useState(!opening)
  const [error,setError]=useState(''),[refresh,setRefresh]=useState(0),[cursor,setCursor]=useState(null),[page,setPage]=useState(opening)
  const [filters, setFilters] = useState({ q: '', country: '', person_role: '' })

  const hasFilters = Boolean(filters.q || filters.country || filters.person_role)

  useEffect(() => {
    let active=true;const controller=new AbortController(),read=startConfirmedRead(scope,readName(filters,cursor));setLoading(!read.held);setError('');setRows(read.held?.items||[]);setPage(read.held);setSelected(null)
    if(read.held)setCountries(read.held.countries)
    const timer=setTimeout(()=>{
      const params=Object.fromEntries(Object.entries({...filters,...(cursor?{cursor}:{})}).filter(([,v])=>v))
      const request=privateApplicationsApi.partnersBrowse(params,organizationId,controller.signal)
      request.then(r=>{read.keep(r.data);if(active){setRows(r.data.items);setCountries(r.data.countries);setPage(r.data)}})
        .catch(e=>{if(active&&e?.code!=='ERR_CANCELED'){read.drop();setRows([]);setPage(null);setCountries([]);setError(e?.response?.data?.error?.code==='SCHEMA_UPGRADE_REQUIRED'?'A recuperação dos parceiros aguarda a atualização local.':e?.response?.data?.error?.code==='INVALID_CURSOR'?'Os dados mudaram. Recarregue a lista.':'Não foi possível consultar os parceiros. Tente novamente.')}})
        .finally(()=>{if(active)setLoading(false)})
    },250)
    return ()=>{active=false;controller.abort();clearTimeout(timer)}
  // eslint-disable-next-line react-hooks/exhaustive-deps -- Runs only when the listed keys change; scope is read at that moment.
  },[filters,cursor,refresh,organizationId])

  const setFilter = (key, value) => {setCursor(null);setFilters(current => ({ ...current, [key]: value }))}
  const clearFilters = () => {setCursor(null);setFilters({ q: '', country: '', person_role: '' })}

  return (
    <div className="application-partners-browse">
      {selected&&<FormModal title="Ficha de parceiro" returnFocusRef={opener} onClose={()=>setSelected(null)}>
        <div className="partner-card-detail"><PartnerCards partners={[selected]} canEditPartners={false}/>
          <section className="detail-section"><h3>Candidatura associada</h3><p>{selected.application_title}</p>
            {selected.opportunity_title&&<p>Aviso: {selected.opportunity_title}</p>}
            <Link className="btn btn-primary" to={`/candidaturas/${selected.application_id}#parceiros`}>Abrir parceiros da candidatura</Link>
          </section>
          <button type="button" className="btn btn-secondary partner-return" onClick={()=>setSelected(null)}>Voltar à lista</button>
        </div>
      </FormModal>}
      <header className="partner-heading"><p>{organizationName}</p><h1>Parceiros</h1></header>
      {error&&<p role="alert">{error} <button onClick={()=>{setCursor(null);setRefresh(v=>v+1)}}>Recarregar parceiros</button></p>}
      <FilterBar aria-label="Filtros de parceiros">
          <label className="filter-search">Pesquisar parceiros<SearchInput
              aria-label="Pesquisar parceiros" placeholder="Pesquisar entidade, pessoa, área, email..."
              value={filters.q}
              onChange={e => setFilter('q', e.target.value)}
            />
          </label>
          <details className="partner-filters-more"><summary><SlidersHorizontal size={15} aria-hidden="true"/>Filtros avançados{(filters.country || filters.person_role) && ` (${[filters.country, filters.person_role].filter(Boolean).length})`}</summary><div><label>País<select aria-label="País" value={filters.country} onChange={e => setFilter('country', e.target.value)}>
            <option value="">Todos os países</option>
            {countries.map(country => <option key={country} value={country}>{country}</option>)}
          </select></label>
          <label>Papel<select aria-label="Papel" value={filters.person_role} onChange={e => setFilter('person_role', e.target.value)}>
            <option value="">Todos os papéis</option>
            {Object.entries(PERSON_ROLES).map(([role, label]) => (
              <option key={role} value={role}>{label}</option>
            ))}
          </select></label>
          </div></details>
          {hasFilters ? (
            <button className="btn btn-secondary" onClick={clearFilters}>Limpar filtros</button>
          ) : null}
        <p className="filter-note">Os resultados atualizam automaticamente.</p>
      </FilterBar>

      <div className="table-meta" role="status">
        {loading ? 'A consultar parceiros…' : error?'Consulta indisponível':`${page?.total??rows.length} parceiro${(page?.total??rows.length) !== 1 ? 's' : ''}`}
      </div>

      <div className="table-wrap">
        <table role="table" className="data-table partners-table mobile-card-table">
          <colgroup>
            <col style={{ width: '20%' }} />
            <col style={{ width: '9%' }} />
            <col style={{ width: '23%' }} />
            <col style={{ width: '25%' }} />
            <col style={{ width: '19%' }} />
            <col style={{ width: '4%' }} />
          </colgroup>
          <thead role="rowgroup">
            <tr role="row">
              <th role="columnheader" scope="col">Entidade</th>
              <th role="columnheader" scope="col">País</th>
              <th role="columnheader" scope="col">Área / Interesse</th>
              <th role="columnheader" scope="col">Pessoas</th>
              <th role="columnheader" scope="col">Candidatura</th>
              <th role="columnheader" scope="col"></th>
            </tr>
          </thead>
          <tbody role="rowgroup">
            {rows.map(partner => (
              <tr role="row" key={partner.id}>
                <td role="cell" data-label="Entidade" className="td-notrunc">
                  <button type="button" className="partner-card-link col-title" aria-label={`Ver ficha de ${partner.entity_name}`} onClick={event=>{opener.current=event.currentTarget;setSelected(partner)}}>{partner.entity_name}</button>
                  <ResponsibleSummary
                    name={partner.responsible_person}
                    contact={partner.contact}
                    email={partner.email}
                  />
                </td>
                <td role="cell" data-label="País" className="text-muted">{partner.country || '—'}</td>
                <td role="cell" data-label="Área / Interesse" className="text-muted td-notrunc">{partner.research_area_interest || '—'}</td>
                <td role="cell" data-label="Pessoas" className="td-notrunc">
                  <div className="partner-people-mini">
                    {partner.people.length > 0 ? (
                      partner.people.map(person => (
                        <div key={person.id} className="partner-person-mini">
                          <span className="col-title">{person.name}</span>
                          <span className="text-muted">
                            {PERSON_ROLES[person.role] || person.role}
                            {person.research_area ? ` - ${person.research_area}` : ''}
                          </span>
                          <ContactDetails contact={person.contact} email={person.email} />
                        </div>
                      ))
                    ) : (
                      <span className="text-muted">—</span>
                    )}
                  </div>
                </td>
                <td role="cell" data-label="Candidatura" className="td-notrunc">
                  <div className="partner-app-cell">
                    <span className={`chip ${STATUS_CLASS[partner.application_status] || 'chip-grey'}`}>
                      {STATUS_LABELS[partner.application_status] || partner.application_status}
                    </span>
                    <div className="project-compact">
                      <span
                        className="project-name line-clamp-2"
                        title={partner.application_title || 'Sem candidatura associada'}
                      >
                        {partner.application_title || 'Sem candidatura associada'}
                      </span>
                      {partner.opportunity_title && (
                        <span className="project-notice line-clamp-1" title={partner.opportunity_title}>
                          <strong>Aviso:</strong> {partner.opportunity_title}
                        </span>
                      )}
                    </div>
                  </div>
                </td>
                <td role="cell" data-label="">
                  <Link to={`/candidaturas/${partner.application_id}`} className="table-action" aria-label={`Abrir candidatura ${partner.application_title || "associada"}`} title="Abrir candidatura">
                    <ArrowRight size={14} />
                  </Link>
                </td>
              </tr>
            ))}
            {!loading && !error && rows.length === 0 && (
              <tr role="row">
                <td role="cell" colSpan={6}>
                  <EmptyStatePanel
                    title={hasFilters ? 'Sem parceiros para estes filtros.' : 'Ainda não há parceiros registados.'}
                    description={hasFilters
                      ? 'Altere a pesquisa ou limpe os filtros para consultar os parceiros acessíveis.'
                      : 'Os parceiros associados às candidaturas a que tem acesso aparecem aqui.'}
                    actionLabel={hasFilters ? 'Limpar filtros' : 'Ver candidaturas'}
                    onAction={hasFilters ? clearFilters : undefined}
                    actionTo={hasFilters ? undefined : '/candidaturas'}
                  />
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {page&&(rows.length>0||page.previousCursor)&&<nav className="pagination" aria-label="Paginação de parceiros"><button className="btn btn-secondary" disabled={loading||!page.previousCursor} onClick={()=>setCursor(page.previousCursor)}>Anterior</button> Página {page.page} <button className="btn btn-secondary" disabled={loading||!page.nextCursor} onClick={()=>setCursor(page.nextCursor)}>Seguinte</button></nav>}
    </div>
  )
}
