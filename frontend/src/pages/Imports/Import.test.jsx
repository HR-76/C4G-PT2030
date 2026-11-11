import {afterEach, beforeEach, expect, it, vi} from 'vitest'
import {act, cleanup, fireEvent, render, screen, waitFor} from '@testing-library/react'
import {MemoryRouter} from 'react-router-dom'
vi.mock('../../api/api', () => ({platformImportsApi:{availability:vi.fn(),upload:vi.fn(),preview:vi.fn()},importsApi: {list:vi.fn(), upload:vi.fn(), preview:vi.fn(), confirm:vi.fn(), get:vi.fn(), cancel:vi.fn(), review:vi.fn(), report:vi.fn()}}))
let session
vi.mock('../../contexts/AuthContext', () => ({useAuth: () => session}))
import Import, {ImportWorkspace} from '../Import'
import {importsApi as api,platformImportsApi} from '../../api/api'
import {ImportPreview, ImportResult} from './ImportPresentation'
const job = {importId:'import-1', state:'UPLOADED', totalRows:2, validRows:1, errorRows:1, processedRows:0, createdRows:0, exactRows:0, possibleRows:0, rejectedRows:0, conflictRows:0, createdAt:'2026-10-18T10:00:00Z'}
const sheets = [{index:0,name:'Avisos'}]
const preview = {sheetName:'Avisos',totalRows:2,validRows:1,errorRows:1,mapping:{fields:{title:{source:'Designação do Aviso'}},ignored:['Dotação Fundo']},preview:[{line:3,externalIdentifier:'PT-1',snapshot:{title:'Aviso válido',programmeName:'NORTE2030',openingDate:'2026-10-18',closingDate:'2026-12-01'}}],errors:[{line:4,codes:['IMPORT_TITLE_REQUIRED']}]}
const deferred = () => {let resolve, reject;const promise=new Promise((r,j)=>{resolve=r;reject=j});return {promise,resolve,reject}}
const ui = () => <MemoryRouter><ImportWorkspace key={session.user.id+session.organization.id} organization={session.organization}/></MemoryRouter>
beforeEach(()=>{vi.resetAllMocks();session={user:{id:'user-a'},organization:{id:'org-a',name:'Organização A'}};api.list.mockResolvedValue({data:[]});api.upload.mockResolvedValue({data:{job,sheets}});api.preview.mockResolvedValue({data:preview});api.get.mockResolvedValue({data:{job:{...job,state:'COMPLETED_WITH_ISSUES',processedRows:2,createdRows:1,rejectedRows:1},outcomes:[]}});api.confirm.mockResolvedValue({data:job})})
afterEach(cleanup)
it('restricts the new page to C4G and uses only central availability',async()=>{
 const mounted=render(<MemoryRouter><Import/></MemoryRouter>);expect(screen.getByRole('alert').textContent).toContain('administração C4G');expect(api.list).not.toHaveBeenCalled();mounted.unmount();
 expect(platformImportsApi.availability).not.toHaveBeenCalled();
 session={user:{id:'c4g',platformRoles:['C4G_ADMIN']},organization:null};platformImportsApi.availability.mockResolvedValue({data:{available:false,code:'CENTRAL_IMPORT_NOT_CONFIGURED'}});
 render(<MemoryRouter><Import/></MemoryRouter>);await screen.findByText('A importação para o catálogo C4G ainda não está disponível.');expect(screen.queryByRole('alert')).toBeNull();expect(screen.queryByLabelText(/Selecione o ficheiro/)).toBeNull();expect(screen.queryByText('Histórico de importações')).toBeNull();expect(api.list).not.toHaveBeenCalled();expect(api.upload).not.toHaveBeenCalled();expect(screen.getByRole('link',{name:'Consultar catálogo C4G'}).getAttribute('href')).toBe('/catalogo');expect(screen.getByRole('link',{name:'Obter Excel oficial'}).getAttribute('href')).toBe('https://portugal2030.pt/plano-anual-de-avisos/');
})
it('distinguishes failed availability from unavailability and allows retry',async()=>{
 session={user:{id:'c4g',platformRoles:['C4G_ADMIN']},organization:null};platformImportsApi.availability.mockRejectedValueOnce({response:{status:503}}).mockResolvedValueOnce({data:{available:false}});
 render(<MemoryRouter><Import/></MemoryRouter>);await screen.findByRole('alert');expect(screen.queryByText(/ainda não está disponível/)).toBeNull();expect(screen.getByRole('link',{name:'Obter Excel oficial'})).toBeTruthy();fireEvent.click(screen.getByRole('button',{name:'Voltar a verificar'}));await screen.findByText('A importação para o catálogo C4G ainda não está disponível.');expect(screen.queryByRole('alert')).toBeNull();expect(platformImportsApi.availability).toHaveBeenCalledTimes(2);
})
it('never enables private imports for an available or malformed central response',async()=>{
 session={user:{id:'c4g',platformRoles:['C4G_ADMIN']},organization:null};platformImportsApi.availability.mockResolvedValueOnce({data:{available:true}}).mockResolvedValueOnce({data:{}});
 render(<MemoryRouter><Import/></MemoryRouter>);await screen.findByText('O serviço está disponível, mas o envio de ficheiros por esta página ainda não está integrado.');expect(screen.queryByLabelText(/Selecione o ficheiro/)).toBeNull();fireEvent.click(screen.getByRole('button',{name:'Voltar a verificar'}));await screen.findByRole('alert');expect(api.list).not.toHaveBeenCalled();expect(api.upload).not.toHaveBeenCalled();
})
it('discards a previous administrator availability response after session changes',async()=>{
 const old=deferred();session={user:{id:'c4g-a',platformRoles:['C4G_ADMIN']},organization:null};platformImportsApi.availability.mockReturnValueOnce(old.promise).mockResolvedValueOnce({data:{available:false}});
 const mounted=render(<MemoryRouter><Import/></MemoryRouter>);session={user:{id:'c4g-b',platformRoles:['C4G_ADMIN']},organization:null};mounted.rerender(<MemoryRouter><Import/></MemoryRouter>);await screen.findByText('A importação para o catálogo C4G ainda não está disponível.');await act(async()=>old.resolve({data:{available:true}}));expect(screen.queryByText(/O serviço está disponível/)).toBeNull();
})
async function choose(){const input=screen.getByLabelText(/Selecione o ficheiro/);await waitFor(()=>expect(input.disabled).toBe(false));fireEvent.change(input,{target:{files:[new File(['xlsx'],'plan.xlsx',{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'})]}});await screen.findByRole('heading',{name:'Validar ficheiro'})}
it('uploads centrally, requires a sheet and previews without publication',async()=>{
 session={user:{id:'c4g',platformRoles:['C4G_ADMIN']},organization:null};platformImportsApi.availability.mockResolvedValue({data:{available:true,mode:'PREVIEW_ONLY'}});
 platformImportsApi.upload.mockResolvedValue({data:{requestId:'central-file',filename:'Plano.xlsx',sheets:['Avisos'],scanState:'CLEAN'}});
 platformImportsApi.preview.mockResolvedValue({data:{totalRows:1,validRows:1,errorRows:0,rows:[{line:3,values:{A:'PT-1',D:'Aviso central'},errors:[]}]}});
 render(<MemoryRouter><Import/></MemoryRouter>);fireEvent.change(await screen.findByLabelText('Ficheiro Excel oficial'),{target:{files:[new File(['xlsx'],'Plano.xlsx')]}});fireEvent.click(screen.getByRole('button',{name:'Carregar e verificar Excel'}));await screen.findByText('Ficheiro verificado');expect(screen.getByRole('button',{name:'Pré-visualizar avisos'}).disabled).toBe(true);
 fireEvent.change(screen.getByLabelText('Folha a analisar'),{target:{value:'Avisos'}});fireEvent.click(screen.getByRole('button',{name:'Pré-visualizar avisos'}));await screen.findByText('Aviso central');expect(platformImportsApi.preview).toHaveBeenCalledWith('central-file',expect.objectContaining({sheetName:'Avisos',requestId:expect.any(String)}));expect(api.upload).not.toHaveBeenCalled();expect(api.confirm).not.toHaveBeenCalled();expect(screen.queryByRole('button',{name:/Publicar|Confirmar importação/})).toBeNull();
})
it('keeps the central upload request id when an uncertain upload is retried',async()=>{
 session={user:{id:'c4g',platformRoles:['C4G_ADMIN']},organization:null};platformImportsApi.availability.mockResolvedValue({data:{available:true,mode:'PREVIEW_ONLY'}});platformImportsApi.upload.mockRejectedValueOnce({response:{status:503}}).mockResolvedValueOnce({data:{requestId:'file',filename:'Plano.xlsx',sheets:['Avisos']}});
 render(<MemoryRouter><Import/></MemoryRouter>);fireEvent.change(await screen.findByLabelText('Ficheiro Excel oficial'),{target:{files:[new File(['xlsx'],'Plano.xlsx')]}});fireEvent.click(screen.getByRole('button',{name:'Carregar e verificar Excel'}));await screen.findByRole('alert');const id=platformImportsApi.upload.mock.calls[0][0].get('requestId');fireEvent.click(screen.getByRole('button',{name:'Carregar e verificar Excel'}));await screen.findByText('Ficheiro verificado');expect(platformImportsApi.upload.mock.calls[1][0].get('requestId')).toBe(id);
})
async function validate(){await choose();fireEvent.change(screen.getByLabelText('Folha'),{target:{value:'Avisos'}});fireEvent.click(screen.getByRole('button',{name:'Validar e pré-visualizar'}));await screen.findByRole('heading',{name:'Pré-visualização'})}

it('shows configuration dependency, blocks upload and never claims empty history after failure',async()=>{
 api.list.mockRejectedValue({response:{status:503,data:{error:{code:'OPPORTUNITY_IMPORT_NOT_CONFIGURED'}}}});render(ui());
 await screen.findByText('A importação de oportunidades privadas não está disponível.');expect(screen.queryByText(/armazenamento privado|antivírus/)).toBeNull();expect(screen.getByLabelText(/Selecione o ficheiro/).disabled).toBe(true);expect(screen.queryByText(/Ainda não existem/)).toBeNull();expect(api.upload).not.toHaveBeenCalled()
})
it('uses explicit sheet selection, shows validation errors, and confirms only on user action',async()=>{
 render(ui());await validate();expect(api.preview).toHaveBeenCalledWith('import-1','Avisos',{});expect(api.confirm).not.toHaveBeenCalled();expect(screen.getByText('18/10/2026')).toBeTruthy();expect(screen.getByText(/Falta a designação/)).toBeTruthy();
 fireEvent.click(screen.getByRole('button',{name:'Importar 1 linhas válidas'}));await screen.findByRole('heading',{name:'Resultado da importação'});expect(api.confirm).toHaveBeenCalledTimes(1)
})
it('requires an explicit unknown-column decision before repeating validation',async()=>{
 api.preview.mockRejectedValueOnce({response:{status:400,data:{error:{code:'IMPORT_HEADER_DECISION_REQUIRED',details:{headers:['Coluna extra']}}}}});render(ui());await choose();fireEvent.change(screen.getByLabelText('Folha'),{target:{value:'Avisos'}});fireEvent.click(screen.getByRole('button',{name:'Validar e pré-visualizar'}));await screen.findByLabelText('Coluna extra');expect(screen.getByRole('button',{name:'Validar e pré-visualizar'}).disabled).toBe(true);fireEvent.change(screen.getByLabelText('Coluna extra'),{target:{value:'IGNORE'}});fireEvent.click(screen.getByRole('button',{name:'Validar e pré-visualizar'}));await screen.findByText('Aviso válido');expect(api.preview).toHaveBeenLastCalledWith('import-1','Avisos',{'Coluna extra':'IGNORE'})
})
it('retries uncertain uploads with the same file and intention',async()=>{
 api.upload.mockRejectedValueOnce(new Error('network'));render(ui());const input=screen.getByLabelText(/Selecione o ficheiro/);await waitFor(()=>expect(input.disabled).toBe(false));const file=new File(['xlsx'],'plan.xlsx');fireEvent.change(input,{target:{files:[file]}});await screen.findByRole('button',{name:'Repetir envio'});const first=api.upload.mock.calls[0][0];expect(input.disabled).toBe(true);fireEvent.click(screen.getByRole('button',{name:'Repetir envio'}));await screen.findByRole('heading',{name:'Validar ficheiro'});const second=api.upload.mock.calls[1][0];expect(second.get('requestId')).toBe(first.get('requestId'));expect(second.get('file')).toBe(first.get('file'))
})
it('discards pending previews when the organization changes',async()=>{
 const pending=deferred();api.preview.mockReturnValue(pending.promise);const view=render(ui());await choose();fireEvent.change(screen.getByLabelText('Folha'),{target:{value:'Avisos'}});fireEvent.click(screen.getByRole('button',{name:'Validar e pré-visualizar'}));session={...session,organization:{id:'org-b',name:'Organização B'}};view.rerender(ui());await act(async()=>pending.resolve({data:preview}));expect(screen.queryByText('Aviso válido')).toBeNull();expect(screen.queryByRole('button',{name:/Importar 1/})).toBeNull();expect(api.confirm).not.toHaveBeenCalled()
})
it('does not chain a confirmation read into the next organization',async()=>{
 const pending=deferred();api.confirm.mockReturnValue(pending.promise);const view=render(ui());await validate();fireEvent.click(screen.getByRole('button',{name:'Importar 1 linhas válidas'}));session={...session,organization:{id:'org-b'}};view.rerender(ui());await act(async()=>pending.resolve({data:job}));expect(api.get).not.toHaveBeenCalled()
})
it('resumes a stored upload from history and preserves explicit ignored columns',async()=>{
 api.list.mockResolvedValue({data:[{...job,state:'READY_FOR_CONFIRMATION',sheetName:'Avisos'}]});api.get.mockResolvedValue({data:{job:{...job,sheetName:'Avisos',state:'READY_FOR_CONFIRMATION',mapping:{explicitlyIgnored:['Extra']}},sheets,outcomes:[]}});render(ui());fireEvent.click(await screen.findByRole('button',{name:'Continuar'}));await screen.findByRole('heading',{name:'Validar ficheiro'});fireEvent.click(screen.getByRole('button',{name:'Validar e pré-visualizar'}));await screen.findByText('Aviso válido');expect(api.preview).toHaveBeenCalledWith('import-1','Avisos',{Extra:'IGNORE'})
})
it('prevents double confirmation and returning while the confirmation is pending',async()=>{
 const pending=deferred();api.confirm.mockReturnValue(pending.promise);render(ui());await validate();fireEvent.click(screen.getByRole('button',{name:'Importar 1 linhas válidas'}));expect(screen.getByRole('button',{name:'Voltar à validação'}).disabled).toBe(true);fireEvent.click(screen.getByRole('button',{name:'A confirmar…'}));expect(api.confirm).toHaveBeenCalledTimes(1);await act(async()=>pending.resolve({data:job}))
})
it('does not download a report after changing the user',async()=>{
 const pending=deferred();api.list.mockResolvedValue({data:[{...job,state:'COMPLETED'}]});api.get.mockResolvedValue({data:{job:{...job,state:'COMPLETED',reportDocumentVersionId:'doc'},outcomes:[]}});api.report.mockReturnValue(pending.promise);const objectUrl=vi.fn();vi.stubGlobal('URL',Object.assign(URL,{createObjectURL:objectUrl}));const view=render(ui());fireEvent.click(await screen.findByRole('button',{name:'Consultar'}));fireEvent.click(await screen.findByRole('button',{name:'Descarregar relatório CSV'}));session={...session,user:{id:'user-b'}};view.rerender(ui());await act(async()=>pending.resolve({data:new Blob(['report'])}));expect(objectUrl).not.toHaveBeenCalled();vi.unstubAllGlobals()
})
it('shows all line outcomes with working opportunity routes and explicit human decisions',()=>{
 const onReview=vi.fn();render(<MemoryRouter><ImportResult detail={{job:{...job,state:'COMPLETED_WITH_ISSUES'},outcomes:[{line:3,state:'CREATED',code:'IMPORT_CREATED',resultId:'created'},{line:4,state:'EXACT',code:'IMPORT_EXACT_DUPLICATE',conflictId:'existing'},{line:5,state:'POSSIBLE',code:'IMPORT_POSSIBLE_DUPLICATE',conflictId:'possible'},{line:6,state:'INVALID',code:'IMPORT_TITLE_REQUIRED'}]}} onReview={onReview}/></MemoryRouter>);expect(screen.getByRole('link',{name:'Consultar criada'}).getAttribute('href')).toBe('/oportunidades/created');fireEvent.click(screen.getByRole('button',{name:'Não importar'}));expect(onReview).toHaveBeenCalledWith(5,'REJECT');expect(screen.getByText('Duplicada — não criada')).toBeTruthy()
})
it('prevents importing an entirely invalid file',()=>{
 render(<ImportPreview preview={{...preview,validRows:0,preview:[]}} canConfirm/>);expect(screen.getByRole('button',{name:'Importar 0 linhas válidas'}).disabled).toBe(true)
})
