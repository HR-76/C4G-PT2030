import {afterEach,beforeEach,expect,it,vi} from 'vitest'
import {cleanup,fireEvent,render,screen,waitFor,within} from '@testing-library/react'
const api=vi.hoisted(()=>Object.fromEntries(['partnersGet','partnersHistory','partnerCreate','partnerEdit','partnerRemove'].map(k=>[k,vi.fn()])))
vi.mock('../../api/api',()=>({privateApplicationsApi:api}))
import ApplicationPartners from './ApplicationPartners'
import {applicationPartnerIntentKey,clearApplicationIntentions} from './intentions'
const props={applicationId:'app',userId:'user',organizationId:'org'}
beforeEach(()=>{vi.clearAllMocks();sessionStorage.clear();api.partnersGet.mockResolvedValue({data:{items:[],revision:1,canEdit:true,total:0}});api.partnersHistory.mockResolvedValue({data:{items:[]}})})
afterEach(cleanup)
const openPartner = async () => fireEvent.click(await screen.findByRole('button',{name:'Adicionar parceiro'}))
it('opens partner editing in a modal and retains a draft when closed',async()=>{
 render(<ApplicationPartners {...props}/>)
 expect(screen.queryByLabelText('Nome da entidade *')).toBeNull()
 fireEvent.click(await screen.findByRole('button',{name:'Adicionar parceiro'}))
 expect(screen.getByRole('dialog',{name:'Adicionar parceiro'})).toBeTruthy()
 fireEvent.change(screen.getByLabelText('Nome da entidade *'),{target:{value:'Rascunho preservado'}})
 fireEvent.click(screen.getByRole('button',{name:'Fechar'}))
 expect(screen.queryByRole('dialog')).toBeNull()
 fireEvent.click(screen.getByRole('button',{name:'Continuar ficha de parceiro'}))
 expect(screen.getByLabelText('Nome da entidade *').value).toBe('Rascunho preservado')
 expect(api.partnerCreate).not.toHaveBeenCalled()
})
it('locks closing while saving and makes uncertain recovery available in the modal',async()=>{
 let reject
 api.partnerCreate.mockImplementation(()=>new Promise((resolve,fail)=>{reject=fail}))
 render(<ApplicationPartners {...props}/>)
 fireEvent.click(await screen.findByRole('button',{name:'Adicionar parceiro'}))
 fireEvent.change(screen.getByLabelText('Nome da entidade *'),{target:{value:'Parceiro'}})
 fireEvent.click(within(screen.getByRole('dialog')).getByRole('button',{name:'Adicionar parceiro',exact:true}))
 expect(screen.getByRole('button',{name:'Fechar'}).disabled).toBe(true)
 reject({response:{status:503}})
 await screen.findByRole('alert')
 expect(screen.getByRole('dialog')).toBeTruthy()
 expect(screen.getByRole('button',{name:'Repetir envio de parceiros'})).toBeTruthy()
 expect(api.partnerCreate).toHaveBeenCalledTimes(1)
})
it('uses Outro and retains an uncertain command across reload with the same key and organization',async()=>{
 api.partnerCreate.mockRejectedValueOnce({response:{status:503}}).mockResolvedValueOnce({data:{revision:2}})
 let view=render(<ApplicationPartners {...props}/>);await openPartner();fireEvent.change(await screen.findByLabelText('Nome da entidade *'),{target:{value:'Parceiro'}})
 fireEvent.click(screen.getByRole('button',{name:'Adicionar pessoa'}));expect(screen.getByLabelText('Papel').value).toBe('OUTRO');fireEvent.change(screen.getByLabelText('Nome *',{exact:true}),{target:{value:'Ana'}})
 fireEvent.click(within(screen.getByRole('dialog')).getByRole('button',{name:'Adicionar parceiro',exact:true}));await screen.findByRole('alert');const first=api.partnerCreate.mock.calls[0];expect(first[2]).toBe('org');expect(first[1].partner.people[0]).toMatchObject({id:null,name:'Ana',role:'OUTRO'})
 view.unmount();view=render(<ApplicationPartners {...props}/>);fireEvent.click(await screen.findByRole('button',{name:'Repetir envio de parceiros'}));await screen.findByText('Parceiros atualizados.');expect(api.partnerCreate.mock.calls[1]).toEqual(first);expect(sessionStorage.getItem(applicationPartnerIntentKey('user','org','app'))).toBeNull()
})
it('does not render edit controls for a reader or convert errors into empty data',async()=>{
 api.partnersGet.mockResolvedValueOnce({data:{items:[],revision:1,canEdit:false,total:0}})
 const view=render(<ApplicationPartners {...props}/>);await screen.findByText('Sem parceiros nesta candidatura.');expect(screen.queryByRole('button',{name:'Adicionar parceiro'})).toBeNull();view.unmount()
 api.partnersGet.mockRejectedValue({response:{status:503}});render(<ApplicationPartners {...props}/>);await screen.findByRole('alert');expect(screen.queryByText('Sem parceiros nesta candidatura.')).toBeNull()
})
it('returns focus to the partner action after closing the modal by keyboard', async () => {
  render(<ApplicationPartners {...props} />)
  const action = await screen.findByRole('button', { name: 'Adicionar parceiro', exact: true })
  fireEvent.click(action)
  expect(screen.getByRole('dialog', { name: 'Adicionar parceiro' })).toBeTruthy()
  fireEvent.keyDown(document, { key: 'Escape' })
  await waitFor(() => expect(document.activeElement).toBe(action))
  expect(screen.queryByRole('dialog')).toBeNull()
  expect(api.partnerCreate).not.toHaveBeenCalled()
})
it('does not send pending contact data from a different application and clears it on logout',async()=>{
 const key=applicationPartnerIntentKey('user','org','app');sessionStorage.setItem(key,JSON.stringify({...props,method:'partnerCreate',payload:{}}))
 render(<ApplicationPartners {...props} applicationId="other"/>);await openPartner();await screen.findByLabelText('Nome da entidade *');expect(screen.queryByRole('button',{name:'Repetir envio de parceiros'})).toBeNull();clearApplicationIntentions();expect(sessionStorage.getItem(key)).toBeNull()
})
it('keeps unsaved input after a stale revision and prevents a new command until reload',async()=>{
 api.partnerCreate.mockRejectedValue({response:{status:409,data:{error:{code:'STALE_REVISION'}}}})
 render(<ApplicationPartners {...props}/>);await openPartner();fireEvent.change(await screen.findByLabelText('Nome da entidade *'),{target:{value:'Não perder'}});fireEvent.click(within(screen.getByRole('dialog')).getByRole('button',{name:'Adicionar parceiro',exact:true}));await screen.findByRole('alert');expect(screen.queryByRole('button',{name:'Adicionar parceiro'})).toBeNull();fireEvent.click(screen.getByRole('button',{name:'Recarregar parceiros'}));await waitFor(()=>expect(screen.getByLabelText('Nome da entidade *').value).toBe('Não perder'))
})
it('applies existing server field limits and stops adding people at fifty',async()=>{
 render(<ApplicationPartners {...props}/>);await openPartner();await screen.findByLabelText('Nome da entidade *')
 expect(screen.getByLabelText('País').maxLength).toBe(100)
 expect(screen.getByLabelText('Área de investigação / Interesse no projeto').maxLength).toBe(2000)
 expect(screen.getByLabelText('Email').maxLength).toBe(254)
 for(let i=0;i<50;i++)fireEvent.click(screen.getByRole('button',{name:'Adicionar pessoa'}))
 expect(screen.getByRole('button',{name:'Adicionar pessoa'}).disabled).toBe(true)
 expect(screen.getAllByLabelText('Nome *',{exact:true})).toHaveLength(50)
 fireEvent.click(screen.getAllByRole('button',{name:'Remover pessoa'})[0])
 expect(screen.getByRole('button',{name:'Adicionar pessoa'}).disabled).toBe(false)
})
it('edits the complete recovered UBI card while preserving person identity and other fields',async()=>{
 const partner={id:'p',entity_name:'Instituto',country:'Portugal',research_area_interest:'Investigação',responsible_person:'Maria',contact:'210000000',email:'geral@example.org',people:[{id:'person-1',name:'Ana',role:'INVESTIGADOR',research_area:'Saúde',contact:'220000000',email:'ana@example.org'}]}
 api.partnersGet.mockResolvedValue({data:{items:[partner],revision:3,canEdit:true,total:1}})
 api.partnerEdit.mockResolvedValue({data:{revision:4}})
 render(<ApplicationPartners {...props}/>);fireEvent.click(await screen.findByTitle('Editar'))
 fireEvent.change(screen.getByLabelText('País'),{target:{value:'Espanha'}})
 fireEvent.click(screen.getByRole('button',{name:'Guardar parceiro'}))
 await waitFor(()=>expect(api.partnerEdit).toHaveBeenCalledTimes(1))
 const {id,...fields}=partner
 expect(api.partnerEdit.mock.calls[0]).toEqual(['app',{partner:{...fields,country:'Espanha'},partnerId:'p',expectedRevision:3,idempotencyKey:expect.any(String)},'org'])
})

it.each([false,undefined])('preserves pending without retry for canEdit %s',async canEdit=>{
 const key=applicationPartnerIntentKey('user','org','app'),intent={...props,method:'partnerCreate',payload:{partner:{entity_name:'Preservado'},expectedRevision:1,idempotencyKey:'stable'}}
 sessionStorage.setItem(key,JSON.stringify(intent));api.partnersGet.mockResolvedValue({data:{items:[],revision:1,canEdit,total:0}})
 render(<ApplicationPartners {...props}/>);await screen.findByText('Sem parceiros nesta candidatura.')
 expect(screen.queryByRole('button',{name:'Repetir envio de parceiros'})).toBeNull()
 expect(JSON.parse(sessionStorage.getItem(key))).toEqual(intent);expect(api.partnerCreate).not.toHaveBeenCalled()
})
it.each([401,403,404])('blocks after refusal %s and recovers only after explicit permission read',async status=>{
 api.partnerCreate.mockRejectedValueOnce({response:{status}}).mockResolvedValueOnce({data:{revision:2}})
 render(<ApplicationPartners {...props}/>);await openPartner();fireEvent.change(await screen.findByLabelText('Nome da entidade *'),{target:{value:'Parceiro'}})
 fireEvent.click(within(screen.getByRole('dialog')).getByRole('button',{name:'Adicionar parceiro',exact:true}));await screen.findByRole('alert')
 const first=api.partnerCreate.mock.calls[0],key=applicationPartnerIntentKey('user','org','app'),stored=sessionStorage.getItem(key)
 expect(stored).not.toBeNull();expect(screen.queryByRole('button',{name:'Repetir envio de parceiros'})).toBeNull()
 expect(screen.queryByRole('button',{name:'Adicionar parceiro'})).toBeNull()
 fireEvent.click(screen.getByRole('button',{name:'Recarregar parceiros'}));await screen.findByRole('button',{name:'Repetir envio de parceiros'})
 expect(api.partnerCreate).toHaveBeenCalledTimes(1);expect(sessionStorage.getItem(key)).toBe(stored)
 fireEvent.click(screen.getByRole('button',{name:'Repetir envio de parceiros'}));await screen.findByText('Parceiros atualizados.')
 expect(api.partnerCreate.mock.calls[1]).toEqual(first)
})
it('does not offer retry before the authority read completes',()=>{
 sessionStorage.setItem(applicationPartnerIntentKey('user','org','app'),JSON.stringify({...props,method:'partnerRemove',payload:{}}))
 api.partnersGet.mockImplementation(()=>new Promise(()=>{}));render(<ApplicationPartners {...props}/>)
 expect(screen.queryByRole('button',{name:'Repetir envio de parceiros'})).toBeNull()
})

it('revokes editing and hides cached records when a history page denies access',async()=>{
 const partner={id:'p',entity_name:'Ficha privada',country:'',research_area_interest:'',responsible_person:'',contact:'',email:'',people:[]}
 api.partnersGet.mockResolvedValue({data:{items:[partner],revision:1,canEdit:true,total:1}})
 api.partnersHistory.mockResolvedValueOnce({data:{items:[],nextCursor:'next'}}).mockRejectedValueOnce({response:{status:403}})
 render(<ApplicationPartners {...props}/>);fireEvent.click(await screen.findByRole('button',{name:'Mais histórico de parceiros'}));await screen.findByRole('alert')
 expect(screen.queryByText('Ficha privada')).toBeNull();expect(screen.queryByRole('button',{name:'Adicionar parceiro'})).toBeNull()
 expect(screen.getByRole('button',{name:'Recarregar parceiros'})).toBeTruthy()
})
