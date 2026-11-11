import { afterEach, expect, it, vi } from 'vitest'
const state=vi.hoisted(()=>({get:vi.fn()}))
vi.mock('axios',()=>({default:{create:()=>({get:state.get,interceptors:{request:{use:vi.fn()},response:{use:vi.fn()}}})}}))
import { dashboardApi } from '../api/api'
afterEach(() => vi.resetAllMocks())
it('propagates cancellation and binds the dashboard read to the requested organization', async () => {
 const controller = new AbortController()
 state.get.mockResolvedValue({ data: { report: { organizationId: 'org' } } })
 await dashboardApi.organization({ organizationId: 'org', isCurrent: () => true, signal: controller.signal })
 expect(state.get).toHaveBeenCalledWith('/organizations/org/dashboard/summary', {
  headers: { 'X-C4G-Organization': 'org' }, timeout: 30000, signal: controller.signal,
 })
})
it('rejects a response from another organization or an obsolete request', async () => {
 state.get.mockResolvedValueOnce({ data: { report: { organizationId: 'other' } } })
 await expect(dashboardApi.organization({ organizationId: 'org', isCurrent: () => true })).rejects.toThrow('Incomplete report')
 let current = true
 state.get.mockImplementationOnce(async () => {
  current = false
  return { data: { report: { organizationId: 'org' } } }
 })
 await expect(dashboardApi.organization({ organizationId: 'org', isCurrent: () => current })).rejects.toThrow('Context changed')
})
it('starts the Excel download independently from a slow dashboard read and binds the expected organization',async()=>{
 let resolveReport
 const workbook=new Blob(['xlsx'],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'})
 state.get.mockImplementation(path=>{
  if(path==='/organizations/org/dashboard/summary')return new Promise(resolve=>{resolveReport=resolve})
  if(path==='/applications/report.xlsx')return Promise.resolve({data:workbook})
  return Promise.resolve({data:{items:[],nextCursor:null}})
 })
 const dashboard=dashboardApi.organization({organizationId:'org',isCurrent:()=>true})
 await vi.waitFor(()=>expect(resolveReport).toBeTypeOf('function'))
 const exportRequest=dashboardApi.organizationReport({organizationId:'org',digest:'digest'})
 await expect(exportRequest).resolves.toEqual({data:workbook})
 resolveReport({data:{report:{organizationId:'org',items:[],total:0,unitsAvailable:false}}})
 await dashboard
 expect(state.get).toHaveBeenCalledTimes(2)
 expect(state.get).toHaveBeenCalledWith('/applications/report.xlsx',expect.objectContaining({headers:{'X-C4G-Organization':'org'},params:{digest:'digest'},responseType:'blob'}))
})
