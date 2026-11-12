import { createContext, useContext, useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../../contexts/AuthContext'
import { opportunityInterestsApi as api } from '../../api/api'
import FormModal from '../../components/FormModal'
import { opportunityDisplay } from '../Opportunities/opportunityReadModel'
import UnitSelector from './UnitSelector'
import useInterestCommand from './useInterestCommand'
import { safeInterestReturn } from './intentions'
import './interests.css'

const InterestContext = createContext(null)
export const useCatalogInterests = () => useContext(InterestContext)
export default function CatalogInterests({ organization, items, catalogApi, children }) {
  const { user } = useAuth()
  if (!organization) return children
  return <CatalogContext key={`${user?.id}:${organization.id}`} userId={user?.id} organizationId={organization.id} items={items} catalogApi={catalogApi}>{children}</CatalogContext>
}
function CatalogContext({ userId, organizationId, items, catalogApi, children }) {
  const [summaries, setSummaries] = useState({}), [capabilities, setCapabilities] = useState(null), [state, setState] = useState('loading'), [refresh, setRefresh] = useState(0)
  const [selection, setSelection] = useState(null), [units, setUnits] = useState([]), [unitIds, setUnitIds] = useState([]), [opening, setOpening] = useState(false), [openError, setOpenError] = useState('')
  const [transversal,setTransversal]=useState(false), [notes,setNotes]=useState('')
  const scopeChosen=transversal || unitIds.length>0
  const alive = useRef(true), epoch = useRef(0), openMutex = useRef(false), location = useLocation(), navigate = useNavigate()
  const returnFocusRef = useRef(null)
  const ids = [...new Set(items.map(item => item.opportunityId).filter(Boolean))].join(',')
  const command = useInterestCommand(userId, organizationId, data => { setSelection(null); setSummaries(previous => ({ ...previous, [data.opportunityId]: data })) })
  useEffect(() => { alive.current = true; return () => { alive.current = false; epoch.current += 1 } }, [])
  useEffect(() => { epoch.current += 1; openMutex.current = false; setOpening(false); setSelection(null); setOpenError('') }, [ids, location.pathname, location.search])
  useEffect(() => {
    let active = true; const controller = new AbortController(); setState('loading'); setSummaries({}); setCapabilities(null)
    if (!ids) return
    async function read() {
      try {
        let permissions
        const expected = ids ? ids.split(',') : [], result = {}
        const chunks = []
        for (let index = 0; index < expected.length; index += 25) chunks.push(expected.slice(index, index + 25))
        const responses = await Promise.all(chunks.map(chunk => api.summaries(chunk, organizationId, controller.signal)))
        for (let index = 0; index < chunks.length; index++) {
          const chunk = chunks[index], data = responses[index].data
          if (!active) return
          if (typeof data?.capabilities?.canRegister === 'boolean') permissions = data.capabilities
          if (!Array.isArray(data?.items) || data.items.length !== chunk.length) throw Error('Incomplete interests')
          for (const item of data.items) {
            if (!chunk.includes(item.opportunityId) || result[item.opportunityId] || (item.interestId !== null && typeof item.interestId !== 'string')) throw Error('Invalid interests')
            result[item.opportunityId] = item
          }
        }
        // Older API versions return only the items in a summaries response.
        if (!permissions) {
          const context = (await api.context(organizationId, controller.signal)).data
          permissions = context.capabilities || context
        }
        if (active) { setCapabilities(permissions); setSummaries(result); setState('ready') }
      } catch { if (active) setState('error') }
    }
    read(); return () => { active = false; controller.abort() }
  }, [ids, organizationId, refresh])
  // Starts an application straight from the opportunities table, without a registered interest.
  async function startApplication(item) {
    if (openMutex.current || command.pending || command.blocked || !capabilities?.canCreateApplication || state !== 'ready') return
    openMutex.current = true; setOpening(true); setOpenError(''); const token = ++epoch.current
    try {
      const { data } = await catalogApi.get(item.opportunityId)
      if (!alive.current || token !== epoch.current) return
      if (data.opportunityId !== item.opportunityId || !data.revisionId || (data.lifecycleState || data.snapshot?.lifecycleState) === 'ARCHIVED') throw Error('Unavailable')
      navigate('/candidaturas?' + new URLSearchParams({ nova: '1', origem: 'CENTRAL', oportunidade: item.opportunityId, revisao: data.revisionId, retorno: safeInterestReturn(location.pathname + location.search, '/catalogo') }))
    } catch { if (alive.current && token === epoch.current) setOpenError('Não foi possível preparar a candidatura. Tente novamente.') }
    finally { openMutex.current = false; if (alive.current && token === epoch.current) setOpening(false) }
  }
  async function open(item) {
    if (openMutex.current || command.pending || command.blocked || !capabilities?.canRegister || state !== 'ready') return
    returnFocusRef.current = document.activeElement
    openMutex.current = true; setOpening(true); setOpenError(''); const token = ++epoch.current
    try {
      const [record, choices] = await Promise.all([catalogApi.get(item.opportunityId), api.units({ purpose: 'ASSIGN' }, organizationId)])
      if (!alive.current || token !== epoch.current) return
      if (record.data.opportunityId !== item.opportunityId || !record.data.revisionId || (record.data.lifecycleState || record.data.snapshot?.lifecycleState) === 'ARCHIVED' || !Array.isArray(choices.data.items)) throw Error('Unavailable')
      setUnits(choices.data.items); setUnitIds([]); setTransversal(false); setNotes(''); setSelection({ opportunityId: item.opportunityId, centralRevisionId: record.data.revisionId, title: opportunityDisplay(record.data).title || item.title })
    } catch { if (alive.current && token === epoch.current) setOpenError('Não foi possível preparar o interesse. Tente novamente.') }
    finally { if (alive.current && token === epoch.current) { openMutex.current = false; setOpening(false) } }
  }
  const returnTo = safeInterestReturn(location.pathname + location.search, '/catalogo')
  const value = { summaries, capabilities, state, open, startApplication, busy: opening || command.busy || Boolean(command.pending) || command.blocked, returnTo }
  const feedback = <>{command.error && <p role="alert">{command.error}</p>}{command.pending && <p role="status">Existe um envio por confirmar. <button type="button" className="btn btn-outline" disabled={command.busy || state !== 'ready'} onClick={command.retry}>Confirmar envio pendente</button></p>}</>
  return <InterestContext.Provider value={value}>
    {state === 'error' && <p role="alert">Não foi possível consultar os interesses da organização. <button className="btn btn-outline btn-sm" onClick={() => setRefresh(value => value + 1)}>Repetir consulta de interesses</button></p>}
    {openError && <p role="alert">{openError}</p>}{!selection && feedback}{children}
    {selection && <FormModal returnFocusRef={returnFocusRef} title="Registar interesse" locked={command.busy || Boolean(command.pending)} onClose={() => setSelection(null)}><form onSubmit={event => { event.preventDefault(); if(!scopeChosen)return; command.submit('create', null, { opportunityId: selection.opportunityId, centralRevisionId: selection.centralRevisionId, unitIds, transversal, notes:notes.trim()||null }) }}>
      <p><strong>{selection.title}</strong></p>{feedback}
      <p>Escolha pelo menos um departamento ou assinale o interesse transversal.</p>
      <UnitSelector units={units} selectedIds={unitIds} emptyLabel={null} onChange={ids=>{setUnitIds(ids);if(ids.length)setTransversal(false)}} disabled={command.busy || Boolean(command.pending)}/>
      <label className="interest-transversal"><input type="checkbox" checked={transversal} disabled={command.busy || Boolean(command.pending)} onChange={e=>{setTransversal(e.target.checked);if(e.target.checked)setUnitIds([])}}/> Interesse transversal à C4G</label>
      <label className="interest-initial-notes">Notas iniciais (opcional)<textarea rows={3} maxLength={10000} value={notes} disabled={command.busy || Boolean(command.pending)} onChange={e=>setNotes(e.target.value)} placeholder="Porque vale a pena acompanhar este aviso?"/></label>
      <div className="form-actions"><button type="button" className="btn btn-secondary" disabled={command.busy || Boolean(command.pending)} onClick={() => setSelection(null)}>Cancelar</button><button type="submit" className="btn btn-primary" aria-busy={command.busy} disabled={!scopeChosen || command.busy || Boolean(command.pending) || command.blocked}>{command.busy ? 'A guardar…' : 'Guardar interesse'}</button></div>
    </form></FormModal>}
  </InterestContext.Provider>
}
