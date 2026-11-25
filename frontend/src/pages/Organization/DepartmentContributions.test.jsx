import {afterEach,beforeEach,expect,it,vi} from 'vitest'
import {cleanup,fireEvent,render,screen,within} from '@testing-library/react'
import DepartmentContributions from './DepartmentContributions'
import {clearDirectoryCache} from './directoryCache'

const areas=[{id:'health',name:'Saúde Digital'},{id:'education',name:'Educação'},{id:'environment',name:'Ambiente'}]
const goals=[{id:'g1',title:'Lançar dois pilotos'},{id:'g2',title:'Qualificar pessoas'}]
const objective=(id,title,objectiveIds,target='')=>({id,title,target,deadline:null,areaIds:[],objectiveIds})
const strategy={areaIds:['health'],interests:[],objectives:goals,units:{
  a:{areaIds:['health','environment'],objectives:[objective('o1','Integrar dados',['g1','g2'],'3 sistemas'),objective('o2','Explorar energia',[])]},
  b:{areaIds:['environment'],objectives:[]},
  old:{areaIds:['education'],objectives:[objective('o3','Arquivado',['g1'])]}}}
const units=[{scopeId:'a',label:'Informática',lifecycle:'ACTIVE'},{scopeId:'b',label:'Ambiente e Energia',lifecycle:'ACTIVE'},{scopeId:'old',label:'Antigo',lifecycle:'ARCHIVED'}]
const api={units:vi.fn()}
beforeEach(()=>{vi.clearAllMocks();clearDirectoryCache();api.units.mockResolvedValue({data:{items:units}})})
afterEach(cleanup)

it('shows contributions per strategic objective, unlinked objectives and the areas departments propose',async()=>{
  const onAdopt=vi.fn()
  render(<DepartmentContributions strategy={strategy} areas={areas} api={api} cacheKey="u:o" onAdopt={onAdopt}/>)
  const section=within(await screen.findByRole('region',{name:'Contributos dos departamentos'}))
  const first=within(section.getByText('Lançar dois pilotos').closest('li')),second=within(section.getByText('Qualificar pessoas').closest('li'))
  expect(first.getByText(/Integrar dados/)).toBeTruthy();expect(first.getByText(/Meta: 3 sistemas/)).toBeTruthy()
  expect(second.getByText(/Integrar dados/)).toBeTruthy()
  expect(section.queryByText(/Arquivado/)).toBeNull()
  const unlinked=section.getByRole('heading',{name:'Objetivos de departamento sem ligação a objetivo estratégico'}).nextElementSibling
  expect(unlinked.textContent).toContain('Explorar energia')
  expect(section.getByText('· Ambiente e Energia, Informática')).toBeTruthy()
  expect(section.queryByText('Educação')).toBeNull()
  fireEvent.click(section.getByRole('button',{name:'Adotar Ambiente como área estratégica'}))
  expect(onAdopt).toHaveBeenCalledWith('environment')
})

it('stays out without department profiles and hides adoption from who cannot edit',async()=>{
  const {container,unmount}=render(<DepartmentContributions strategy={{...strategy,units:{}}} areas={areas} api={api} cacheKey="u:o"/>)
  expect(container.textContent).toBe('');expect(api.units).not.toHaveBeenCalled()
  unmount()
  render(<DepartmentContributions strategy={strategy} areas={areas} api={api} cacheKey="u:o"/>)
  await screen.findByRole('region',{name:'Contributos dos departamentos'})
  expect(screen.queryByRole('button',{name:/Adotar/})).toBeNull()
})
