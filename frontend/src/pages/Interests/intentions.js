export const interestIntentionPrefix = 'c4g.opportunity-interest.intention.v1:'
export const interestIntentionKey = (userId, organizationId) => `${interestIntentionPrefix}${userId}:${organizationId}`
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype
const exact = (value, keys) => object(value) && Object.keys(value).length === keys.length && Object.keys(value).every(key => keys.includes(key))
const identifier = value => typeof value === 'string' && value.length > 0 && value.length <= 200
const units = value => Array.isArray(value) && value.length <= 50 && value.every(identifier) && new Set(value).size === value.length
const revision = value => Number.isSafeInteger(value) && value > 0
function validate(value, userId, organizationId) {
  if (!exact(value, ['userId','organizationId','method','id','payload','idempotencyKey']) ||
    value.userId !== userId || value.organizationId !== organizationId || !identifier(userId) || !identifier(organizationId) || !identifier(value.idempotencyKey)) throw Error('Invalid interest intention')
  const payload = value.payload
  const valid = value.method === 'create' ? value.id === null && (exact(payload,['opportunityId','centralRevisionId','unitIds']) ||
      (exact(payload,['opportunityId','centralRevisionId','unitIds','transversal','notes']) && typeof payload.transversal==='boolean' &&
       Array.isArray(payload.unitIds) && payload.transversal===(payload.unitIds.length===0) &&
       (payload.notes===null||typeof payload.notes==='string'&&payload.notes.length<=10000))) && identifier(payload.opportunityId) && identifier(payload.centralRevisionId) && units(payload.unitIds)
    : value.method === 'edit' ? identifier(value.id) && exact(payload,['notes','unitIds','expectedRevision']) && (payload.notes === null || (typeof payload.notes === 'string' && payload.notes.length <= 10000)) && units(payload.unitIds) && revision(payload.expectedRevision)
    : value.method === 'archive' && identifier(value.id) && exact(payload,['reason','expectedRevision']) && typeof payload.reason === 'string' && payload.reason.trim().length > 0 && payload.reason.length <= 500 && revision(payload.expectedRevision)
  if (!valid) throw Error('Invalid interest intention')
  return value
}
export function readInterestIntention(userId, organizationId, storage = sessionStorage) {
  if (!userId || !organizationId) return null
  const raw = storage.getItem(interestIntentionKey(userId, organizationId))
  if (raw === null) return null
  return validate(JSON.parse(raw), userId, organizationId)
}
export function saveInterestIntention(value, storage = sessionStorage) {
  validate(value, value?.userId, value?.organizationId)
  const existing = readInterestIntention(value.userId, value.organizationId, storage)
  if (existing && existing.idempotencyKey !== value.idempotencyKey) throw Error('Interest intention already pending')
  storage.setItem(interestIntentionKey(value.userId, value.organizationId), JSON.stringify(value))
}
export function clearInterestIntentions(storage = sessionStorage) {
  try { for (let index = storage.length - 1; index >= 0; index--) { const key = storage.key(index); if (key?.startsWith(interestIntentionPrefix)) storage.removeItem(key) } } catch { /* Storage policy must not block logout. */ }
}
export function removeInterestIntention(value, storage = sessionStorage) {
  const saved = readInterestIntention(value.userId, value.organizationId, storage)
  if (saved?.idempotencyKey === value.idempotencyKey) storage.removeItem(interestIntentionKey(value.userId, value.organizationId))
}
export function safeInterestReturn(value, fallback = '/interesses') {
  if (typeof value !== 'string' || /[\\\r\n]/.test(value)) return fallback
  if (/^\/catalogo\/consulta(?:\/[a-fA-F0-9-]{36})?(?:\?[^#]*)?$/.test(value)) return value
  return /^\/(?:interesses|catalogo|candidaturas)(?:\/[a-zA-Z0-9-]+)?(?:\?[^#]*)?$/.test(value) ? value : fallback
}
