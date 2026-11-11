const PREFIX = 'c4g.pq1.intention.v1:'
const allowed = ['userId', 'organizationId', 'operation', 'resourceId', 'idempotencyKey', 'expectedRevision']
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i
export function saveIntention(value, storage = sessionStorage) {
  if (Object.keys(value).some(key => !allowed.includes(key)) || !['userId', 'organizationId', 'resourceId', 'idempotencyKey'].every(key => uuid.test(value[key]))
    || !['CREATE_DRAFT', 'EDIT_ITEMS','SET_COMPETENCIES','SET_EXPERIENCES','ATTACH_EVIDENCE','VERIFY','REVOKE_VERIFICATION', 'SUBMIT', 'APPROVE', 'PUBLISH'].includes(value.operation)) throw new Error('Intenção inválida.')
  storage.setItem(PREFIX + value.idempotencyKey, JSON.stringify(value))
}
export function pendingIntentions(userId, organizationId, storage = sessionStorage) {
  const values = []
  for (let index = 0; index < storage.length; index++) {
    const key = storage.key(index)
    if (!key.startsWith(PREFIX)) continue
    try {
      const value = JSON.parse(storage.getItem(key))
      if (value.userId === userId && value.organizationId === organizationId && Object.keys(value).every(k => allowed.includes(k))) values.push(value)
    } catch { /* Corrupt browser storage is never an authorization source. */ }
  }
  return values
}
export function removeIntention(key, storage = sessionStorage) { storage.removeItem(PREFIX + key) }
export function clearEditorialIntentions(storage) {
  try { storage ||= sessionStorage; for (let index = storage.length - 1; index >= 0; index--) { const key = storage.key(index); if (key.startsWith(PREFIX) || key.startsWith('c4g.criteria.intention.v1:') || key.startsWith('c4g.effective.intention.v1:')) storage.removeItem(key) } }
  catch { /* Storage policy must not prevent server-side logout or a 401 redirect. */ }
}
