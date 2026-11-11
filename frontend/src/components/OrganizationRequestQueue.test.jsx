import {expect,it,vi} from 'vitest'

const http=vi.hoisted(()=>({
 get:vi.fn(),post:vi.fn(),put:vi.fn(),patch:vi.fn(),
 interceptors:{request:{use:vi.fn()},response:{use:vi.fn()}},
}))
vi.mock('axios',()=>({default:{create:()=>http}}))

const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no});return{promise,resolve,reject}}
async function freshApi(){
 vi.resetModules()
 for(const method of ['get','post','put','patch'])http[method].mockReset()
 return import('../api/api')
}

it('starts independent reads concurrently and a slow read does not block another',async()=>{
 const slow=deferred(),fast=deferred()
 const {privateApplicationsApi}=await freshApi()
 http.get.mockImplementation(url=>url.endsWith('/history')?fast.promise:slow.promise)
 const detail=privateApplicationsApi.get('application-a')
 const history=privateApplicationsApi.history('application-a')
 await vi.waitFor(()=>expect(http.get).toHaveBeenCalledTimes(2))
 fast.resolve({data:{items:[]}})
 await expect(history).resolves.toEqual({data:{items:[]}})
 slow.resolve({data:{applicationId:'application-a'}})
 await detail
})

it('does not let an application upload block a GET',async()=>{
 const upload=deferred()
 const {privateApplicationsApi}=await freshApi()
 http.put.mockReturnValue(upload.promise)
 http.get.mockResolvedValue({data:{applicationId:'application-a'}})
 const pendingUpload=privateApplicationsApi.documentUpload('application-a','version-a','capability',{type:'application/pdf'})
 const detail=privateApplicationsApi.get('application-a')
 await expect(detail).resolves.toEqual({data:{applicationId:'application-a'}})
 expect(http.put).toHaveBeenCalledOnce()
 expect(http.get).toHaveBeenCalledOnce()
 upload.resolve({data:{accepted:true}})
 await pendingUpload
})

it('serializes organization context changes in admission order',async()=>{
 const first=deferred()
 const {authApi}=await freshApi()
 http.post.mockImplementationOnce(()=>first.promise).mockResolvedValueOnce({data:{organizationId:'organization-b'}})
 const changeA=authApi.selectOrganization('organization-a')
 const changeB=authApi.selectOrganization('organization-b')
 await vi.waitFor(()=>expect(http.post).toHaveBeenCalledTimes(1))
 first.resolve({data:{organizationId:'organization-a'}})
 await changeA
 await expect(changeB).resolves.toEqual({data:{organizationId:'organization-b'}})
 expect(http.post.mock.calls.map(call=>call[1].organizationId)).toEqual(['organization-a','organization-b'])
})

it('does not hold an explicitly scoped organization read behind a context change',async()=>{
 const rotation=deferred()
 const {authApi,organizationDirectoryApi}=await freshApi()
 http.post.mockReturnValue(rotation.promise)
 http.get.mockResolvedValue({data:{organizationId:'organization-a'}})
 const pendingRotation=authApi.selectOrganization('organization-b')
 await vi.waitFor(()=>expect(http.post).toHaveBeenCalledOnce())
 await expect(organizationDirectoryApi('organization-a').context()).resolves.toEqual({data:{organizationId:'organization-a'}})
 rotation.resolve({data:{organizationId:'organization-b'}})
 await pendingRotation
})

it('releases subsequent context work after a failed organization change',async()=>{
 const {authApi}=await freshApi()
 http.post.mockRejectedValueOnce(new Error('Unavailable')).mockResolvedValueOnce({data:{organizationId:'organization-b'}})
 await expect(authApi.selectOrganization('organization-a')).rejects.toThrow('Unavailable')
 await expect(authApi.selectOrganization('organization-b')).resolves.toEqual({data:{organizationId:'organization-b'}})
})

it('lets an organization change proceed after rejected context work',async()=>{
 const {authApi,privateApplicationsApi}=await freshApi()
 http.get.mockRejectedValueOnce(new Error('Read failed'))
 http.post.mockResolvedValue({data:{organizationId:'organization-b'}})
 await expect(privateApplicationsApi.get('application-a')).rejects.toThrow('Read failed')
 await expect(authApi.selectOrganization('organization-b')).resolves.toEqual({data:{organizationId:'organization-b'}})
})

it('propagates AbortSignal without applying an upload timeout to reads',async()=>{
 const {privateApplicationsApi}=await freshApi(),controller=new AbortController()
 http.get.mockResolvedValue({data:{}})
 await privateApplicationsApi.get('application-a',controller.signal)
 expect(http.get).toHaveBeenCalledWith('/applications/application-a',{signal:controller.signal})
})
