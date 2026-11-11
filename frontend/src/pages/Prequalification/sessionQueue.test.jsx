import {it,expect,vi,afterEach} from 'vitest'
import axios from 'axios'
import api,{authApi,prequalificationApi} from '../../api/api'
afterEach(()=>vi.restoreAllMocks())
it('organization rotation cancels previous PQ1 reads and holds subsequent PQ1 work',async()=>{
 vi.spyOn(axios,'get').mockResolvedValue({data:{csrfToken:'test'}})
 let releaseRotation,readStarted=false,historyStarted=false
 api.defaults.adapter=config=>{
  if(config.url.endsWith('/active')){readStarted=true;return new Promise((resolve,reject)=>config.signal.addEventListener('abort',()=>reject(new axios.CanceledError('old',config)),{once:true}))}
  if(config.url==='/auth/organization')return new Promise(resolve=>{releaseRotation=()=>resolve({config,status:200,data:{csrfToken:'new'}})})
  historyStarted=true;return Promise.resolve({config,status:200,data:{}})
 }
 const read=prequalificationApi.active();read.catch(()=>{})
 await vi.waitFor(()=>expect(readStarted).toBe(true))
 const rotation=authApi.selectOrganization('organization-B'),history=prequalificationApi.history()
 await vi.waitFor(()=>expect(releaseRotation).toBeTypeOf('function'))
 await expect(read).rejects.toMatchObject({code:'ERR_CANCELED'});expect(historyStarted).toBe(false)
 releaseRotation();await rotation;await history;expect(historyStarted).toBe(true)
})
