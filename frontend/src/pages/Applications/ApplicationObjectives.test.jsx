import {afterEach,beforeEach,expect,it,vi} from 'vitest'
import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react'
import {MemoryRouter} from 'react-router-dom'
const api=vi.hoisted(()=>({context:vi.fn(),strategyEdit:vi.fn()}))
vi.mock('../../api/api',()=>({organizationDirectoryApi:()=>api}))
import ApplicationObjectives from './ApplicationObjectives'

const first={id:'first',title:'Sustentabilidade Ambiental',target:'5 candidaturas',deadline:null,areaIds:['environment'],applicationIds:['other']}
const second={id:'second',title:'Saúde digital',target:'',deadline:'2027-12-31',areaIds:[]}
const context=(objectives=[first,second],edit=true,revision=4)=>({data:{permissions:{edit},
  profile:{revision,strategy:{areaIds:['environment'],interests:['Energia'],objectives}}}})
const mount=()=>render(<MemoryRouter><ApplicationObjectives applicationId="app" organizationId="org"/></MemoryRouter>)
beforeEach(()=>vi.clearAllMocks())
afterEach(cleanup)

it('links the application to the chosen objectives and keeps the other applications linked',async()=>{
  api.context.mockResolvedValue(context())
  api.strategyEdit.mockImplementation(async body=>({data:{strategy:{areaIds:body.areaIds,interests:body.interests,objectives:body.objectives},revision:5}}))
  mount()
  const save=await screen.findByRole('button',{name:'Guardar objetivos'})
  expect(save.disabled).toBe(true)
  fireEvent.click(screen.getByLabelText('Sustentabilidade Ambiental'))
  fireEvent.click(save)
  await screen.findByText('Objetivos guardados.')
  expect(api.strategyEdit).toHaveBeenCalledWith({areaIds:['environment'],interests:['Energia'],expectedRevision:4,idempotencyKey:expect.any(String),objectives:[
    {...first,applicationIds:['other','app']},{...second,applicationIds:[]}]})
  expect(screen.getByLabelText('Sustentabilidade Ambiental').checked).toBe(true)
  expect(screen.getByRole('button',{name:'Guardar objetivos'}).disabled).toBe(true)
  fireEvent.click(screen.getByLabelText('Sustentabilidade Ambiental'))
  fireEvent.click(screen.getByRole('button',{name:'Guardar objetivos'}))
  await waitFor(()=>expect(api.strategyEdit).toHaveBeenCalledTimes(2))
  expect(api.strategyEdit.mock.calls[1][0].expectedRevision).toBe(5)
  expect(api.strategyEdit.mock.calls[1][0].objectives[0].applicationIds).toEqual(['other'])
})

it('reads the strategy again when it changed elsewhere and keeps the same key for a repeated request',async()=>{
  api.context.mockResolvedValue(context())
  api.strategyEdit.mockRejectedValueOnce({response:{status:500}}).mockRejectedValueOnce({response:{status:409}})
  mount()
  fireEvent.click(await screen.findByLabelText('Saúde digital'))
  fireEvent.click(screen.getByRole('button',{name:'Guardar objetivos'}))
  await screen.findByText('Não foi possível guardar. Repita o mesmo pedido.')
  fireEvent.click(screen.getByRole('button',{name:'Guardar objetivos'}))
  await screen.findByText('A estratégia da organização mudou. Reveja a seleção e guarde novamente.')
  expect(api.strategyEdit.mock.calls[1][0].idempotencyKey).toBe(api.strategyEdit.mock.calls[0][0].idempotencyKey)
  await waitFor(()=>expect(api.context).toHaveBeenCalledTimes(2))
})

it('shows the linked objectives without controls to who cannot edit the strategy',async()=>{
  api.context.mockResolvedValue(context([{...first,applicationIds:['app']},second],false))
  mount()
  expect(await screen.findByText('Sustentabilidade Ambiental')).toBeTruthy()
  expect(screen.queryByText('Saúde digital')).toBeNull()
  expect(screen.queryByRole('checkbox')).toBeNull()
  expect(screen.queryByRole('button',{name:'Guardar objetivos'})).toBeNull()
})

it('stays out of the page without directory access, strategy support or anything to show',async()=>{
  api.context.mockRejectedValueOnce({response:{status:403}})
  const {container,unmount}=mount()
  await waitFor(()=>expect(api.context).toHaveBeenCalledTimes(1))
  expect(container.textContent).toBe('')
  unmount()
  api.context.mockResolvedValueOnce({data:{permissions:{edit:true},profile:{revision:1}}})
  const unsupported=mount()
  await waitFor(()=>expect(api.context).toHaveBeenCalledTimes(2))
  expect(unsupported.container.textContent).toBe('')
  unsupported.unmount()
  api.context.mockResolvedValueOnce(context([first,second],false))
  const reader=mount()
  await waitFor(()=>expect(api.context).toHaveBeenCalledTimes(3))
  expect(reader.container.textContent).toBe('')
})

it('offers to repeat a failed read',async()=>{
  api.context.mockRejectedValueOnce({response:{status:503}}).mockResolvedValueOnce(context())
  mount()
  fireEvent.click(await screen.findByRole('button',{name:'Repetir consulta'}))
  expect(await screen.findByLabelText('Saúde digital')).toBeTruthy()
})
