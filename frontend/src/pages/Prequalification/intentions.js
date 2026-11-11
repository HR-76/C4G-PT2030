const PREFIX = 'c4g.effective.intention.v1:'
const allowed = ['userId', 'organizationId', 'operation', 'resourceId', 'idempotencyKey','opportunityId']
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i
export function saveIntention(value, storage = sessionStorage) {
  if (Object.keys(value).some(key => !allowed.includes(key)) || !['userId', 'organizationId', 'resourceId', 'idempotencyKey'].every(key => uuid.test(value[key]))
    || !['PQ1_ACTIVATE','PQ1_EVALUATE','PQ1_DECIDE'].includes(value.operation)) throw new Error('Intenção inválida.')
  if(value.operation==='PQ1_DECIDE'&&!uuid.test(value.opportunityId))throw new Error('Intenção inválida.');
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
