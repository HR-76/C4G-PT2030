import { it, expect, vi, afterEach } from 'vitest'
import axios from 'axios'
import { createContextRequestCoordinator } from '../api/requestConcurrency'

afterEach(() => vi.restoreAllMocks())
const response = (config, data = {}) => ({ config, data, status: 200, headers: {} })
async function setup() {
  vi.resetModules()
  vi.spyOn(axios, 'get').mockResolvedValue({ data: { csrfToken: 'fresh' } })
  return import('../api/api')
}

it.each(['selectOrganization', 'logout'])('a hung GET cannot block %s even if transport ignores abort', async method => {
  const { default: api, authApi } = await setup()
  let readConfig, finish
  api.defaults.adapter = config => config.method === 'get'
    ? new Promise(resolve => { readConfig = config; finish = () => resolve(response(config)) })
    : Promise.resolve(response(config, { csrfToken: 'rotated', organization: { id: 'B' } }))
  const read = api.get('/applications'); read.catch(() => {})
  await vi.waitFor(() => expect(readConfig).toBeTruthy())
  const started = performance.now()
  await authApi[method]('B')
  expect(performance.now() - started).toBeLessThan(1500)
  expect(readConfig.signal.aborted).toBe(true)
  expect(readConfig.timeout).toBe(15000)
  finish()
  await expect(read).rejects.toMatchObject({ code: 'ERR_CANCELED' })
})

it('serializes rotations, holds new work and leaves independent reads concurrent', async () => {
  const coordinator = createContextRequestCoordinator({ drainMs: 1 })
  const [a, b] = await Promise.all([coordinator.acquire({ read: true }), coordinator.acquire({ read: true })])
  let release
  const rotation = coordinator.change(() => new Promise(resolve => { release = resolve }))
  expect(a.signal.aborted && b.signal.aborted).toBe(true)
  const admitted = vi.fn()
  const next = coordinator.acquire({ read: true }).then(lease => { admitted(); lease.release() })
  await vi.waitFor(() => expect(release).toBeTruthy())
  expect(admitted).not.toHaveBeenCalled()
  release(); await rotation; await next; a.release(); b.release()
})

it('never rotates across an in-flight write after bounded drainage', async () => {
  const coordinator = createContextRequestCoordinator({ drainMs: 1 }), write = await coordinator.acquire()
  const rotate = vi.fn()
  await expect(coordinator.change(rotate)).rejects.toMatchObject({ code: 'SESSION_BUSY' })
  expect(rotate).not.toHaveBeenCalled(); write.release()
  await coordinator.change(rotate); expect(rotate).toHaveBeenCalledOnce()
})

it.each([true, false])('CSRF_INVALID refreshes once and retries at most once (success=%s)', async succeeds => {
  const { default: api } = await setup()
  const tokens = []
  axios.get.mockResolvedValueOnce({ data: { csrfToken: 'old' } }).mockResolvedValue({ data: { csrfToken: 'new' } })
  api.defaults.adapter = async config => {
    tokens.push(config.headers['X-CSRF-Token'])
    if (tokens.length === 1 || !succeeds) throw Object.assign(new Error('rejected'), { config, response: { status: 403, data: { error: { code: 'CSRF_INVALID' } } } })
    return response(config, { saved: true })
  }
  if (succeeds) await expect(api.post('/applications', {})).resolves.toMatchObject({ data: { saved: true } })
  else await expect(api.post('/applications', {})).rejects.toThrow('rejected')
  expect(tokens).toEqual(['old', 'new']); expect(axios.get).toHaveBeenCalledTimes(2)
})

it.each([403, 503])('does not retry non-CSRF errors (%s)', async status => {
  const { default: api } = await setup(), adapter = vi.fn(async config => { throw Object.assign(new Error('failed'), { config, response: { status, data: { error: { code: 'DENIED' } } } }) })
  api.defaults.adapter = adapter
  await expect(api.post('/applications', {})).rejects.toThrow('failed')
  expect(adapter).toHaveBeenCalledOnce()
})
it('uses the CSRF token returned by organization rotation for the next write', async () => {
  const { default: api, authApi } = await setup(), tokens = []
  api.defaults.adapter = async config => { tokens.push(config.headers['X-CSRF-Token']); return response(config, { csrfToken: 'rotated' }) }
  await authApi.selectOrganization('B'); await api.post('/applications', {})
  expect(tokens).toEqual(['fresh', 'rotated']); expect(axios.get).toHaveBeenCalledOnce()
})
it('a CSRF retry retains its lease so it cannot cross an organization rotation', async () => {
  const { default: api, authApi } = await setup()
  let refresh, writes = 0, rotations = 0
  axios.get.mockResolvedValueOnce({ data: { csrfToken: 'old' } }).mockImplementationOnce(() => new Promise(resolve => { refresh = resolve }))
  api.defaults.adapter = async config => {
    if (config.url === '/auth/organization') { rotations++; return response(config) }
    if (++writes === 1) throw Object.assign(new Error('csrf'), { config, response: { status: 403, data: { error: { code: 'CSRF_INVALID' } } } })
    return response(config)
  }
  const pending = api.post('/applications', {})
  await vi.waitFor(() => expect(refresh).toBeTypeOf('function'))
  await expect(authApi.selectOrganization('B')).rejects.toMatchObject({ code: 'SESSION_BUSY' })
  expect(rotations).toBe(0)
  refresh({ data: { csrfToken: 'new' } }); await pending; expect(writes).toBe(2)
})

it('preserves application recovery envelopes after HTTP 401 without retrying the request',async()=>{
 sessionStorage.clear()
 const keys=['c4g.application.intention.v1:A:org','c4g.application.work.intention.v1:A:org:app','c4g.application.partners.intention.v1:A:org:app','c4g.application.documents.intention.v1:A:org:app','c4g.application.documents.intention.v1:A:org:app:upload']
 const intent=JSON.stringify({userId:'A',organizationId:'org',applicationId:'app',idempotencyKey:'stable',payload:{expectedRevision:1}})
 keys.forEach(key=>sessionStorage.setItem(key,intent))
 const {default:api}=await setup(),adapter=vi.fn(async config=>{throw Object.assign(new Error('expired'),{config,response:{status:401,data:{error:{code:'SESSION_EXPIRED'}}}})})
 api.defaults.adapter=adapter
 await expect(api.post('/applications/app/work/tasks/complete',{})).rejects.toThrow('expired')
 expect(adapter).toHaveBeenCalledTimes(1)
 keys.forEach(key=>expect(sessionStorage.getItem(key)).toBe(intent));sessionStorage.clear()
})
