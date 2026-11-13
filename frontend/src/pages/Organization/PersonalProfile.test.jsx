import {afterEach,expect,it,vi} from 'vitest'
import {cleanup,fireEvent,render,screen,waitFor,within} from '@testing-library/react'
import {MemoryRouter} from 'react-router-dom'
import {ProfileForm} from './PersonalProfile'
afterEach(cleanup)
const record={person:{personId:'p',name:'Pessoa de ensaio',email:'',functionLabel:''},profile:{biography:'',keywords:'',areaIds:[],revision:2},units:[],areas:[{id:'education',name:'Educação'}],permissions:{edit:true}}
const mount=(api,personId)=>render(<MemoryRouter><ProfileForm organizationId="org-a" api={api} personId={personId}/></MemoryRouter>)
it('distinguishes missing link from missing information and does not allow claiming a person',async()=>{
 const api={self:vi.fn().mockResolvedValue({data:{person:null}})};mount(api)
 await screen.findByText('Perfil ainda não associado');expect(screen.queryByRole('button',{name:'Guardar perfil'})).toBeNull()
})
it('submits only the own profile with its revision and retries an uncertain write with the same intention',async()=>{
 const api={self:vi.fn().mockResolvedValue({data:record}),selfEdit:vi.fn().mockRejectedValueOnce(Error('network')).mockResolvedValue({})};mount(api)
 fireEvent.click(await screen.findByLabelText('Educação'));fireEvent.change(screen.getByLabelText('Biografia'),{target:{value:'Experiência'}});fireEvent.click(screen.getByRole('button',{name:'Guardar perfil'}))
 fireEvent.click(await screen.findByRole('button',{name:'Repetir o mesmo envio'}));await waitFor(()=>expect(api.selfEdit).toHaveBeenCalledTimes(2))
 expect(api.selfEdit.mock.calls[0][0]).toEqual(api.selfEdit.mock.calls[1][0]);expect(api.selfEdit.mock.calls[0][0]).toMatchObject({biography:'Experiência',areaIds:['education'],expectedRevision:2});expect(api.selfEdit.mock.calls[0][0]).not.toHaveProperty('membershipId')
})
it('keeps read-only profile visible with editing disabled',async()=>{
 mount({self:vi.fn().mockResolvedValue({data:{...record,permissions:{edit:false}}})});await screen.findByText('Pessoa de ensaio');expect(screen.getByLabelText('Educação').closest('fieldset').disabled).toBe(true);expect(screen.queryByRole('button',{name:'Guardar perfil'})).toBeNull()
})
it('edits both sources in a single thematic area selector while preserving existing classifications',async()=>{
 const data={...record,
  areas:[...record.areas,{id:'energy',name:'Energia'},{id:'health',name:'Saúde'},{id:'environment',name:'Ambiente'}],
  profile:{...record.profile,areaIds:['education','energy'],interestAreaIds:['education','health']}}
 const api={person:vi.fn().mockResolvedValue({data}),personProfileEdit:vi.fn().mockResolvedValue({})}
 mount(api,'p')
 const areas=within(await screen.findByRole('region',{name:'Áreas temáticas'}))
 expect(screen.getAllByRole('checkbox')).toHaveLength(4)
 const education=areas.getByRole('checkbox',{name:'Educação'})
 expect(education.checked).toBe(true)
 expect(areas.getByRole('checkbox',{name:'Energia'}).checked).toBe(true)
 expect(areas.getByRole('checkbox',{name:'Saúde'}).checked).toBe(true)
 fireEvent.click(education)
 fireEvent.click(areas.getByRole('checkbox',{name:'Ambiente'}))
 fireEvent.click(screen.getByRole('button',{name:'Guardar perfil'}))
 await waitFor(()=>expect(api.personProfileEdit).toHaveBeenCalledWith('p',expect.objectContaining({
  areaIds:['energy','environment'],interestAreaIds:['health'],expectedRevision:2
 })))
})
it('does not display a response arriving after the old organization view was removed',async()=>{
 let resolve;const old=mount({self:()=>new Promise(r=>resolve=r)});await waitFor(()=>expect(resolve).toBeTypeOf('function'));old.unmount();mount({self:vi.fn().mockResolvedValue({data:{person:null}})});resolve({data:record});await screen.findByText('Perfil ainda não associado');expect(screen.queryByText('Pessoa de ensaio')).toBeNull()
})
it('lets the person change her own name, function and units, and sends the primary unit among the selected ones',async()=>{
 const unitA={scopeId:'unit-a',label:'Unidade A'},unitB={scopeId:'unit-b',label:'Unidade B'}
 const api={self:vi.fn().mockResolvedValue({data:{...record,units:[{...unitA,isPrimary:true}],availableUnits:[unitA,unitB]}}),selfEdit:vi.fn().mockResolvedValue({})}
 mount(api)
 const name=await screen.findByLabelText('Nome');fireEvent.change(name,{target:{value:'Nova Pessoa'}})
 fireEvent.change(screen.getByLabelText('Função'),{target:{value:'Coordenadora'}})
 fireEvent.click(screen.getByLabelText('Unidade B'))
 fireEvent.click(within(screen.getByText('Unidade B').closest('.unit-choice')).getByLabelText('Principal'))
 fireEvent.click(screen.getByRole('button',{name:'Guardar perfil'}))
 await waitFor(()=>expect(api.selfEdit).toHaveBeenCalledTimes(1))
 expect(api.selfEdit.mock.calls[0][0]).toMatchObject({name:'Nova Pessoa',functionLabel:'Coordenadora',unitIds:['unit-a','unit-b'],primaryUnitId:'unit-b'})
 expect(api.selfEdit.mock.calls[0][0]).not.toHaveProperty('email')
})
