import React from 'react'
import {it,expect,vi,afterEach} from 'vitest'
import {render,screen,cleanup,act} from '@testing-library/react'
import routePage from './RoutePage'
afterEach(()=>{cleanup();vi.restoreAllMocks()})
it('loads only when rendered, announces loading and reuses the loaded page',async()=>{
  let resolve
  const load=vi.fn(()=>new Promise(r=>{resolve=r})), Page=routePage(load)
  expect(load).not.toHaveBeenCalled()
  const view=render(<Page label="First" />)
  expect(screen.getByRole('status').textContent).toContain('A carregar página')
  expect(screen.getByRole('status').querySelector('svg[aria-hidden="true"]')).toBeTruthy()
  await act(async()=>resolve({default:({label})=><h2>{label}</h2>}))
  expect(screen.getByRole('heading').textContent).toBe('First')
  view.rerender(<Page label="Second" />)
  expect(screen.getByRole('heading').textContent).toBe('Second')
  expect(load).toHaveBeenCalledTimes(1)
})
it('offers reload when a route module cannot be downloaded',async()=>{
  vi.spyOn(console,'error').mockImplementation(()=>{})
  const Page=routePage(()=>Promise.reject(Error('Synthetic chunk failure')))
  render(<Page />)
  expect(await screen.findByRole('alert')).toBeTruthy()
  expect(screen.getByRole('button',{name:'Recarregar página'})).toBeTruthy()
})
