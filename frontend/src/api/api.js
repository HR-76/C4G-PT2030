import { clearCatalogSessions } from '../pages/Opportunities/catalogReadSession'
import axios from 'axios'
import { isLogoutNavigationPending } from './logoutNavigation'
import {documentDownloadPath} from './documentNavigation'
import { clearEditorialIntentions } from '../pages/Editorial/intentions'
import { clearInterestIntentions } from '../pages/Interests/intentions'
import { clearDirectoryIntentions } from '../pages/Organization/intentions'
import { createContextRequestCoordinator } from './requestConcurrency'
import { pageRequests } from './pageRequests'
import { clearConfirmedReads } from './confirmedReads'

const apiBaseUrl = import.meta.env.VITE_API_URL || '/api'
const api = axios.create({ baseURL: apiBaseUrl, withCredentials: true, timeout: 15000 })
const organizationContextRequests = createContextRequestCoordinator()
const changeContext = work => Promise.resolve().then(() => organizationContextRequests.change(() => { clearCatalogSessions(); clearConfirmedReads(); return work() }))
const withSignal = (config, signal) => signal ? { ...config, signal } : config
let csrfToken = null
let csrfRequest = null
let csrfGeneration = 0

function rememberCsrfToken(token) {
  csrfGeneration++
  csrfToken = typeof token === 'string' && token ? token : null
  csrfRequest = null
}

async function getCsrfToken() {
  if (csrfToken) return csrfToken
  if (!csrfRequest) {
    const generation = csrfGeneration
    const pending = axios.get(`${apiBaseUrl}/auth/csrf`, { withCredentials: true, timeout: 10000 })
      .then(response => {
        if (generation === csrfGeneration) csrfToken = response.data.csrfToken
        return generation === csrfGeneration ? csrfToken : getCsrfToken()
      }).finally(() => { if (csrfRequest === pending) csrfRequest = null })
    csrfRequest = pending
  }
  return csrfRequest
}

const settlePageRequest = config => { if (config?.pageRequestCounted) { config.pageRequestCounted = false; pageRequests.end() } }

api.interceptors.request.use(async config => {
  const method = String(config.method || 'get').toUpperCase()
  const read = ['GET', 'HEAD', 'OPTIONS'].includes(method)
  if (!Number.isFinite(config.timeout) || config.timeout <= 0) config.timeout = read ? 15000 : 30000
  // Uploads retain their independent transport and ten-minute budget.
  if (!config.contextChange && !config.contextLease && !config.url?.includes('/documents/uploads/')) {
    config.contextLease = await organizationContextRequests.acquire({ read, signal: config.signal })
    config.signal = config.contextLease.signal
  }
  try {
    if (!read) {
      if (config.timeout === 15000) config.timeout = 30000
      config.headers['X-CSRF-Token'] = await getCsrfToken()
    }
    if (config.signal?.aborted) throw new axios.CanceledError()
    if (!config.pageRequestCounted) { config.pageRequestCounted = true; pageRequests.start() }
    return config
  } catch (error) {
    config.contextLease?.release()
    throw error
  }
})

api.interceptors.response.use(
  r => {
    r.config.contextLease?.release(); settlePageRequest(r.config)
    // A successful write may change anything a page keeps in memory. The alert
    // list refresh is a read sent as POST.
    if (!['GET', 'HEAD', 'OPTIONS'].includes(String(r.config.method || 'get').toUpperCase()) && !r.config.url?.endsWith('/notifications/refresh-list')) clearConfirmedReads()
    return r
  },
  async err => {
    const config = err.config
    if (err.response?.status === 403 && (err.response.data?.error?.code || err.response.data?.code) === 'CSRF_INVALID') {
      // A CSRF rejection precedes the handler. Network/timeouts never retry writes.
      if (csrfToken === config?.headers?.['X-CSRF-Token']) clearCsrfToken()
      if (config && !config.csrfRetried && !config.signal?.aborted) {
        config.csrfRetried = true
        // Keep the same lease/signal: a retry must not cross a session rotation.
        return api.request(config)
      }
    }
    config?.contextLease?.release()
    settlePageRequest(config)
    if (err.response?.status === 401) {
      clearCsrfToken()
      if (!config?.catalogRead) clearCatalogSessions(401)
      clearEditorialIntentions()
      // Expiry preserves application recovery envelopes; explicit logout clears them.
      clearInterestIntentions()
      clearDirectoryIntentions()
      clearConfirmedReads()
      if (!config?.catalogRead && !isLogoutNavigationPending() && !['/', '/login', '/recuperar-password'].includes(window.location.pathname)) window.location.assign('/login')
    }
    return Promise.reject(err)
  }
)

export default api

export const admissionApi = {
  list:page=>api.get('/admin/directory/admissions',{params:{page},timeout:15000}),
  create:body=>api.post('/admin/directory/admissions',body,{timeout:20000}),
  get:id=>api.get(`/admin/directory/admissions/${id}`,{timeout:15000}),
  resume:id=>api.post(`/admin/directory/admissions/${id}/resume`,{},{timeout:55000}),
  issue:(id,body)=>api.post(`/admin/directory/admissions/${id}/invitations`,body,{timeout:20000}),
  cancel:id=>api.post(`/admin/directory/admissions/${id}/cancel`,{},{timeout:20000}),
  submit:(id,body)=>api.post(`/admissions/${id}/submit`,body,{timeout:20000}),
  status:id=>api.get(`/admissions/${id}/status`,{timeout:15000}),
  mine:()=>api.get('/admissions/mine',{timeout:15000}),
  draft:id=>api.get(`/admissions/${id}/draft`,{timeout:15000}),
  save:(id,body)=>api.put(`/admissions/${id}/draft`,body,{timeout:20000}),
  validate:(id,body)=>api.post(`/admissions/${id}/validate`,body,{timeout:15000})
}

export const platformDirectoryApi = {
  dashboard: signal => api.get('/admin/directory/dashboard', { signal, timeout: 15000 }),
  logs: (params, signal) => api.get('/admin/directory/logs', { params, signal, timeout: 15000 }),
  entities: (params, signal) => api.get('/admin/directory/entities', { params, signal, timeout: 15000 }),
  entity: (id, signal) => api.get(`/admin/directory/entities/${id}`, { signal, timeout: 15000 }),
  entityProfile: (id, signal) => api.get(`/admin/directory/entities/${id}/registration`, { signal, timeout: 15000 }),
  saveEntityProfile: (id, body) => api.put(`/admin/directory/entities/${id}/registration`, body, { timeout: 20000 }),
  users: (params, signal) => api.get('/admin/directory/users', { params, signal, timeout: 15000 }),
}

const billingRoot = '/admin/billing'
export const platformBillingApi = {
  summary: (params, signal) => api.get(billingRoot + '/summary', { params, signal, timeout: 15000 }),
  cycles: (params, signal) => api.get(billingRoot + '/cycles', { params, signal, timeout: 15000 }),
  cycle: (id, signal) => api.get(`${billingRoot}/cycles/${id}`, { signal, timeout: 15000 }),
  account: (organizationId, signal) => api.get(`${billingRoot}/organizations/${organizationId}/account`, { signal, timeout: 15000 }),
  accountWrite: (organizationId, body) => api.put(`${billingRoot}/organizations/${organizationId}/account`, body, { timeout: 20000 }),
  cycleCreate: body => api.post(billingRoot + '/cycles', body, { timeout: 20000 }),
  cycleEdit: (id, body) => api.put(`${billingRoot}/cycles/${id}`, body, { timeout: 20000 }),
  cycleTransition: (id, body) => api.post(`${billingRoot}/cycles/${id}/transitions`, body, { timeout: 20000 }),
  documentRecord: (cycleId, body) => api.post(`${billingRoot}/cycles/${cycleId}/documents`, body, { timeout: 20000 }),
  documentTransition: (documentId, body) => api.post(`${billingRoot}/documents/${documentId}/transitions`, body, { timeout: 20000 }),
  paymentRecord: (documentId, body) => api.post(`${billingRoot}/documents/${documentId}/payments`, body, { timeout: 20000 }),
  paymentReverse: (paymentId, body) => api.post(`${billingRoot}/payments/${paymentId}/reversals`, body, { timeout: 20000 }),
}

export function entityAccessApi(organizationId,platform=false){
 const root=platform?`/admin/directory/entities/${organizationId}`:'/organization-directory';
 const usersRoot=root+(platform?'/users':'/access/users');
 const options={headers:{'X-C4G-Organization':organizationId},timeout:60000};
 const read=(path,signal)=>api.get(path,withSignal(options,signal));
 const write=(method,path,body)=>api[method](path,body,options);
 return {
  membershipBilling:(id,body)=>write('put',root+`/memberships/${id}/billing`,body),
  access:signal=>read(root+'/access',signal),membershipProfile:(id,body)=>write('put',root+`/memberships/${id}/profile`,body),membershipStatus:(id,body)=>write('put',root+`/memberships/${id}/status`,body),
  invitations:signal=>read(usersRoot,signal),create:body=>write('post',usersRoot,body),get:(id,signal)=>read(usersRoot+'/'+id,signal),
  sendEmail:(id,body)=>write('post',usersRoot+`/${id}/activation-email`,body),
  resume:id=>write('post',usersRoot+`/${id}/resume`,{}),issue:(id,body)=>write('post',usersRoot+`/${id}/invitations`,body),revoke:(id,invitationId)=>write('post',usersRoot+`/${id}/invitations/${invitationId}/revoke`,{})
 }
}

// ── Auth ──────────────────────────────────────────────────────────────────
export const authApi = {
  login: (returnTo = '/') => {
    window.location.assign(`/api/auth/oidc/login?returnTo=${encodeURIComponent(returnTo)}`)
  },
  logout: () => changeContext(async () => {
    const response = await api.post('/auth/logout', undefined, { contextChange: true, timeout: 10000 })
    clearCsrfToken()
    return response
  }),
  me: (config) => api.get('/auth/session', config),
  accountSecurity: () => api.get('/auth/account-security'),
  stepUpPolicy: () => api.get('/auth/step-up-policy'),
  stepUp: (category, returnTo) => window.location.assign(`${apiBaseUrl}/auth/step-up?category=${encodeURIComponent(category)}&returnTo=${encodeURIComponent(returnTo)}`),
  emailVerification: (action) => api.post('/auth/account-security/email', { action }),
  organizations: signal => api.get('/auth/organizations', withSignal({}, signal)),
  selectOrganization: organizationId => changeContext(async () => {
    const response = await api.post('/auth/organization', { organizationId }, { contextChange: true, timeout: 10000 })
    rememberCsrfToken(response.data.csrfToken)
    return response
  }),
}

export function clearCsrfToken() {
  rememberCsrfToken(null)
}

const editorialRoot = '/organization-profile/editorial-ui'
export const editorialApi = {
  context: () => api.get(editorialRoot + '/context'),
  list: (kind, params) => api.get(editorialRoot + '/' + kind, { params }),
  get: (kind, id) => api.get(editorialRoot + '/' + kind + '/' + id),
  create: body => api.post(editorialRoot + '/drafts', body),
  edit: (id, body) => api.put(editorialRoot + '/drafts/' + id, body),
  submit: (id, body) => api.post(editorialRoot + '/drafts/' + id + '/submit', body),
  approve: (id, body) => api.post(editorialRoot + '/candidates/' + id + '/approve', body),
  publish: (id, body) => api.post(editorialRoot + '/versions/' + id + '/publish', body),
  lookup: (body, timeout = 10000) => api.post(editorialRoot + '/intentions/lookup', body, { timeout }),
  stepUp: (category, returnTo) => authApi.stepUp(category, returnTo),
}

// ── Dashboard ─────────────────────────────────────────────────────────────
export const dashboardApi = {
  organization: async ({ organizationId, isCurrent, signal }) => {
    if (!organizationId || !isCurrent()) throw new Error('Organization required')
    const headers = { 'X-C4G-Organization': organizationId }
    const response = await api.get(`/organizations/${organizationId}/dashboard/summary`, withSignal({ headers, timeout: 30000 }, signal))
    if (response.data.report?.organizationId !== organizationId) throw new Error('Incomplete report')
    if (!isCurrent()) throw new Error('Context changed')
    return response
  },
  reportPage: ({ organizationId, cursor, signal }) => api.get('/applications/report', withSignal({ params: { cursor }, headers: { 'X-C4G-Organization': organizationId }, timeout: 30000 }, signal)),
  organizationReport: ({ organizationId, digest, signal }) => api.get('/applications/report.xlsx', withSignal({ params: { digest }, headers: { 'X-C4G-Organization': organizationId }, responseType: 'blob', timeout: 30000 }, signal)),
}

// ── Opportunities ─────────────────────────────────────────────────────────
export const privateOpportunitiesApi = {
  list: (params, signal) => api.get('/opportunities', { params, signal }),
  get: id => api.get(`/opportunities/${id}`),
}

// ── Applications ──────────────────────────────────────────────────────────
export function organizationDirectoryApi(organizationId) {
  const options={headers:{'X-C4G-Organization':organizationId},timeout:10000},root='/organization-directory'
  const read=(path,config={},signal)=>api.get(root+path,withSignal({...options,...config},signal))
  const write=(verb,path,body)=>api[verb](root+path,body,options)
  return {
    context:signal=>read('',{},signal),units:signal=>read('/units',{},signal),
    people:(params,signal)=>read('/people',{params},signal),
    person:(id,signal)=>read('/people/'+id,{},signal),self:signal=>read('/me',{},signal),
    membershipBilling:(id,body)=>write('put',`/memberships/${id}/billing`,body),
    membershipStatus:(id,body)=>write('put',`/memberships/${id}/status`,body),
    membershipProfile:(id,body)=>write('put',`/memberships/${id}/profile`,body),
    access:signal=>read('/access',{},signal),
    memberships:signal=>read('/memberships',{},signal),
    matching:(params,signal)=>read('/matching',{params,timeout:60000},signal),
    personProfileEdit:(id,body)=>write('put',`/people/${id}/profile`,body),
    personLinkEdit:(id,body)=>write('put',`/people/${id}/account`,body),selfEdit:body=>write('put','/me',body),
    profileEdit:body=>write('put','',body),descriptionEdit:body=>write('put','/description',body),strategyEdit:body=>write('put','/strategy',body),registrationProfile:body=>write('put','/registration',body),registrationContacts:body=>write('put','/registration/contacts',body),unitCreate:body=>write('post','/units',body),
    unitRename:(id,body)=>write('put',`/units/${id}/name`,body),unitMove:(id,body)=>write('put',`/units/${id}/parent`,body),
    personCreate:body=>write('post','/people',body),personEdit:(id,body)=>write('put',`/people/${id}`,body),
  }
}

const applicationContext = (organizationId, signal) => withSignal(organizationId ? {headers:{'X-C4G-Organization':organizationId}} : {}, signal)
export const opportunityInterestsApi = {
  context: (organizationId, signal) => api.get('/opportunity-interests/context', applicationContext(organizationId, signal)),
  units: (params, organizationId, signal) => api.get('/opportunity-interests/units', { params, ...applicationContext(organizationId, signal) }),
  summaries: (ids, organizationId, signal) => api.get('/opportunity-interests/summaries', { params: { opportunityIds: ids.join(',') }, ...applicationContext(organizationId, signal) }),
  list: (params, organizationId, signal) => api.get('/opportunity-interests', { params, ...applicationContext(organizationId, signal) }),
  get: (id, organizationId, signal) => api.get(`/opportunity-interests/${id}`, applicationContext(organizationId, signal)),
  history: (id, params, organizationId, signal) => api.get(`/opportunity-interests/${id}/history`, { params, ...applicationContext(organizationId, signal) }),
  create: (body, organizationId) => api.post('/opportunity-interests', body, applicationContext(organizationId)),
  edit: (id, body, organizationId) => api.put(`/opportunity-interests/${id}`, body, applicationContext(organizationId)),
  archive: (id, body, organizationId) => api.post(`/opportunity-interests/${id}/archive`, body, applicationContext(organizationId)),
}
// The interceptor coordinates direct reads and writes with context changes,
// except context-change requests and document uploads; retries retain their lease.
const inSessionContext = work => work()
export const privateApplicationsApi = {
  unitOptions: (organizationId, signal) => inSessionContext(() => api.get('/applications/units', applicationContext(organizationId, signal))),
  partnersBrowse: (params, organizationId, signal) => api.get('/applications/partners', { params, ...applicationContext(organizationId, signal) }),
  partnersGet: (id, params, organizationId, signal) => api.get(`/applications/${id}/partners`, { params, ...applicationContext(organizationId, signal) }),
  partnersHistory: (id, params, organizationId, signal) => api.get(`/applications/${id}/partners/history`, { params, ...applicationContext(organizationId, signal) }),
  partnerCreate: (id, body, organizationId) => api.post(`/applications/${id}/partners`, body, applicationContext(organizationId)),
  partnerEdit: (id, body, organizationId) => api.put(`/applications/${id}/partners`, body, applicationContext(organizationId)),
  partnerRemove: (id, body, organizationId) => api.post(`/applications/${id}/partners/remove`, body, applicationContext(organizationId)),
  browse: (params, organizationId, signal) => api.get('/applications/browse', { params, ...applicationContext(organizationId, signal) }),
  browsePage: (params, organizationId, signal) => api.get('/applications/browse-page', { params, ...applicationContext(organizationId, signal) }),
  opportunitySummaries: (opportunityIds, signal) => inSessionContext(() => api.get('/applications/opportunity-summaries', withSignal({ params: { opportunityIds: opportunityIds.join(',') } }, signal))),
  list: (params, signal) => inSessionContext(() => api.get('/applications', withSignal({ params }, signal))),
  get: (id, signal) => inSessionContext(() => api.get(`/applications/${id}`, withSignal({}, signal))),
  history: (id, params, signal) => inSessionContext(() => api.get(`/applications/${id}/history`, withSignal({ params }, signal))),
  responsibles: (params, signal) => inSessionContext(() => api.get('/applications/responsibles', withSignal({ params }, signal))),
  create: (body, organizationId) => api.post('/applications', body, applicationContext(organizationId)),
  edit: (id, body, organizationId) => api.put(`/applications/${id}`, body, applicationContext(organizationId)),
  transition: (id, body, organizationId) => api.post(`/applications/${id}/transitions`, body, applicationContext(organizationId)),
  myWork: (params, organizationId, signal) => api.get('/applications/my-work', { params, ...applicationContext(organizationId, signal) }),
  calendar: (params, organizationId, signal) => api.get('/applications/calendar', { params, ...applicationContext(organizationId, signal) }),
  work: (id, params, signal) => inSessionContext(() => api.get(`/applications/${id}/work`, withSignal({ params }, signal))),
  workHistory: (id, params, signal) => inSessionContext(() => api.get(`/applications/${id}/work/history`, withSignal({ params }, signal))),
  chat: (id, params, organizationId, signal) => api.get(`/applications/${id}/work/chat`, { params, ...applicationContext(organizationId, signal) }),
  chatSend: (id, body, organizationId, signal) => api.post(`/applications/${id}/work/chat`, body, applicationContext(organizationId, signal)),
  participantAdd: (id, body) => inSessionContext(() => api.post(`/applications/${id}/work/participants`, body)),
  participantRemove: (id, body) => inSessionContext(() => api.post(`/applications/${id}/work/participants/remove`, body)),
  taskCreate: (id, body) => inSessionContext(() => api.post(`/applications/${id}/work/tasks`, body)),
  taskEdit: (id, body) => inSessionContext(() => api.put(`/applications/${id}/work/tasks`, body)),
  taskComplete: (id, body) => inSessionContext(() => api.post(`/applications/${id}/work/tasks/complete`, body)),
  taskCancel: (id, body) => inSessionContext(() => api.post(`/applications/${id}/work/tasks/cancel`, body)),
  taskDelete: (id, body) => inSessionContext(() => api.post(`/applications/${id}/work/tasks/delete`, body)),
  documents: (id, params, signal) => inSessionContext(() => api.get(`/applications/${id}/documents`, withSignal({ params }, signal))),
  documentCandidates: (id, params, signal) => inSessionContext(() => api.get(`/applications/${id}/documents/candidates`, withSignal({ params }, signal))),
  documentHistory: (id, params, signal) => inSessionContext(() => api.get(`/applications/${id}/documents/history`, withSignal({ params }, signal))),
  documentUploadIntent: (id, body) => inSessionContext(() => api.post(`/applications/${id}/documents/upload-intents`, body)),
  documentUpload: (id, versionId, capability, file, signal) => api.put(`/applications/${id}/documents/uploads/${versionId}`, file, withSignal({ headers: { 'Content-Type': file.type, 'X-C4G-Upload-Capability': capability }, timeout: 10 * 60 * 1000 }, signal)),
  documentLink: (id, body) => inSessionContext(() => api.post(`/applications/${id}/documents/links`, body)),
  documentDelete: (id, documentId, versionId) => inSessionContext(() => api.delete(`/applications/${id}/documents/${documentId}/versions/${versionId}`)),
  documentRemove: (id, body) => inSessionContext(() => api.post(`/applications/${id}/documents/remove`, body)),
  reviewRequest: (id, body, organizationId) => api.post(`/applications/${id}/documents/reviews`, body, applicationContext(organizationId)),
  reviewReviewers: (id, params, organizationId, signal) => api.get(`/applications/${id}/documents/reviewers`, {params,...applicationContext(organizationId,signal)}),
  assignedReviews: (params, organizationId, signal) => api.get('/applications/assigned-reviews', {params,...applicationContext(organizationId,signal)}),
  reviewDecide: (id, body) => inSessionContext(() => api.post(`/applications/${id}/documents/reviews/decide`, body)),
  documentDownload: (id, versionId) => documentDownloadPath(id, versionId, apiBaseUrl),
}

// ── Partners ───────────────────────────────────────────────────────────────
// The expected organization prevents a request crossing a context switch.
// It is a precondition only; authority remains resolved by the server.
export const organizationNotificationsApi = {
  refreshList: (params, organizationId) => api.post('/notifications/refresh-list', params, applicationContext(organizationId)),
  noticeContext: (organizationId, signal) => api.get('/notifications/communication/context', applicationContext(organizationId, signal)),
  noticeHistory: (params, organizationId, signal) => api.get('/notifications/communication/history', { params, ...applicationContext(organizationId, signal) }),
  noticeGet: (id, organizationId, signal) => api.get(`/notifications/communication/${id}`, applicationContext(organizationId, signal)),
  noticeSend: (body, organizationId) => api.post('/notifications/communication', body, applicationContext(organizationId)),
  refresh: organizationId => api.post('/notifications/check-deadlines', {}, applicationContext(organizationId)),
  list: (params, organizationId, signal) => api.get('/notifications', { params, ...applicationContext(organizationId, signal) }),
  markRead: (id, organizationId) => api.patch(`/notifications/${id}/read`, {}, applicationContext(organizationId)),
  markAllRead: organizationId => api.patch('/notifications/read-all', {}, applicationContext(organizationId)),
}

// ── Imports ───────────────────────────────────────────────────────────────
export const platformImportsApi = {
  availability: signal => api.get('/admin/directory/imports/portugal2030', { timeout: 15000, signal }),
  upload: body => api.post('/admin/directory/imports/portugal2030/xlsx', body, { timeout: 180000 }),
  get: id => api.get(`/admin/directory/imports/portugal2030/${id}`, { timeout: 30000 }),
  preview: (id, body) => api.post(`/admin/directory/imports/portugal2030/${id}/preview`, body, { timeout: 180000 }),
  stage: (id, body) => api.post(`/admin/directory/imports/portugal2030/${id}/stage`, body, { timeout: 180000 }),
  review: importId => api.get(`/admin/directory/imports/portugal2030/staged/${importId}`, { timeout: 180000 }),
  accept: (importId, body) => api.post(`/admin/directory/imports/portugal2030/staged/${importId}/accept`, body, { timeout: 300000 }),
}
export const importsApi = {
  upload: fd => api.post('/imports/xlsx', fd, { headers: { 'Content-Type': 'multipart/form-data' } }),
  preview: (id, sheetName, headerDecisions = {}) => api.post(`/imports/${id}/preview`, { sheetName, headerDecisions }),
  confirm: id => api.post(`/imports/${id}/confirm`, {}),
  list: () => api.get('/imports'),
  // UPLOADED/READY_FOR_CONFIRMATION also return verified sheet choices for resume.
  get: id => api.get(`/imports/${id}`),
  cancel: id => api.post(`/imports/${id}/cancel`, {}),
  review: (id, line, decision) => api.post(`/imports/${id}/possible/${line}/review`, { decision }),
  report: id => api.get(`/imports/${id}/report`, { responseType: 'blob' }),
}
const pq1Root = '/organizational-profile/pq1-publication'
export const pq1Api = {
  session: work => inSessionContext(work),
  context: signal => inSessionContext(() => api.get(pq1Root + '/context', withSignal({}, signal))),
  list: (kind, params, signal) => inSessionContext(() => api.get(pq1Root + '/' + kind, withSignal({ params }, signal))),
  get: (kind, id, signal) => inSessionContext(() => api.get(pq1Root + '/' + kind + '/' + id, withSignal({}, signal))),
  create: body => inSessionContext(() => api.post(pq1Root + '/drafts', body)),
  edit: (id, body) => inSessionContext(() => api.put(pq1Root + '/drafts/' + id + '/items', body)),
  competencies: (id, body) => inSessionContext(() => api.put(pq1Root + '/drafts/' + id + '/competencies', body)),
  experiences: (id, body) => inSessionContext(() => api.put(pq1Root + '/drafts/' + id + '/experiences', body)),
  attach: (id, body) => inSessionContext(() => api.post(pq1Root + '/drafts/' + id + '/evidence-links', body)),
  verify: (id, body) => inSessionContext(() => api.post(pq1Root + '/drafts/' + id + '/verifications', body)),
  revoke: (id, body) => inSessionContext(() => api.post(pq1Root + '/verifications/' + id + '/revoke', body)),
  documents: (id, experienceId, params, signal) => inSessionContext(() => api.get(`${pq1Root}/drafts/${id}/experiences/${experienceId}/documents`, withSignal({ params }, signal))),
  submit: (id, body) => inSessionContext(() => api.post(pq1Root + '/drafts/' + id + '/submit', body)),
  approve: (id, body) => inSessionContext(() => api.post(pq1Root + '/candidates/' + id + '/approve', body)),
  publish: (id, body) => inSessionContext(() => api.post(pq1Root + '/versions/' + id + '/publish', body)),
  lookup: (body, timeout = 10000) => inSessionContext(() => api.post(pq1Root + '/intentions/lookup', body, { timeout })),
  stepUp: (...args) => editorialApi.stepUp(...args),
}

export const fundingTendersApi = {
  status: () => api.get('/admin/integrations/funding-tenders'),
  update: (requestId, source = 'EU_FUNDING_TENDERS') => api.post('/admin/integrations/funding-tenders', { requestId, source }),
}
// Administration uses the existing server session and CSRF interceptor. There
// is deliberately no publication/accept operation in this preparation client.
const opportunityActivationRoot = '/admin/opportunity-activation'
export const opportunityActivationApi = {
  list: (params = {}, signal) => api.get(`${opportunityActivationRoot}/plans`, withSignal({ params }, signal)),
  get: (planId, signal) => api.get(`${opportunityActivationRoot}/plans/${encodeURIComponent(planId)}`, withSignal({}, signal)),
  prepare: body => api.post(`${opportunityActivationRoot}/plans`, body),
  approve: (planId, body) => api.post(`${opportunityActivationRoot}/plans/${encodeURIComponent(planId)}/approve`, body),
  revoke: (planId, body) => api.post(`${opportunityActivationRoot}/plans/${encodeURIComponent(planId)}/revoke`, body),
  euStatus: signal => api.get(`${opportunityActivationRoot}/sources/eu`, withSignal({}, signal)),
  suspendEu: body => api.post(`${opportunityActivationRoot}/sources/eu/suspend`, body),
  quiesceEu: body => api.post(`${opportunityActivationRoot}/sources/eu/quiesce`, body),
  resumeEu: body => api.post(`${opportunityActivationRoot}/sources/eu/resume`, body),
  configureEuWriter: body => api.post(`${opportunityActivationRoot}/sources/eu/writer`, body),
  euWriterReviews: (params = {}, signal) => api.get(`${opportunityActivationRoot}/eu-writer/reviews`, withSignal({ params }, signal)),
  euWriterWindow: (windowId, signal) => api.get(`${opportunityActivationRoot}/eu-writer/windows/${encodeURIComponent(windowId)}`, withSignal({}, signal)),
  approveEuWriterWindow: (windowId, body) => api.post(`${opportunityActivationRoot}/eu-writer/windows/${encodeURIComponent(windowId)}/approve`, body),
  euReconciliation: (planId, signal) => api.get(`${opportunityActivationRoot}/eu-writer/reconciliations/${encodeURIComponent(planId)}`, withSignal({}, signal)),
  approveEuReconciliation: (planId, body) => api.post(`${opportunityActivationRoot}/eu-writer/reconciliations/${encodeURIComponent(planId)}/approve`, body),
  executeEuReconciliation: (planId, body) => api.post(`${opportunityActivationRoot}/eu-writer/reconciliations/${encodeURIComponent(planId)}/execute`, body),
  euLegacyPreapproval: (packageId, itemDigest, signal) => api.get(`${opportunityActivationRoot}/eu-legacy/preapprovals/${encodeURIComponent(packageId)}/${encodeURIComponent(itemDigest)}`, withSignal({}, signal)),
  euLegacyQueue: (packageId, signal) => api.get(`${opportunityActivationRoot}/eu-legacy/preapprovals/${encodeURIComponent(packageId)}`, withSignal({}, signal)),
  approveEuLegacyPrearchive: (packageId, itemDigest, body) => api.post(`${opportunityActivationRoot}/eu-legacy/preapprovals/${encodeURIComponent(packageId)}/${encodeURIComponent(itemDigest)}/approve`, body),
  euLegacyAcceptanceQueue: (packageId, signal) => api.get(`${opportunityActivationRoot}/eu-legacy/acceptance/${encodeURIComponent(packageId)}`, withSignal({}, signal)),
  euLegacyAcceptanceItem: (packageId, itemDigest, signal) => api.get(`${opportunityActivationRoot}/eu-legacy/acceptance/${encodeURIComponent(packageId)}/${encodeURIComponent(itemDigest)}`, withSignal({}, signal)),
  prepareEuLegacyAcceptance: (packageId, itemDigest, body) => api.post(`${opportunityActivationRoot}/eu-legacy/acceptance/${encodeURIComponent(packageId)}/${encodeURIComponent(itemDigest)}/prepare`, body),
  approveEuLegacyAcceptance: (packageId, itemDigest, body) => api.post(`${opportunityActivationRoot}/eu-legacy/acceptance/${encodeURIComponent(packageId)}/${encodeURIComponent(itemDigest)}/approve`, body),
  acceptEuLegacyCandidate: (packageId, itemDigest, body) => api.post(`${opportunityActivationRoot}/eu-legacy/acceptance/${encodeURIComponent(packageId)}/${encodeURIComponent(itemDigest)}/accept`, body),
  collect11145: (body, signal) => api.post(`${opportunityActivationRoot}/calls/11145/collect`, body, withSignal({ timeout: 45000 }, signal)),
  prepare11145: body => api.post(`${opportunityActivationRoot}/calls/11145/plans`, body),
  accept11145: (planId, body) => api.post(`${opportunityActivationRoot}/calls/11145/plans/${encodeURIComponent(planId)}/accept`, body),
}
export const centralOpportunitiesApi = {
  list: (query, signal) => api.get('/central-opportunities', withSignal({ params: typeof query === 'string' ? { cursor: query } : query || {} }, signal)),
  get: (id, signal) => api.get(`/central-opportunities/${id}`, withSignal({}, signal)),
}
export const platformCentralOpportunitiesApi = {
  create: body => api.post('/admin/central-opportunities', body),
  list: (query, signal) => api.get('/admin/central-opportunities', withSignal({ params: query || {} }, signal)),
  get: (id, signal) => api.get(`/admin/central-opportunities/${id}`, withSignal({}, signal)),
}

// Context-dependent work runs concurrently but remains ordered around context changes.
const activationRoot='/organizational-profile/pq1-activation'
export const prequalificationApi={
 decisions:(id,cursor,signal)=>inSessionContext(()=>api.get('/opportunities/prequalifications/'+id+'/decisions',withSignal({params:cursor?{cursor}:{},timeout:10000},signal))),
 decide:(id,body)=>inSessionContext(()=>api.post('/opportunities/prequalifications/'+id+'/decisions',body,{timeout:10000})),
 session:work=>inSessionContext(work),
 context:(cursor,signal)=>inSessionContext(()=>api.get(activationRoot+'/context',withSignal({params:cursor?{cursor}:{},timeout:10000},signal))),
 preview:versionId=>inSessionContext(()=>api.post(activationRoot+'/preview',{versionId},{timeout:10000})),
 activate:body=>inSessionContext(()=>api.post(activationRoot+'/activate',body,{timeout:10000})),
 active:signal=>inSessionContext(()=>api.get(activationRoot+'/active',withSignal({timeout:10000},signal))),
 snapshot:(id,signal)=>inSessionContext(()=>api.get(activationRoot+'/snapshots/'+id,withSignal({timeout:10000},signal))),
 history:(cursor,signal)=>inSessionContext(()=>api.get(activationRoot+'/activations',withSignal({params:cursor?{cursor}:{},timeout:10000},signal))),
 lookup:body=>inSessionContext(()=>api.post(activationRoot+'/intentions/lookup',body,{timeout:10000})),
 criteria:(id,signal)=>inSessionContext(()=>api.get('/opportunities/'+id+'/criteria',withSignal({timeout:10000},signal))),
 evaluate:(id,body)=>inSessionContext(()=>api.post('/opportunities/'+id+'/prequalifications',body,{timeout:10000})),
 result:(id,signal)=>inSessionContext(()=>api.get('/opportunities/prequalifications/'+id,withSignal({timeout:10000},signal))),
 stepUp:(...args)=>editorialApi.stepUp(...args),
}

export const catalogReadApi = (path, params, signal) => api.get(`/catalog-read/v1${path}`, { params, signal, catalogRead: true }).then(response => response.data)

export function customerBillingApi(organizationId) {
  const get = (path, params, signal) => api.get('/billing' + path, {params,signal,headers:{'X-C4G-Organization':organizationId}})
  return {
    access: signal => get('/access',undefined,signal),
    summary: signal => get('/summary',undefined,signal),
    invoices: (params,signal) => get('/invoices',params,signal),
    invoice: (id,signal) => get('/invoices/'+encodeURIComponent(id),undefined,signal),
  }
}

export function billingFilesApi(organizationId, platform=false) {
  const root=platform?'/admin/billing':'/billing'
  const options=signal=>({signal,headers:platform?{}:{'X-C4G-Organization':organizationId}})
  return {
    list:(id,signal)=>api.get(`${root}/documents/${id}/pdf`,options(signal)),
    download:(id,versionId,signal)=>api.get(`${root}/documents/${id}/pdf/${versionId}`,{...options(signal),responseType:'blob',timeout:120000}),
    upload:(id,file,command,signal)=>api.put(`${root}/documents/${id}/pdf`,file,{...options(signal),timeout:120000,headers:{...options(signal).headers,'Content-Type':'application/pdf','X-PDF-Filename':encodeURIComponent(file.name),'X-Request-Id':command.requestId,'X-PDF-Revision':String(command.expectedVersion)}}),
  }
}
