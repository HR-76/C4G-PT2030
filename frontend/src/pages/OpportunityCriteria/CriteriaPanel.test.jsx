import React from 'react'
import { it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
const mocks=vi.hoisted(()=>({get:vi.fn(),post:vi.fn(),auth:{}}))
vi.mock('../../api/api',()=>({default:mocks}))
vi.mock('../../contexts/AuthContext',()=>({useAuth:()=>mocks.auth}))
import CriteriaPanel from './CriteriaPanel'
const userId='00000000-0000-4000-8000-000000000001',a='00000000-0000-4000-8000-000000000002',b='00000000-0000-4000-8000-000000000003'
const auth=id=>({user:{id:userId},refreshSession:vi.fn().mockResolvedValue({user:{id:userId},organization:{id}})})
afterEach(()=>{cleanup();vi.clearAllMocks();sessionStorage.clear()})
it('shows access denial rather than claiming an empty authorized set',async()=>{
 mocks.auth=auth(a);mocks.get.mockRejectedValue({response:{status:403}})
 render(<CriteriaPanel opportunity={{opportunityId:a}} organization={{id:a}} />)
 expect((await screen.findByRole('alert')).textContent).toContain('autoriza\u00e7\u00e3o')
 expect(mocks.post).not.toHaveBeenCalled()
})
it('ignores a response from a previously unmounted organization',async()=>{
 let resolve;const late=new Promise(r=>{resolve=r});mocks.auth=auth(a);mocks.get.mockImplementationOnce(()=>late)
 const view=render(<CriteriaPanel key={a} opportunity={{opportunityId:a}} organization={{id:a}} />)
 await vi.waitFor(()=>expect(mocks.get).toHaveBeenCalledTimes(1))
 mocks.auth=auth(b);mocks.get.mockResolvedValue({data:{head:null,actions:{canEdit:false},items:[]}})
 view.rerender(<CriteriaPanel key={b} opportunity={{opportunityId:b}} organization={{id:b}} />)
 await screen.findByText('Ainda não existem interpretações nesta organização.')
 resolve({data:{head:{revisionId:a},actions:{canEdit:true}}})
 await vi.waitFor(()=>expect(screen.queryByText('Revisão dos critérios')).toBeNull())
 expect(mocks.get.mock.calls.filter(([path])=>path.includes('/revisions/'+a))).toHaveLength(0)
})
it('rereads the exact revision and refuses confirmation when the head changes',async()=>{
 mocks.auth=auth(a);let stale=false
 const record={revisionId:b,revisionNumber:1,opportunityRevisionId:a,state:'DRAFT',author:{displayLabel:'Synthetic'},createdAt:'2026-10-16T00:00:00.000Z',freshness:'CURRENT',criteria:[],sources:[],findings:[],actions:{canEdit:true,canConfirm:true}}
 mocks.get.mockImplementation(path=>Promise.resolve({data:path.endsWith('/criteria')?{head:{revisionId:stale?a:b,revisionNumber:1},opportunityRevisionId:a,actions:{canEdit:true}}:path.endsWith('/revisions/'+b)?record:{items:[]}}))
 render(<CriteriaPanel opportunity={{opportunityId:a,revisionId:a}} organization={{id:a}} />)
 const button=await screen.findByRole('button',{name:'Rever e confirmar revisão'})
 await vi.waitFor(()=>expect(button.disabled).toBe(false));stale=true;fireEvent.click(button)
 expect((await screen.findByRole('alert')).textContent).toContain('Volte a consultar')
 expect(screen.queryByRole('button',{name:'Confirmar interpretação editorial'})).toBeNull()
 expect(mocks.post).not.toHaveBeenCalled()
 expect(mocks.get.mock.calls.filter(([path])=>path.endsWith('/revisions/'+b))).toHaveLength(2)
})
