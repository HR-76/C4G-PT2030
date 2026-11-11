const PREFIX = 'c4g.application.intention.v1:'
const LEGACY_PREFIX = 'application-intention:'
const WORK_PREFIX = 'c4g.application.work.intention.v1:'
const PARTNER_PREFIX = 'c4g.application.partners.intention.v1:'
export const applicationPartnerIntentKey = (userId, organizationId, applicationId) => `${PARTNER_PREFIX}${userId}:${organizationId}:${applicationId}`
const DOCUMENT_PREFIX = 'c4g.application.documents.intention.v1:'

export const applicationIntentKey = (userId, organizationId) => `${PREFIX}${userId}:${organizationId}`
export const applicationWorkIntentKey = (userId, organizationId, applicationId) => `${WORK_PREFIX}${userId}:${organizationId}:${applicationId}`
export const applicationDocumentIntentKey = (userId, organizationId, applicationId) => `${DOCUMENT_PREFIX}${userId}:${organizationId}:${applicationId}`

export function loadApplicationIntention(userId, organizationId, storage = sessionStorage) {
  if (!userId || !organizationId) return null
  try {
    const value = JSON.parse(storage.getItem(applicationIntentKey(userId, organizationId)) || 'null')
    return value?.userId === userId && value?.organizationId === organizationId
      && ['create', 'edit', 'transition'].includes(value.method)
      && value.payload && typeof value.payload === 'object' && !Array.isArray(value.payload)
      && typeof value.idempotencyKey === 'string' ? value : null
  } catch { return null }
}

export function saveApplicationIntention(value, storage = sessionStorage) {
 try { storage.setItem(applicationIntentKey(value.userId,value.organizationId),JSON.stringify(value)) }
 catch { throw Object.assign(new Error('Não foi possível preparar o envio neste navegador. Tente novamente.'),{code:'APPLICATION_STORAGE_UNAVAILABLE'}) }
}

export function clearApplicationIntentions(storage = sessionStorage) {
  try {
    for (let index = storage.length - 1; index >= 0; index--) {
      const key = storage.key(index)
      if (key.startsWith(PARTNER_PREFIX) || key.startsWith(PREFIX) || key.startsWith(WORK_PREFIX) || key.startsWith(DOCUMENT_PREFIX) || key.startsWith(LEGACY_PREFIX)) storage.removeItem(key)
    }
  } catch { /* Browser storage policy must not prevent logout. */ }
}

export function loadWorkIntention(userId,organizationId,applicationId,storage=sessionStorage){
 const valid=value=>value?.userId===userId&&value.organizationId===organizationId&&value.applicationId===applicationId
  &&['participantAdd','participantRemove','taskCreate','taskEdit','taskComplete','taskCancel','taskDelete'].includes(value.method)
  &&value.payload&&typeof value.payload==='object'&&!Array.isArray(value.payload)&&typeof value.idempotencyKey==='string'
 const key=applicationWorkIntentKey(userId,organizationId,applicationId),legacy=`${WORK_PREFIX}${userId}:${organizationId}`
 const current=storage.getItem(key)
 if(current){const value=JSON.parse(current);if(!valid(value))throw Error('INVALID_WORK_INTENTION');return value}
 const old=storage.getItem(legacy);if(!old)return null
 const value=JSON.parse(old);if(!valid(value))return null
 storage.setItem(key,old);storage.removeItem(legacy);return value
}
