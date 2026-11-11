import React from 'react'
import {it, expect, vi, beforeEach, afterEach} from 'vitest'
import {render, screen, fireEvent, waitFor, cleanup, act} from '@testing-library/react'
import Pq1Details from './Pq1Details'
import {pq1Api} from '../../api/api'
vi.mock('../../api/api', () => ({pq1Api:{list:vi.fn(),documents:vi.fn()}}))
const record = {draftId:'draft', assertions:[], experiences:['A','B'].map(id=>({experienceId:id,versionId:id,typeRef:{entryId:'saved'},observedFrom:'',observedUntil:'',provenance:{recordedAt:''}}))}
const view = () => render(<Pq1Details record={record} editable disabled={false} onChange={()=>{}} onAction={()=>{}} />)
beforeEach(()=>{vi.resetAllMocks();pq1Api.list.mockImplementation((_,q)=>Promise.resolve({data:{items:[{entryId:q.kind+(q.cursor?'2':'1'),label:q.kind+(q.cursor?'2':'1')}],nextCursor:q.cursor?null:'next'}}))})
afterEach(cleanup)
it('loads one catalog page per kind and preserves stored selections outside loaded pages',async()=>{
  view();await screen.findByRole('option',{name:'VERIFICATION_METHOD1'})
  expect(pq1Api.list).toHaveBeenCalledTimes(3)
  expect(screen.getAllByLabelText('Tipo de experiência')[0].value).toBe('saved')
  fireEvent.click(screen.getByRole('button',{name:'Mais tipos de experiência'}))
  await screen.findAllByRole('option',{name:'EXPERIENCE_TYPE2'})
  expect(pq1Api.list).toHaveBeenCalledTimes(4)
  expect(pq1Api.list).toHaveBeenLastCalledWith('catalog',{kind:'EXPERIENCE_TYPE',cursor:'next'})
})
it('discards an old experience response and requests document pages only on demand',async()=>{
  let resolveA
  pq1Api.documents.mockImplementation((_,id,q)=>id==='A'?new Promise(r=>{resolveA=r}):Promise.resolve({data:{items:[{documentVersionId:q.cursor?'B2':'B1'}],nextCursor:q.cursor?null:'next'}}))
  view();await screen.findByRole('option',{name:'VERIFICATION_METHOD1'})
  const select=screen.getByLabelText('Experiência guardada')
  fireEvent.change(select,{target:{value:'A'}});fireEvent.change(select,{target:{value:'B'}})
  await screen.findByRole('option',{name:'B1'})
  await act(async()=>resolveA({data:{items:[{documentVersionId:'A1'}],nextCursor:'old'}}))
  expect(screen.queryByRole('option',{name:'A1'})).toBeNull()
  expect(pq1Api.documents).toHaveBeenCalledTimes(2)
  fireEvent.click(screen.getByRole('button',{name:'Mais documentos'}))
  await screen.findByRole('option',{name:'B2'})
  expect(screen.getByRole('option',{name:'B1'})).toBeTruthy()
  expect(pq1Api.documents).toHaveBeenLastCalledWith('draft','B',{cursor:'next'})
  await waitFor(()=>expect(screen.queryByRole('button',{name:'Mais documentos'})).toBeNull())
})
it('ignores a pending document response after clearing the experience',async()=>{
  let resolve
  pq1Api.documents.mockImplementation(()=>new Promise(r=>{resolve=r}))
  view();await screen.findByRole('option',{name:'VERIFICATION_METHOD1'})
  const select=screen.getByLabelText('Experiência guardada')
  fireEvent.change(select,{target:{value:'A'}});fireEvent.change(select,{target:{value:''}})
  await act(async()=>resolve({data:{items:[{documentVersionId:'A1'}],nextCursor:'next'}}))
  expect(screen.queryByRole('option',{name:'A1'})).toBeNull()
  expect(screen.queryByRole('button',{name:'Mais documentos'})).toBeNull()
})
