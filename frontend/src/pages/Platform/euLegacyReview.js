const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i
const UUID_V7 = /^[a-f0-9]{8}-[a-f0-9]{4}-7[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i
const SHA = /^[a-f0-9]{64}$/

export function createUuidV7(now = Date.now(), random = crypto.getRandomValues(new Uint8Array(16))) {
  if (!Number.isSafeInteger(now) || now < 0 || now > 0xffffffffffff || !(random instanceof Uint8Array) || random.length !== 16)
    throw new TypeError('UUIDv7 input invalid')
  const bytes = Uint8Array.from(random)
  for (let index = 5, value = now; index >= 0; index--, value = Math.floor(value / 256)) bytes[index] = value & 255
  bytes[6] = (bytes[6] & 15) | 0x70
  bytes[8] = (bytes[8] & 63) | 0x80
  const hex = Array.from(bytes, value => value.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

export function validQueue(queue, packageId, now = Date.now()) {
  return UUID.test(packageId) && queue?.packageId === packageId && queue?.eligibleCount === 391
    && queue?.conflictCount === 7 && queue?.sourceFence === 7
    && Number.isFinite(Date.parse(queue.expiresAt)) && Date.parse(queue.expiresAt) > now
    && Array.isArray(queue.items) && queue.items.length === 391
    && new Set(queue.items.map(item => item.itemDigest)).size === 391
    && queue.items.every(item => typeof item.externalIdentifier === 'string' && item.externalIdentifier.length > 0
      && typeof item.title === 'string' && SHA.test(item.itemDigest))
}

export function progressKey(packageId, actorId) {
  if (!UUID.test(packageId) || !UUID.test(actorId)) throw new TypeError('Invalid review identity')
  return `c4g:eu-legacy-prearchive:${packageId}:${actorId}`
}

export function readProgress(storage, key) {
  try {
    const value = JSON.parse(storage.getItem(key))
    if (value && typeof value === 'object' && !Array.isArray(value)
      && value.pending && typeof value.pending === 'object' && !Array.isArray(value.pending)
      && value.receipts && typeof value.receipts === 'object' && !Array.isArray(value.receipts)) return value
  } catch { /* A damaged local cache cannot authorize anything. */ }
  return { pending: {}, receipts: {} }
}

export function loadReviewProgress(packageId, actorId, storage = sessionStorage) {
  return readProgress(storage, progressKey(packageId, actorId))
}

export function saveReviewProgress(packageId, actorId, value, storage = sessionStorage) {
  if (!value || Object.keys(value).sort().join(',') !== 'pending,receipts'
    || !value.pending || !value.receipts || Array.isArray(value.pending) || Array.isArray(value.receipts))
    throw new TypeError('Invalid review progress')
  for (const [digest, intent] of Object.entries(value.pending)) {
    if (!SHA.test(digest) || !intent || Object.keys(intent).sort().join(',') !== 'bindingDigest,requestId'
      || !SHA.test(intent.bindingDigest) || !UUID_V7.test(intent.requestId)) throw new TypeError('Invalid review intention')
  }
  for (const [digest, receipt] of Object.entries(value.receipts)) {
    if (!SHA.test(digest) || !receipt || Object.keys(receipt).sort().join(',') !== 'actorId,bindingDigest,eventHash,eventId,expiresAt,externalIdentifier,itemDigest,packageId,replayed,requestId,scope'
      || receipt.packageId !== packageId || receipt.actorId !== actorId || receipt.itemDigest !== digest
      || receipt.scope !== 'PREARCHIVE_ONLY' || !SHA.test(receipt.bindingDigest) || !SHA.test(receipt.eventHash)
      || !UUID.test(receipt.eventId) || !UUID_V7.test(receipt.requestId)
      || typeof receipt.externalIdentifier !== 'string' || typeof receipt.expiresAt !== 'string'
      || typeof receipt.replayed !== 'boolean') throw new TypeError('Invalid review receipt')
  }
  storage.setItem(progressKey(packageId, actorId), JSON.stringify(value))
}

export async function reauthenticateForReview(auth, returnPath) {
  if (typeof returnPath !== 'string' || !/^\/administracao\/aprovacoes-eu(?:\?pacote=[a-f0-9-]{36})?$/.test(returnPath))
    throw new Error('RETORNO_OIDC_INVALIDO')
  const settings = (await auth.stepUpPolicy()).data
  if (typeof settings?.mfaOptional !== 'boolean') throw new Error('POLITICA_AUTENTICACAO_INDISPONIVEL')
  auth.stepUp(settings.mfaOptional ? 'recent-auth' : 'recent-mfa', returnPath)
}

export async function emitPreapprovals({ api, queue, progress, persist, uuid = createUuidV7, now = Date.now }) {
  if (!validQueue(queue, queue?.packageId, now()) || typeof persist !== 'function')
    throw new Error('PACOTE_DESATUALIZADO')
  let current = { pending: { ...progress.pending }, receipts: { ...progress.receipts } }
  for (const item of queue.items) {
    if (current.receipts[item.itemDigest]) continue
    if (now() >= Date.parse(queue.expiresAt)) throw new Error('PACOTE_EXPIRADO')
    const review = (await api.euLegacyPreapproval(queue.packageId, item.itemDigest)).data
    if (review?.scope !== 'PREARCHIVE_ONLY' || review.binding?.externalIdentifier !== item.externalIdentifier
      || review.binding?.itemDigest !== item.itemDigest || !SHA.test(review.bindingDigest))
      throw new Error('REVISAO_ALTERADA')
    const previous = current.pending[item.itemDigest]
    if (previous && (!UUID_V7.test(previous.requestId) || previous.bindingDigest !== review.bindingDigest))
      throw new Error('INTENCAO_ALTERADA')
    const intention = previous || { requestId: uuid(), bindingDigest: review.bindingDigest }
    if (!UUID_V7.test(intention.requestId)) throw new Error('INTENCAO_INVALIDA')
    current = { ...current, pending: { ...current.pending, [item.itemDigest]: intention } }
    persist(current)
    // On an uncertain response, stop. A later explicit click uses this same UUIDv7.
    const receipt = (await api.approveEuLegacyPrearchive(queue.packageId, item.itemDigest, intention)).data
    if (receipt?.scope !== 'PREARCHIVE_ONLY' || receipt.packageId !== queue.packageId
      || receipt.externalIdentifier !== item.externalIdentifier || receipt.itemDigest !== item.itemDigest
      || receipt.bindingDigest !== intention.bindingDigest || receipt.requestId !== intention.requestId
      || !UUID.test(receipt.eventId) || !UUID.test(receipt.actorId) || !SHA.test(receipt.eventHash)
      || receipt.expiresAt !== queue.expiresAt) throw new Error('RECIBO_INVALIDO')
    const pending = { ...current.pending }; delete pending[item.itemDigest]
    current = { pending, receipts: { ...current.receipts, [item.itemDigest]: receipt } }
    persist(current)
  }
  return current
}
