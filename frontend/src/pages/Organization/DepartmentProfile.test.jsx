import {afterEach,beforeEach,expect,it,vi} from 'vitest'
import {cleanup,fireEvent,render,screen,waitFor,within} from '@testing-library/react'
import DepartmentProfile from './DepartmentProfile'

const api={departmentProfileEdit:vi.fn()}
const unit={scopeId:'unit-a',label:'Informática'}
const strategyAreas=[{id:'health',name:'Saúde Digital'},{id:'education',name:'Educação'},{id:'environment',name:'Ambiente'}]
const goal={id:'goal',title:'Lançar dois pilotos',target:'2',deadline:null,areaIds:[]}
const profile=(units={})=>({revision:7,strategyAreas,strategy:{areaIds:['health'],interests:[],objectives:[goal],units}})
const mount=(props={})=>{
  const handlers={onSaved:vi.fn(),onClose:vi.fn()}
  render(<DepartmentProfile unit={unit} profile={profile()} api={api} canEdit {...handlers} {...props}/>)
  return handlers
}
beforeEach(()=>vi.clearAllMocks())
afterEach(cleanup)

it('saves the department interests and an objective linked to a strategic objective',async()=>{
  api.departmentProfileEdit.mockResolvedValue({data:{}})
  const {onSaved}=mount()
  const dialog=within(screen.getByRole('dialog',{name:'Perfil de Informática'}))
  fireEvent.click(dialog.getByLabelText('Saúde Digital'))
  fireEvent.click(dialog.getByLabelText('Ambiente'))
  expect(dialog.getByText('Fora da estratégia da entidade: Ambiente.')).toBeTruthy()
  fireEvent.click(dialog.getByRole('button',{name:'Adicionar objetivo'}))
  fireEvent.change(dialog.getByLabelText('Objetivo'),{target:{value:'  Integrar   dados '}})
  fireEvent.change(dialog.getByLabelText('Meta ou indicador'),{target:{value:'3 sistemas'}})
  expect(dialog.getByText('Sem ligação a objetivo estratégico.')).toBeTruthy()
  fireEvent.click(dialog.getByLabelText('Lançar dois pilotos'))
  expect(dialog.queryByText('Sem ligação a objetivo estratégico.')).toBeNull()
  fireEvent.click(dialog.getByRole('button',{name:'Guardar perfil'}))
  await waitFor(()=>expect(onSaved).toHaveBeenCalled())
  expect(api.departmentProfileEdit).toHaveBeenCalledWith('unit-a',{expectedRevision:7,idempotencyKey:expect.any(String),areaIds:['health','environment'],
    objectives:[{id:expect.any(String),title:'Integrar dados',target:'3 sistemas',deadline:null,areaIds:[],objectiveIds:['goal']}]})
})

it('asks for a strategic area before sending and explains a refusal from the server',async()=>{
  mount()
  fireEvent.click(screen.getByLabelText('Ambiente'))
  fireEvent.click(screen.getByRole('button',{name:'Guardar perfil'}))
  expect(screen.getByRole('alert').textContent).toBe('Inclua pelo menos uma área estratégica da entidade.')
  expect(api.departmentProfileEdit).not.toHaveBeenCalled()
  fireEvent.click(screen.getByLabelText('Saúde Digital'))
  api.departmentProfileEdit.mockRejectedValueOnce({response:{status:409,data:{error:{code:'STALE_REVISION'}}}}).mockRejectedValueOnce({response:{status:503}})
  fireEvent.click(screen.getByRole('button',{name:'Guardar perfil'}))
  expect((await screen.findByRole('alert')).textContent).toBe('A estratégia da organização mudou entretanto. Feche e abra o perfil para rever.')
  fireEvent.click(screen.getByRole('button',{name:'Guardar perfil'}))
  await waitFor(()=>expect(api.departmentProfileEdit).toHaveBeenCalledTimes(2))
  expect(api.departmentProfileEdit.mock.calls[1][1].idempotencyKey).toBe(api.departmentProfileEdit.mock.calls[0][1].idempotencyKey)
})

it('opens the stored profile read-only for who cannot edit',()=>{
  const stored={'unit-a':{areaIds:['health','education'],objectives:[{id:'o',title:'Formar a equipa',target:'',deadline:'2027-06-30',areaIds:['health'],objectiveIds:[]}]}}
  const {onClose}=mount({profile:profile(stored),canEdit:false})
  const interests=within(screen.getByRole('group',{name:'Áreas de interesse'}))
  expect(interests.getByLabelText('Saúde Digital').checked).toBe(true)
  // The whole profile sits in a disabled fieldset.
  expect(interests.getByLabelText('Saúde Digital').matches(':disabled')).toBe(true)
  expect(screen.getByLabelText('Objetivo').value).toBe('Formar a equipa')
  expect(screen.getByText('Fora da estratégia da entidade: Educação.')).toBeTruthy()
  expect(screen.queryByRole('button',{name:'Guardar perfil'})).toBeNull()
  expect(screen.queryByRole('button',{name:'Adicionar objetivo'})).toBeNull()
  expect(screen.queryByRole('button',{name:'Cancelar'})).toBeNull()
  fireEvent.click(screen.getByRole('button',{name:'Fechar'}))
  expect(onClose).toHaveBeenCalled()
})
