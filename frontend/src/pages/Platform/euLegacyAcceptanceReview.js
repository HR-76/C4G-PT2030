import { createUuidV7 } from './euLegacyReview'

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i
const UUID_V7 = /^[a-f0-9]{8}-[a-f0-9]{4}-7[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i
const SHA = /^[a-f0-9]{64}$/
export const progressKey = (packageId, actorId) => `c4g:eu-legacy-acceptance:${packageId}:${actorId}`
export function validAcceptanceQueue(queue, packageId, now = Date.now()) {
  const scope = queue?.profile === 'EU_REVIEW_137' ? 137 : queue?.profile === 'EU_LEGACY_391' ? 391 : null
  return UUID.test(packageId) && queue?.packageId === packageId
    && scope !== null && queue.eligibleCount === scope && queue.conflictCount === 7 && queue.sourceFence === 7
    && Date.parse(queue.expiresAt) > now && Array.isArray(queue.items) && queue.items.length === scope
    && new Set(queue.items.map(item => item.itemDigest)).size === scope
    && queue.items.every(item => SHA.test(item.itemDigest) && typeof item.externalIdentifier === 'string'
      && typeof item.title === 'string' && typeof item.accepted === 'boolean')
}
export function loadAcceptanceProgress(packageId, actorId, storage = sessionStorage) {
  try {
    const value = JSON.parse(storage.getItem(progressKey(packageId, actorId)))
    if (value && typeof value === 'object' && !Array.isArray(value) && value.items
      && typeof value.items === 'object' && !Array.isArray(value.items)) return value
  } catch { /* A damaged cache never authorizes an action. */ }
  return { items: {} }
}
export function saveAcceptanceProgress(packageId, actorId, value, storage = sessionStorage) {
  if (!value || Object.keys(value).join(',') !== 'items' || !value.items || Array.isArray(value.items))
    throw new TypeError('Invalid acceptance progress')
  storage.setItem(progressKey(packageId, actorId), JSON.stringify(value))
}
export async function reauthenticateAcceptance(auth, returnPath) {
  if (!/^\/administracao\/aceitacoes-eu\?pacote=[a-f0-9-]{36}$/.test(returnPath)) throw Error('RETORNO_OIDC_INVALIDO')
  const settings = (await auth.stepUpPolicy()).data
  if (typeof settings?.mfaOptional !== 'boolean') throw Error('POLITICA_AUTENTICACAO_INDISPONIVEL')
  auth.stepUp(settings.mfaOptional ? 'recent-auth' : 'recent-mfa', returnPath)
}
export async function acceptAll({ api, queue, progress, persist, now = Date.now, uuid = createUuidV7 }) {
  if (!validAcceptanceQueue(queue, queue?.packageId, now()) || typeof persist !== 'function') throw Error('PACOTE_DESATUALIZADO')
  let current = { items: { ...progress.items } }
  for (const item of queue.items) {
    if (item.accepted || current.items[item.itemDigest]?.result) continue
    if (now() >= Date.parse(queue.expiresAt)) throw Error('PACOTE_EXPIRADO')
    const review = (await api.euLegacyAcceptanceItem(queue.packageId, item.itemDigest)).data
    if (review?.packageId !== queue.packageId || review.item?.itemDigest !== item.itemDigest
      || review.item.externalIdentifier !== item.externalIdentifier
      || review.item.action !== 'CHANGE_REQUIRES_APPROVAL' || !SHA.test(review.item.previewDigest))
      throw Error('REVISAO_ALTERADA')
    let step = current.items[item.itemDigest] || { prepareRequestId: uuid(), approveRequestId: uuid(), acceptRequestId: uuid() }
    for (const key of ['prepareRequestId', 'approveRequestId', 'acceptRequestId'])
      if (!UUID_V7.test(step[key])) throw Error('INTENCAO_INVALIDA')
    const save = next => { step = next; current = { items: { ...current.items, [item.itemDigest]: step } }; persist(current) }
    save(step)
    if (!step.planId) {
      const plan = (await api.prepareEuLegacyAcceptance(queue.packageId, item.itemDigest,
        { requestId: step.prepareRequestId })).data
      if (!UUID.test(plan?.planId) || !SHA.test(plan.planDigest)
        || plan.preview?.previewDigest !== review.item.previewDigest
        || plan.preview.items?.[0]?.action !== 'CHANGE_REQUIRES_APPROVAL') throw Error('PLANO_INVALIDO')
      save({ ...step, planId: plan.planId, planDigest: plan.planDigest })
    }
    if (!step.fence) {
      const approved = (await api.approveEuLegacyAcceptance(queue.packageId, item.itemDigest,
        { requestId: step.approveRequestId, planId: step.planId, planDigest: step.planDigest })).data
      if (approved?.planId !== step.planId || approved.state !== 'APPROVED'
        || !Number.isSafeInteger(approved.fence) || approved.fence < 1) throw Error('APROVACAO_INVALIDA')
      save({ ...step, fence: approved.fence })
    }
    const result = (await api.acceptEuLegacyCandidate(queue.packageId, item.itemDigest,
      { requestId: step.acceptRequestId, planId: step.planId,
        planDigest: step.planDigest, fence: step.fence })).data
    if (result?.opportunityId !== review.item.expected.opportunityId
      || result.sourceVersion !== 2 || result.action !== 'REVISION_CREATED'
      || !UUID.test(result.revisionId)) throw Error('ACEITACAO_INVALIDA')
    save({ ...step, result })
  }
  return current
}
