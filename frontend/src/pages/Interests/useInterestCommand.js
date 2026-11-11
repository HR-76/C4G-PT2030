import { useEffect, useRef, useState } from 'react'
import { opportunityInterestsApi as api } from '../../api/api'
import { readInterestIntention, saveInterestIntention, removeInterestIntention } from './intentions'

export function interestError(error) {
  const status = error?.response?.status
  if (status === 400) return 'Verifique os campos e as unidades selecionadas.'
  if (status === 401) return 'A sessão expirou. Inicie sessão novamente.'
  if (status === 403) return 'Não tem permissão para esta operação.'
  if (status === 404) return 'O interesse ou a oportunidade não está disponível.'
  if (status === 409) return 'Os dados mudaram. Consulte a versão atual antes de voltar a guardar.'
  return 'Não foi possível confirmar o envio. Confirme o mesmo pedido antes de continuar.'
}
export default function useInterestCommand(userId, organizationId, onSuccess) {
  const [initial] = useState(() => { try { return { pending: readInterestIntention(userId, organizationId) } } catch { return { blocked: true } } })
  const [pending, setPending] = useState(initial.pending || null), [busy, setBusy] = useState(false)
  const [error, setError] = useState(initial.blocked ? 'Não foi possível recuperar o envio neste navegador. Mantenha esta página aberta.' : '')
  const mutex = useRef(false), alive = useRef(true), success = useRef(onSuccess)
  success.current = onSuccess
  useEffect(() => { alive.current = true; return () => { alive.current = false } }, [])
  async function transmit(intent, retry = false) {
    if (mutex.current || initial.blocked) return
    mutex.current = true
    try { saveInterestIntention(intent) } catch { mutex.current = false; setError('Não foi possível guardar o pedido neste navegador. O envio foi interrompido.'); return }
    setPending(intent); setBusy(true); setError('')
    try {
      const body = { ...intent.payload, idempotencyKey: intent.idempotencyKey }
      const result = intent.method === 'create' ? await api.create(body, organizationId) : await api[intent.method](intent.id, body, organizationId)
      if (!alive.current) return
      removeInterestIntention(intent); setPending(null); success.current?.(result.data, intent)
    } catch (e) {
      if (!alive.current) return
      const status = e?.response?.status, code = e?.response?.data?.error?.code
      // These conflicts follow receipt lookup on the server, so they prove that
      // this exact intention did not commit. Access refusals on a retry do not.
      const definitiveConflict = status === 409 && ['STALE_OPPORTUNITY_REVISION', 'STALE_REVISION', 'UNIT_UNAVAILABLE', 'STATE_CONFLICT'].includes(code)
      if (definitiveConflict || (!retry && [400, 401, 403, 404, 409].includes(status))) {
        try { removeInterestIntention(intent); setPending(null) } catch { /* Keep recovery visible. */ }
      }
      setError(interestError(e))
    } finally { mutex.current = false; if (alive.current) setBusy(false) }
  }
  function submit(method, id, payload) {
    if (mutex.current || pending || initial.blocked) return
    try {
      const existing = readInterestIntention(userId, organizationId)
      if (existing) { setPending(existing); return }
    } catch { setError('Não foi possível recuperar o envio neste navegador. O envio foi interrompido.'); return }
    return transmit({ userId, organizationId, method, id: id || null, payload, idempotencyKey: crypto.randomUUID() })
  }
  return { pending, busy, error, blocked: Boolean(initial.blocked), submit, retry: () => pending && transmit(pending, true) }
}
