import {expect,it,vi} from 'vitest'
vi.mock('../../api/api',()=>({privateApplicationsApi:{partnersGet:vi.fn()}}))
import {pendingPoints} from './ApplicationPending'

const states=points=>Object.fromEntries(points.map(point=>[point.id,point.state]))
const ready=data=>({state:'ready',data})

it('lists the points of each phase and none after preparation',()=>{
 expect(pendingPoints('IDENTIFIED',{}).map(point=>point.id)).toEqual(['responsible','deadline'])
 expect(pendingPoints('INTENTION',{}).map(point=>point.id)).toEqual(['team'])
 expect(pendingPoints('PREPARATION',{}).map(point=>point.id)).toEqual(['team','partners','documents'])
 for(const status of ['SUBMITTED','APPROVED','REJECTED','CANCELLED','ARCHIVED'])expect(pendingPoints(status,{})).toEqual([])
})
it('ticks a point only from confirmed application data',()=>{
 const done=pendingPoints('PREPARATION',{},ready({participants:[{active:false},{active:true}]}),ready({documents:[{documentId:'d'}]}),{state:'ready',total:2})
 expect(states(done)).toEqual({team:'done',partners:'done',documents:'done'})
 const open=pendingPoints('PREPARATION',{},ready({participants:[{active:false}]}),ready({documents:[]}),{state:'ready',total:0})
 expect(states(open)).toEqual({team:'pending',partners:'pending',documents:'pending'})
 expect(states(pendingPoints('IDENTIFIED',{responsibleMembershipId:'m',deadline:null}))).toEqual({responsible:'done',deadline:'pending'})
})
it('never reports data that was not read as done or pending',()=>{
 expect(states(pendingPoints('PREPARATION',{},null,null,null))).toEqual({team:'loading',partners:'loading',documents:'loading'})
 const failed=pendingPoints('PREPARATION',{},{state:'unavailable',data:null},{state:'pending',data:null},{state:'unavailable'})
 expect(states(failed)).toEqual({team:'unavailable',partners:'unavailable',documents:'unavailable'})
 // More participants remain to be read: an empty first page does not prove the team is empty.
 expect(states(pendingPoints('INTENTION',{},ready({participants:[],participantNextCursor:'next'})))).toEqual({team:'loading'})
})
it('marks partners as optional',()=>{
 expect(pendingPoints('PREPARATION',{}).filter(point=>point.optional).map(point=>point.id)).toEqual(['partners'])
})
