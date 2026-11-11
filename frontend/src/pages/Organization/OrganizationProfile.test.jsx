import {afterEach,beforeEach,expect,it,vi} from 'vitest'
import {cleanup,fireEvent,render,screen,waitFor,within} from '@testing-library/react'
import {MemoryRouter} from 'react-router-dom'
const api=vi.hoisted(()=>Object.fromEntries(['context','units','people','unitCreate','unitRename','unitMove','profileEdit','descriptionEdit','strategyEdit','registrationProfile','registrationContacts','personCreate','personEdit'].map(k=>[k,vi.fn()])))
const auth=vi.hoisted(()=>({user:{id:'user-a'},organization:{id:'org-a'}}))
vi.mock('../../api/api',()=>({organizationDirectoryApi:()=>api}))
vi.mock('../../contexts/AuthContext',()=>({useAuth:()=>auth}))
import OrganizationProfile from './OrganizationProfile'
import {clearDirectoryIntentions,directoryIntentKey} from './intentions'
import {clearDirectoryCache} from './directoryCache'
const info={organization:{id:'org-a',name:'Entidade C4G',legalName:'Entidade C4G, Lda.',typeCode:'COMPANY'},profile:{description:'Trabalho da entidade',email:'',website:'',revision:1},permissions:{edit:true,units:true,createUnit:true,renameUnit:true,moveUnit:true}}
const units=[{scopeId:'unit-a',label:'Direção',parentScopeId:null,lifecycle:'ACTIVE',revision:1},{scopeId:'unit-b',label:'Projetos',parentScopeId:'unit-a',lifecycle:'ACTIVE',revision:1}]
const person={personId:'person-a',name:'Ana',email:'ana@example.invalid',functionLabel:'Gestão',active:true,unitIds:['unit-a'],primaryUnitId:'unit-a',revision:1}
const registration={revision:2,complete:true,fields:{nif:'500000000',acronym:'C4G',address:'Rua da Escola',addressComplement:'',postalCode:'1000-001',locality:'Lisboa',institutionalEmail:'central@example.org',institutionalPhone:'+351210000000',website:'https://example.org',responsibleName:'Ana Responsável',responsibleEmail:'ana@example.org',responsiblePhone:'+351910000000',responsibleJobTitle:'Diretora',workerCount:12,workerReferenceDate:'2026-09-30'}}
const mount=(path='/perfil-organizacao')=>render(<MemoryRouter initialEntries={[path]}><OrganizationProfile/></MemoryRouter>)
beforeEach(()=>{vi.clearAllMocks();sessionStorage.clear();clearDirectoryCache();auth.user={id:'user-a'};auth.organization={id:'org-a'};api.context.mockResolvedValue({data:info});api.units.mockResolvedValue({data:{items:units}});api.people.mockResolvedValue({data:{items:[person],nextCursor:null}});api.personCreate.mockResolvedValue({data:person});api.profileEdit.mockResolvedValue({data:info.profile});api.registrationProfile.mockResolvedValue({data:registration});api.unitCreate.mockResolvedValue({data:units[0]})})
afterEach(cleanup)

const strategyAreas=[{id:'health',name:'Saúde Digital'},{id:'education',name:'Educação'},{id:'environment',name:'Ambiente'}]
const strategyContext={...info,profile:{...info.profile,strategy:{areaIds:[],interests:[],objectives:[]},strategyAreas}}

it('edits organization strategy with structured objectives and the confirmed revision',async()=>{
 api.context.mockResolvedValue({data:strategyContext})
 api.strategyEdit.mockImplementation(async body=>{
  api.context.mockResolvedValueOnce({data:{...strategyContext,profile:{...strategyContext.profile,revision:2,
   strategy:{areaIds:body.areaIds,interests:body.interests,objectives:body.objectives}}}})
 })
 mount()
 fireEvent.click(await screen.findByRole('button',{name:'Editar estratégia'}))
 const editor=within(screen.getByRole('dialog',{name:'Editar estratégia'}))
 fireEvent.click(editor.getByRole('checkbox',{name:'Saúde Digital'}))
 fireEvent.change(editor.getByLabelText('Interesses institucionais'),{target:{value:' Telemonitorização '}})
 fireEvent.click(editor.getByRole('button',{name:'Adicionar objetivo'}))
 const objective=editor.getByRole('group',{name:'Objetivo 1'})
 fireEvent.change(within(objective).getByLabelText('Objetivo'),{target:{value:'Lançar pilotos'}})
 fireEvent.change(within(objective).getByLabelText('Prazo'),{target:{value:'2027-12-31'}})
 fireEvent.click(editor.getByRole('button',{name:'Guardar alterações'}))
 expect(await screen.findByText('Lançar pilotos')).toBeTruthy()
 expect(screen.queryByRole('dialog')).toBeNull()
 expect(api.strategyEdit).toHaveBeenCalledWith({expectedRevision:1,idempotencyKey:expect.any(String),areaIds:['health'],
  interests:['Telemonitorização'],objectives:[{id:expect.any(String),title:'Lançar pilotos',target:'',deadline:'2027-12-31',areaIds:[]}]})
})

it('discards the strategy draft on Escape and returns focus to its trigger',async()=>{
 api.context.mockResolvedValue({data:strategyContext})
 mount()
 const trigger=await screen.findByRole('button',{name:'Editar estratégia'})
 fireEvent.click(trigger)
 const dialog=screen.getByRole('dialog',{name:'Editar estratégia'})
 fireEvent.click(within(dialog).getByRole('button',{name:'Adicionar objetivo'}))
 const title=within(dialog).getByLabelText('Objetivo')
 expect(document.activeElement).toBe(title)
 fireEvent.change(title,{target:{value:'Rascunho'}})
 fireEvent.keyDown(title,{key:'Escape'})
 await waitFor(()=>expect(document.activeElement).toBe(trigger))
 expect(api.strategyEdit).not.toHaveBeenCalled()
 fireEvent.click(trigger)
 expect(within(screen.getByRole('dialog')).queryByLabelText('Objetivo')).toBeNull()
})

it('combines and deduplicates competences and interests in the paginated thematic areas dialog',async()=>{
 api.context.mockResolvedValue({data:strategyContext})
 api.people.mockResolvedValue({data:{items:[{...person,areaIds:['health','environment'],interestAreaIds:['education','environment']}],areas:strategyAreas,nextCursor:'next'}})
 mount('/perfil-organizacao/pessoas?unitId=unit-a')
 await screen.findByRole('link',{name:'Ana'})
 const table=within(screen.getByRole('table'))
 expect(table.queryByRole('columnheader',{name:'Áreas temáticas'})).toBeNull()
 fireEvent.click(screen.getByText('Filtros avançados'))
 fireEvent.change(screen.getByLabelText('Área de interesse'),{target:{value:'education'}})
 fireEvent.click(screen.getByRole('button',{name:'Aplicar filtros'}))
 await waitFor(()=>expect(api.people).toHaveBeenLastCalledWith({search:'',status:'ACTIVE',unitId:'unit-a',interestAreaId:'education'}))
 const trigger=await screen.findByRole('button',{name:'Áreas temáticas'})
 await waitFor(()=>expect(trigger.disabled).toBe(false))
 fireEvent.click(trigger)
 const dialog=screen.getByRole('dialog',{name:'Áreas temáticas'})
 const contents=within(dialog)
 expect(contents.getAllByRole('columnheader').map(header=>header.textContent)).toEqual(['Pessoa','Áreas temáticas'])
 const areaCell=within(contents.getByRole('cell'))
 expect(areaCell.getAllByRole('listitem').map(item=>item.textContent)).toEqual(['Saúde Digital','Educação','Ambiente'])
 expect(contents.getByText('ana@example.invalid')).toBeTruthy()
 api.people.mockResolvedValueOnce({data:{items:[{...person,personId:'person-b',name:'Bruno'}],areas:strategyAreas,nextCursor:null}})
 fireEvent.click(contents.getByRole('button',{name:'Mais pessoas'}))
 await waitFor(()=>expect(api.people).toHaveBeenLastCalledWith({search:'',status:'ACTIVE',unitId:'unit-a',interestAreaId:'education',cursor:'next'}))
 const secondRow=within((await contents.findByText('Bruno')).closest('tr'))
 expect(secondRow.getByRole('cell',{name:'Por indicar'})).toBeTruthy()
 fireEvent.keyDown(dialog,{key:'Escape'})
 expect(screen.queryByRole('dialog')).toBeNull()
 await waitFor(()=>expect(document.activeElement).toBe(trigger))
 expect(screen.getByRole('link',{name:'Bruno'})).toBeTruthy()
})

it('lets authorized readers compare competences when the tenant has no interest fields',async()=>{
 api.context.mockResolvedValue({data:{...info,permissions:{...info.permissions,edit:false}}})
 api.people.mockResolvedValue({data:{items:[{...person,areaIds:['health']}],areas:strategyAreas,nextCursor:null}})
 mount('/perfil-organizacao/pessoas')
 await screen.findByRole('link',{name:'Ana'})
 fireEvent.click(screen.getByRole('button',{name:'Áreas temáticas'}))
 const dialog=within(screen.getByRole('dialog'))
 expect(dialog.getByRole('cell',{name:'Saúde Digital'})).toBeTruthy()
 expect(dialog.getByRole('columnheader',{name:'Áreas temáticas'})).toBeTruthy()
 expect(screen.queryByRole('button',{name:'Editar Ana'})).toBeNull()
 fireEvent.click(dialog.getByRole('button',{name:'Fechar'}))
 expect(screen.queryByRole('dialog')).toBeNull()
})

it('starts the people request after authorized context without waiting for units',async()=>{
 let finishUnits;api.units.mockImplementationOnce(()=>new Promise(resolve=>{finishUnits=resolve}))
 mount('/perfil-organizacao/pessoas')
 await waitFor(()=>expect(api.people).toHaveBeenCalledTimes(1))
 expect(screen.queryByText('Ana')).toBeNull()
 finishUnits({data:{items:units}})
 expect(await screen.findByText('Ana')).toBeTruthy()
})

it('does not request people or units when the organization context is denied',async()=>{
 api.context.mockRejectedValueOnce({response:{status:403}})
 mount('/perfil-organizacao/pessoas')
 await screen.findByText('Não tem permissão para esta área ou ação na organização selecionada.')
 expect(api.units).not.toHaveBeenCalled()
 expect(api.people).not.toHaveBeenCalled()
})

it('does not show a late people response when units access fails',async()=>{
 let finishPeople;api.people.mockImplementationOnce(()=>new Promise(resolve=>{finishPeople=resolve}))
 let rejectUnits;api.units.mockImplementationOnce(()=>new Promise((_,reject)=>{rejectUnits=reject}))
 mount('/perfil-organizacao/pessoas')
 await waitFor(()=>expect(finishPeople).toBeTypeOf('function'))
 rejectUnits({response:{status:403}})
 await screen.findByText('Não tem permissão para esta área ou ação na organização selecionada.')
 finishPeople({data:{items:[person],nextCursor:null}})
 await waitFor(()=>expect(screen.queryByText('Ana')).toBeNull())
})

it('discards parallel directory responses from the previous organization',async()=>{
 let finishUnits,finishPeople
 api.units.mockImplementationOnce(()=>new Promise(resolve=>{finishUnits=resolve}))
 api.people.mockImplementationOnce(()=>new Promise(resolve=>{finishPeople=resolve}))
 const view=mount('/perfil-organizacao/pessoas')
 await waitFor(()=>expect(finishPeople).toBeTypeOf('function'))
 auth.organization={id:'org-b'}
 api.context.mockResolvedValue({data:{...info,organization:{...info.organization,id:'org-b',name:'Entidade B'}}})
 api.people.mockResolvedValue({data:{items:[{...person,name:'Bruno'}],nextCursor:null}})
 view.rerender(<MemoryRouter initialEntries={['/perfil-organizacao/pessoas']}><OrganizationProfile/></MemoryRouter>)
 await screen.findByText('Bruno')
 finishUnits({data:{items:units}});finishPeople({data:{items:[person],nextCursor:null}})
 await waitFor(()=>expect(screen.queryByText('Ana')).toBeNull())
 expect(screen.getByText('Bruno')).toBeTruthy()
})

it('reads units and people behind the institutional profile and opens both pages at once',async()=>{
 mount()
 await screen.findByText('Trabalho da entidade')
 await waitFor(()=>{expect(api.units).toHaveBeenCalledTimes(1);expect(api.people).toHaveBeenCalledTimes(1)})
 expect(api.people).toHaveBeenCalledWith({search:'',status:'ACTIVE',unitId:''})
 await waitFor(()=>expect(screen.queryByText('A carregar a organização…')).toBeNull())
 api.context.mockReturnValue(new Promise(()=>{}));api.units.mockReturnValue(new Promise(()=>{}));api.people.mockReturnValue(new Promise(()=>{}))
 await new Promise(resolve=>setTimeout(resolve,0))
 fireEvent.click(screen.getByRole('link',{name:'Ver departamentos e unidades'}))
 expect(await screen.findByRole('link',{name:'Ver pessoas de Direção'})).toBeTruthy()
 expect(screen.queryByText('A carregar a organização…')).toBeNull()
 // Both are still read again on entry.
 await waitFor(()=>{expect(api.context).toHaveBeenCalledTimes(2);expect(api.units).toHaveBeenCalledTimes(2)})
 cleanup();mount('/perfil-organizacao/pessoas')
 expect(await screen.findByText('Ana')).toBeTruthy()
 expect(screen.queryByText('A consultar pessoas…')).toBeNull()
 await waitFor(()=>expect(api.people).toHaveBeenCalledTimes(2))
})

it('edits a person in a modal, cancels without writing and saves the existing identity',async()=>{
 mount('/perfil-organizacao/pessoas')
 const trigger=await screen.findByRole('button',{name:'Editar Ana'})
 trigger.focus();fireEvent.click(trigger)
 const dialog=screen.getByRole('dialog',{name:'Editar pessoa'})
 expect(dialog.contains(screen.getByLabelText('Nome da pessoa'))).toBe(true)
 expect(screen.getByLabelText('Nome da pessoa').value).toBe('Ana')
 expect(document.activeElement).toBe(screen.getByLabelText('Nome da pessoa'))
 fireEvent.change(screen.getByLabelText('Nome da pessoa'),{target:{value:'Rascunho'}})
 fireEvent.keyDown(document.activeElement,{key:'Escape'})
 await waitFor(()=>expect(document.activeElement).toBe(trigger))
 expect(screen.queryByRole('dialog')).toBeNull()
 expect(api.personEdit).not.toHaveBeenCalled()
 fireEvent.click(trigger)
 expect(screen.getByLabelText('Nome da pessoa').value).toBe('Ana')
 fireEvent.click(screen.getByRole('button',{name:'Cancelar'}))
 expect(screen.queryByRole('dialog')).toBeNull()
 fireEvent.click(trigger)
 fireEvent.change(screen.getByLabelText('Nome da pessoa'),{target:{value:'Ana revista'}})
 fireEvent.click(screen.getByRole('button',{name:'Guardar alterações'}))
 await waitFor(()=>expect(api.personEdit).toHaveBeenCalledWith('person-a',expect.objectContaining({name:'Ana revista',email:person.email,functionLabel:person.functionLabel,active:true,unitIds:['unit-a'],primaryUnitId:'unit-a',expectedRevision:1,idempotencyKey:expect.any(String)})))
 await waitFor(()=>expect(screen.queryByRole('dialog')).toBeNull())
 await screen.findByText('Alterações guardadas.')
})

it('opens person registration in a modal and restores focus on cancel',async()=>{
 mount('/perfil-organizacao/pessoas')
 const trigger=await screen.findByRole('button',{name:'Registar pessoa'})
 trigger.focus()
 fireEvent.click(trigger)
 expect(screen.getByRole('dialog',{name:'Registar pessoa'})).toBeTruthy()
 expect(document.activeElement).toBe(screen.getByLabelText('Nome da pessoa'))
 fireEvent.click(screen.getByRole('button',{name:'Cancelar'}))
 await waitFor(()=>expect(document.activeElement).toBe(trigger))
 expect(api.personCreate).not.toHaveBeenCalled()
})

it.each([
 ['Criar unidade','Criar departamento / unidade','Nome da unidade'],
 ['Renomear','Renomear unidade','Nome da unidade'],
])('opens %s in a modal and restores focus without writing',async(action,title,label)=>{
 mount('/perfil-organizacao/unidades');const trigger=(await screen.findAllByRole('button',{name:action}))[0];trigger.focus();fireEvent.click(trigger);
 expect(screen.getByRole('dialog',{name:title})).toBeTruthy();expect(document.activeElement).toBe(screen.getByLabelText(label));
 fireEvent.keyDown(document.activeElement,{key:'Escape'});expect(screen.queryByRole('dialog')).toBeNull();await waitFor(()=>expect(document.activeElement).toBe(trigger));
 expect(api.unitCreate).not.toHaveBeenCalled();expect(api.unitRename).not.toHaveBeenCalled();expect(api.unitMove).not.toHaveBeenCalled();
})

it('central profile saves description separately without sending or overwriting contact fields',async()=>{
 api.context.mockResolvedValue({data:{...info,contactSource:'CENTRAL',registration:{revision:2,fields:{institutionalEmail:'central@example.org',website:'https://example.org'}}}});api.descriptionEdit.mockResolvedValue({data:{}});mount()
 fireEvent.click(await screen.findByRole('button',{name:'Editar descrição'}));fireEvent.change(screen.getByLabelText('Descrição'),{target:{value:'Nova descrição'}});fireEvent.click(screen.getByRole('button',{name:'Guardar alterações'}));await waitFor(()=>expect(api.descriptionEdit).toHaveBeenCalledTimes(1));expect(api.descriptionEdit.mock.calls[0][0]).toMatchObject({description:'Nova descrição',expectedRevision:1});expect(api.descriptionEdit.mock.calls[0][0]).not.toHaveProperty('email');expect(api.profileEdit).not.toHaveBeenCalled()
})
it('uses the canonical entity profile command for the complete institutional and responsible fields',async()=>{
 api.context.mockResolvedValue({data:{...info,contactSource:'CENTRAL',registration}});mount();fireEvent.click(await screen.findByRole('button',{name:'Editar ficha'}));fireEvent.change(await screen.findByLabelText(/^Email institucional/),{target:{value:'new@example.org'}});fireEvent.change(screen.getByLabelText(/^Nome do contacto principal/),{target:{value:'Nova Responsável'}});fireEvent.click(screen.getByRole('button',{name:'Guardar ficha'}));await waitFor(()=>expect(api.registrationProfile).toHaveBeenCalledTimes(1));expect(api.registrationProfile.mock.calls[0][0]).toMatchObject({expectedRevision:2,fields:{nif:'500000000',institutionalEmail:'new@example.org',responsibleName:'Nova Responsável',responsibleEmail:'ana@example.org',workerCount:12}});expect(api.descriptionEdit).not.toHaveBeenCalled();expect(api.registrationContacts).not.toHaveBeenCalled()
})
it('keeps the initial-fill form and field errors after a refused canonical save',async()=>{
 api.context.mockResolvedValue({data:{...info,registration:{revision:0,complete:false,fields:{}}}});api.registrationProfile.mockRejectedValue({response:{status:400,data:{error:{code:'REGISTRATION_FIELDS_INVALID',fields:{responsibleEmail:'Indique um email válido.'}}}}});mount();fireEvent.click(await screen.findByRole('button',{name:'Preencher ficha'}));const email=await screen.findByLabelText(/^Email profissional/);fireEvent.change(email,{target:{value:'inválido'}});fireEvent.click(screen.getByRole('button',{name:'Guardar ficha'}));await screen.findByText('Indique um email válido.');expect(screen.getByLabelText(/^Email profissional/).value).toBe('inválido');expect(screen.getByText('Verifique os campos assinalados.')).toBeTruthy()
})
it('presents canonical identity, keeps matching separate and edits only the private description',async()=>{
 mount();await screen.findByText('Entidade C4G, Lda.');expect(screen.getByText('Empresa')).toBeTruthy();expect(screen.queryByText('A sua entidade, as suas unidades e as pessoas que a integram.')).toBeNull();expect((await screen.findByRole('link',{name:'Consultar Matching'})).getAttribute('href')).toBe('/matching');
 fireEvent.click(screen.getByRole('button',{name:'Editar descrição'}));fireEvent.change(screen.getByLabelText('Descrição'),{target:{value:'Nova descrição'}});fireEvent.click(screen.getByRole('button',{name:'Guardar alterações'}));
 await waitFor(()=>expect(api.descriptionEdit).toHaveBeenCalledTimes(1));expect(api.descriptionEdit.mock.calls[0][0]).toMatchObject({description:'Nova descrição',expectedRevision:1});expect(Object.keys(api.descriptionEdit.mock.calls[0][0])).not.toContain('revision');expect(api.profileEdit).not.toHaveBeenCalled();
})
it('creates at the organization root while preserving existing subunits',async()=>{
 mount('/perfil-organizacao/unidades');fireEvent.click(await screen.findByRole('button',{name:'Criar unidade'}));fireEvent.change(screen.getByLabelText('Nome da unidade'),{target:{value:'Financeiro'}});expect(screen.queryByLabelText('Unidade superior')).toBeNull();expect(screen.queryByRole('columnheader',{name:'Unidade superior'})).toBeNull();expect(screen.queryByRole('button',{name:'Mudar unidade superior'})).toBeNull();expect(screen.getByText('Direção › Projetos')).toBeTruthy();fireEvent.click(screen.getByRole('button',{name:'Guardar alterações'}));
 await waitFor(()=>expect(api.unitCreate).toHaveBeenCalledTimes(1));expect(api.unitCreate.mock.calls[0][0]).toMatchObject({label:'Financeiro',parentScopeId:null,stableCode:null});
})
it('registers a person with multiple units and an exact primary without account fields',async()=>{
 mount('/perfil-organizacao/pessoas');fireEvent.click(await screen.findByRole('button',{name:'Registar pessoa'}));fireEvent.change(screen.getByLabelText('Nome da pessoa'),{target:{value:'Carla'}});
 fireEvent.click(screen.getByRole('checkbox',{name:'Direção'}));fireEvent.click(screen.getByRole('checkbox',{name:'Direção › Projetos'}));fireEvent.change(screen.getByLabelText('Unidade principal'),{target:{value:'unit-b'}});fireEvent.click(screen.getByRole('button',{name:'Guardar alterações'}));
 await waitFor(()=>expect(api.personCreate).toHaveBeenCalledTimes(1));expect(api.personCreate.mock.calls[0][0]).toMatchObject({name:'Carla',unitIds:['unit-a','unit-b'],primaryUnitId:'unit-b'});expect(api.personCreate.mock.calls[0][0].membershipId).toBeUndefined();
})
it.each([
 ['Renomear','Nome da unidade','Direção revista','unitRename',{label:'Direção revista',expectedRevision:1}],
])('submits %s with the original unit identity and revision',async(action,label,value,method,body)=>{
 api[method].mockResolvedValueOnce({data:{}});mount('/perfil-organizacao/unidades');
 fireEvent.click((await screen.findAllByRole('button',{name:action}))[0]);fireEvent.change(screen.getByLabelText(label),{target:{value}});
 fireEvent.click(screen.getByRole('button',{name:'Guardar alterações'}));await waitFor(()=>expect(api[method]).toHaveBeenCalledTimes(1));
 expect(api[method]).toHaveBeenCalledWith('unit-a',expect.objectContaining({...body,idempotencyKey:expect.any(String)}));
 await waitFor(()=>expect(screen.queryByRole('dialog')).toBeNull());await screen.findByText('Alterações guardadas.');
})
it('hides mutations for a reader while retaining people and unit information',async()=>{
 api.context.mockResolvedValue({data:{...info,permissions:{...info.permissions,edit:false}}});mount('/perfil-organizacao/pessoas');await screen.findByText('Ana');expect(screen.queryByRole('button',{name:'Registar pessoa'})).toBeNull();expect(screen.queryByRole('button',{name:'Editar Ana'})).toBeNull();expect(screen.getByText(/Acesso de consulta/)).toBeTruthy();
})
it('repeats exactly the uncertain write and clears an authoritative refusal',async()=>{
 api.unitCreate.mockRejectedValueOnce({response:{status:503}}).mockRejectedValueOnce({response:{status:409,data:{error:{code:'STATE_CONFLICT'}}}});
 mount('/perfil-organizacao/unidades');fireEvent.click(await screen.findByRole('button',{name:'Criar unidade'}));fireEvent.change(screen.getByLabelText('Nome da unidade'),{target:{value:'Operações'}});fireEvent.click(screen.getByRole('button',{name:'Guardar alterações'}));
 const retry=await screen.findByRole('button',{name:'Repetir o mesmo envio'});await waitFor(()=>expect(retry.disabled).toBe(false));
 const dialog=screen.getByRole('dialog');expect(dialog.contains(retry)).toBe(true);expect(dialog.contains(screen.getByRole('alert'))).toBe(true);
 fireEvent.keyDown(document.activeElement,{key:'Escape'});expect(screen.getByRole('dialog')).toBe(dialog);expect(screen.getByRole('button',{name:'Cancelar'}).matches(':disabled')).toBe(true);
 fireEvent.click(retry);await waitFor(()=>expect(api.unitCreate).toHaveBeenCalledTimes(2));
 expect(api.unitCreate.mock.calls[0][0]).toEqual(api.unitCreate.mock.calls[1][0]);await waitFor(()=>expect(screen.queryByRole('button',{name:'Repetir o mesmo envio'})).toBeNull());expect(sessionStorage.getItem(directoryIntentKey('user-a','org-a'))).toBeNull();
})
it('discards late responses and form values when organization changes',async()=>{
 let resolve;api.context.mockImplementationOnce(()=>new Promise(r=>{resolve=r}));const view=mount();await waitFor(()=>expect(resolve).toBeTypeOf('function'));auth.organization={id:'org-b'};api.context.mockResolvedValue({data:{...info,organization:{...info.organization,id:'org-b',name:'Entidade B'}}});
 view.rerender(<MemoryRouter><OrganizationProfile/></MemoryRouter>);await screen.findAllByText('Entidade B');resolve({data:info});await waitFor(()=>expect(screen.queryByRole('heading',{name:'Entidade C4G'})).toBeNull());
})
it('retains filters on pagination and clears saved intentions at logout',async()=>{
 api.people.mockResolvedValueOnce({data:{items:[person],nextCursor:'page-2'}}).mockResolvedValueOnce({data:{items:[{...person,personId:'person-b',name:'Bruno'}],nextCursor:null}});
 mount('/perfil-organizacao/pessoas');fireEvent.click(await screen.findByRole('button',{name:'Mais pessoas'}));await screen.findByText('Bruno');expect(screen.getByText('Ana')).toBeTruthy();expect(api.people.mock.calls[1][0]).toEqual({search:'',unitId:'',status:'ACTIVE',cursor:'page-2'});
 sessionStorage.setItem(directoryIntentKey('user-a','org-a'),'private');clearDirectoryIntentions();expect(sessionStorage.length).toBe(0);
})

it('omits redundant profile and navigation information controls',async()=>{
 mount();await screen.findByRole('button',{name:'Editar descrição'});
 expect(screen.queryByRole('button',{name:'Informação sobre a apresentação da organização'})).toBeNull();
 expect(screen.queryByRole('button',{name:'Informação sobre competências e Matching'})).toBeNull();
})
it('omits hierarchy explanation already represented by unit controls',async()=>{
 mount('/perfil-organizacao/unidades');await screen.findByRole('button',{name:'Criar unidade'});
 expect(screen.queryByRole('button',{name:'Informação sobre a hierarquia das unidades'})).toBeNull();
})

it('clears people filters and restores the active people scope', async () => {
  mount('/perfil-organizacao/pessoas')
  const search = await screen.findByRole('searchbox')
  fireEvent.change(search, { target: { value: 'Ana' } })
  fireEvent.change(screen.getByRole('combobox', { name: 'Estado' }), { target: { value: 'ALL' } })
  fireEvent.click(screen.getByRole('button', { name: 'Aplicar filtros' }))
  await waitFor(() => expect(api.people).toHaveBeenLastCalledWith({ search: 'Ana', unitId: '', status: 'ALL' }))
  fireEvent.click(screen.getByRole('button', { name: 'Limpar filtros' }))
  await waitFor(() => expect(api.people).toHaveBeenLastCalledWith({ search: '', unitId: '', status: 'ACTIVE' }))
  expect(search.value).toBe('')
})
it('combines thematic area with other filters, preserves it for pagination and clears it',async()=>{
 const areas=[{id:'area-a',name:'Ambiente'},{id:'area-b',name:'Saúde'}]
 api.people.mockResolvedValue({data:{items:[person],nextCursor:'next',areas}})
 mount('/perfil-organizacao/pessoas')
 await screen.findByRole('option',{name:'Ambiente'})
 fireEvent.change(screen.getByLabelText('Área temática'),{target:{value:'area-a'}})
 fireEvent.change(screen.getByPlaceholderText('Nome, email ou função'),{target:{value:'Ana'}})
 fireEvent.change(screen.getByLabelText('Departamento / Unidade'),{target:{value:'unit-a'}})
 fireEvent.change(screen.getByLabelText('Estado'),{target:{value:'ALL'}})
 fireEvent.click(screen.getByRole('button',{name:'Aplicar filtros'}))
 await waitFor(()=>expect(api.people).toHaveBeenLastCalledWith({search:'Ana',unitId:'unit-a',status:'ALL',areaId:'area-a'}))
 await waitFor(()=>expect(screen.getByRole('button',{name:'Mais pessoas'}).disabled).toBe(false))
 api.people.mockResolvedValueOnce({data:{items:[],nextCursor:null,areas}})
 fireEvent.click(screen.getByRole('button',{name:'Mais pessoas'}))
 await waitFor(()=>expect(api.people).toHaveBeenLastCalledWith({search:'Ana',unitId:'unit-a',status:'ALL',areaId:'area-a',cursor:'next'}))
 fireEvent.change(screen.getByLabelText('Área temática'),{target:{value:'area-b'}})
 await waitFor(()=>expect(screen.getByRole('button',{name:'Aplicar filtros'}).disabled).toBe(false))
 fireEvent.click(screen.getByRole('button',{name:'Aplicar filtros'}))
 await waitFor(()=>expect(api.people).toHaveBeenLastCalledWith({search:'Ana',unitId:'unit-a',status:'ALL',areaId:'area-b'}))
 fireEvent.click(screen.getByRole('button',{name:'Limpar filtros'}))
 await waitFor(()=>expect(api.people).toHaveBeenLastCalledWith({search:'',unitId:'',status:'ACTIVE'}))
 expect(screen.getByLabelText('Área temática').value).toBe('')
})
it('opens the people directory with the unit filter and carries it into the person link',async()=>{
 const list=mount('/perfil-organizacao/unidades')
 const target=(await screen.findByRole('link',{name:'Ver pessoas de Direção'})).getAttribute('href')
 list.unmount()
 mount(target)
 await screen.findByRole('link',{name:'Ana'})
 expect(api.people).toHaveBeenLastCalledWith({search:'',unitId:'unit-a',status:'ACTIVE'})
 expect(screen.getByLabelText('Departamento / Unidade').value).toBe('unit-a')
 expect(screen.getByRole('link',{name:'Ana'}).getAttribute('href')).toBe('/perfil-organizacao/pessoas/person-a?unitId=unit-a')
 fireEvent.click(screen.getByRole('button',{name:'Limpar filtros'}))
 await waitFor(()=>expect(api.people).toHaveBeenLastCalledWith({search:'',unitId:'',status:'ACTIVE'}))
})
it('presents institutional values without editing actions when the directory is read-only',async()=>{
 api.context.mockResolvedValue({data:{...info,registration,permissions:{...info.permissions,edit:false}}})
 mount()
 await screen.findByRole('heading',{name:'Ficha da entidade'})
 expect(screen.getByText(registration.fields.institutionalEmail)).toBeTruthy()
 expect(screen.queryByRole('button',{name:'Editar descrição'})).toBeNull()
 expect(screen.queryByRole('button',{name:'Editar ficha'})).toBeNull()
})
it('keeps confirmed fiscal identity read-only while contact fields can be edited and cancelled',async()=>{
 api.context.mockResolvedValue({data:{...info,registration}})
 mount()
 fireEvent.click(await screen.findByRole('button',{name:'Editar ficha'}))
 expect(screen.getByLabelText(/^NIF/).readOnly).toBe(true)
 expect(screen.getByLabelText(/^Email institucional/).readOnly).toBe(false)
 fireEvent.change(screen.getByLabelText(/^Email institucional/),{target:{value:'draft@example.invalid'}})
 fireEvent.click(screen.getByRole('button',{name:'Cancelar'}))
 expect(api.registrationProfile).not.toHaveBeenCalled()
 expect(screen.getByText(registration.fields.institutionalEmail)).toBeTruthy()
})

it('reuses the confirmed context between pages, reads it again and hides everything when it is refused',async()=>{
 mount()
 await screen.findByText('Trabalho da entidade')
 await waitFor(()=>expect(api.units).toHaveBeenCalledTimes(1))
 await new Promise(resolve=>setTimeout(resolve,0))
 let refuse;api.context.mockReturnValueOnce(new Promise((resolve,reject)=>{refuse=reject}))
 fireEvent.click(screen.getByRole('link',{name:'Ver departamentos e unidades'}))
 expect(await screen.findByRole('link',{name:'Ver pessoas de Direção'})).toBeTruthy()
 refuse({response:{status:403,data:{error:{code:'NOT_AUTHORIZED'}}}})
 expect((await screen.findByRole('alert')).textContent).toContain('Não tem permissão')
 expect(screen.queryByRole('link',{name:'Ver pessoas de Direção'})).toBeNull()
 cleanup();mount('/perfil-organizacao/pessoas')
 expect(screen.queryByText('Ana')).toBeNull()
 await screen.findByText('Ana')
})

it('removes people shown from memory when reading them again is refused and after a save',async()=>{
 mount('/perfil-organizacao/pessoas')
 await screen.findByText('Ana')
 cleanup();api.people.mockRejectedValueOnce({response:{status:403,data:{error:{code:'NOT_AUTHORIZED'}}}});mount('/perfil-organizacao/pessoas')
 expect(await screen.findByText('Ana')).toBeTruthy()
 expect((await screen.findByRole('alert')).textContent).toContain('Não tem permissão')
 expect(screen.queryByText('Ana')).toBeNull()
 cleanup();mount('/perfil-organizacao/pessoas')
 await screen.findByText('Ana')
 fireEvent.click(screen.getByRole('button',{name:'Editar Ana'}))
 api.personEdit.mockResolvedValue({data:person});api.people.mockResolvedValue({data:{items:[{...person,name:'Ana Maria'}],nextCursor:null}})
 fireEvent.click(await screen.findByRole('button',{name:'Guardar alterações'}))
 await screen.findByText('Ana Maria')
 cleanup();mount('/perfil-organizacao/pessoas')
 expect(await screen.findByText('Ana Maria')).toBeTruthy()
 expect(screen.queryByText('Ana')).toBeNull()
})

it('shows the units already confirmed on return and removes them when the permission is withdrawn',async()=>{
 mount('/perfil-organizacao/unidades')
 await screen.findByRole('link',{name:'Ver pessoas de Direção'})
 cleanup();api.context.mockReturnValueOnce(new Promise(()=>{}));mount('/perfil-organizacao/unidades')
 expect(await screen.findByRole('link',{name:'Ver pessoas de Direção'})).toBeTruthy()
 expect(screen.queryByText('A carregar a organização…')).toBeNull()
 cleanup();api.context.mockResolvedValue({data:{...info,permissions:{...info.permissions,units:false}}});mount('/perfil-organizacao/unidades')
 await screen.findByText('Sem permissão para consultar a estrutura completa da organização.')
 expect(screen.queryByRole('link',{name:'Ver pessoas de Direção'})).toBeNull()
})
