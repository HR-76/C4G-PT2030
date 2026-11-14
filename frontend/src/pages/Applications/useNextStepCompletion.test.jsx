import {afterEach,beforeEach,expect,it} from 'vitest'
import {act,cleanup,renderHook} from '@testing-library/react'
import useNextStepCompletion from './useNextStepCompletion'

beforeEach(()=>sessionStorage.clear())
afterEach(cleanup)
it.each(['team','partners','documents'])('remembers confirmed %s work only for its user, organization, application and phase',action=>{
 const initial=['user','org','application','PREPARATION','2026-11-14']
 const {result,rerender,unmount}=renderHook(args=>useNextStepCompletion(...args),{initialProps:initial})
 expect(result.current.completed).toBe(false)
 act(()=>result.current.complete(action))
 expect(result.current.completed).toBe(true)
 for(const index of [0,1,2,3,4]){
  const other=[...initial];other[index]='other'
  rerender(other)
  expect(result.current.completed).toBe(false)
 }
 unmount()
 const reopened=renderHook(()=>useNextStepCompletion(...initial))
 expect(reopened.result.current.completed).toBe(true)
})
it('keeps preparation guidance after an unrelated edit',()=>{
 const {result}=renderHook(()=>useNextStepCompletion('user','org','application','PREPARATION'))
 act(()=>result.current.complete('edit'))
 expect(result.current.completed).toBe(false)
})
