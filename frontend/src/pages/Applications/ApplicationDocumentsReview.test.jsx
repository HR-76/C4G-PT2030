import {afterEach,beforeEach,expect,it,vi} from 'vitest'
import {act,cleanup,fireEvent,render,screen,waitFor,within} from '@testing-library/react'
const api=vi.hoisted(()=>({documents:vi.fn(),documentCandidates:vi.fn(),documentHistory:vi.fn(),reviewRequest:vi.fn(),reviewReviewers:vi.fn(),reviewDecide:vi.fn(),documentLink:vi.fn(),documentUploadIntent:vi.fn(),documentUpload:vi.fn(),documentDownload:vi.fn()}))
const navigate=vi.hoisted(()=>vi.fn())
vi.mock('../../api/documentNavigation',()=>({navigateDocumentDownload:navigate}))
vi.mock('../../api/api',()=>({privateApplicationsApi:api}))
import ApplicationDocumentsReview from './ApplicationDocumentsReview'
import {applicationDocumentIntentKey} from './intentions'
const id=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0')
const props={applicationId:id(1),organizationId:id(2),userId:id(3)}
const snapshot={capabilities:{canEdit:true,canDecide:true,canUpload:true},revision:4,documents:[{documentId:id(4),versionId:id(5),filename:'dossier.pdf',canDownload:true,versionNumber:1,state:'AVAILABLE',scanState:'CLEAN',usable:true}],reviews:[{requestId:id(6),requestedBy:id(7),requestedAt:'2026-10-17T12:00:00Z',documents:[{documentId:id(4),versionId:id(5)}],stale:false,decision:'APPROVED',comment:'Decisão preservada',decidedBy:id(3),decidedAt:'2026-10-17T13:00:00Z'}],reviewsNextCursor:null}
beforeEach(()=>{vi.clearAllMocks();sessionStorage.clear();vi.stubGlobal('crypto',{randomUUID:()=>id(8),subtle:{digest:async()=>new Uint8Array(32).fill(7).buffer}});api.documents.mockResolvedValue({data:snapshot});api.documentCandidates.mockResolvedValue({data:{items:[],nextCursor:null}});api.documentHistory.mockResolvedValue({data:{items:[],nextCursor:null}});api.documentLink.mockResolvedValue({data:{revision:5}});api.documentUploadIntent.mockResolvedValue({data:{versionId:id(10),capability:'fixture-capability'}});api.documentUpload.mockResolvedValue({data:{state:'PENDING_SCAN'}})})
afterEach(()=>{cleanup();vi.useRealTimers();vi.unstubAllGlobals()})
it('submits a new review only after choosing an eligible reviewer',async()=>{
 api.reviewReviewers.mockResolvedValue({data:{items:[{membershipId:id(12),name:'Revisora elegível'}],nextCursor:null}})
 api.reviewRequest.mockResolvedValue({data:{revision:5}})
 render(<ApplicationDocumentsReview {...props}/>)
 const submit=await screen.findByRole('button',{name:'Solicitar revisão do conjunto atual'})
 expect(submit.disabled).toBe(true)
 fireEvent.click(screen.getByRole('button',{name:'Consultar revisores elegíveis'}))
 fireEvent.change(await screen.findByLabelText('Revisor'),{target:{value:id(12)}})
 fireEvent.click(submit)
 await waitFor(()=>expect(api.reviewRequest).toHaveBeenCalledWith(id(1),{reviewerMembershipId:id(12),expectedRevision:4,idempotencyKey:id(8)},id(2)))
})
it('does not request association candidates for read-only access',async()=>{
 api.documents.mockResolvedValue({data:{...snapshot,capabilities:{canEdit:false,canDecide:false,canUpload:false}}})
 render(<ApplicationDocumentsReview {...props}/>);
 await screen.findByText('dossier.pdf');
 expect(api.documentCandidates).not.toHaveBeenCalled();
 await waitFor(()=>expect(api.documentHistory).toHaveBeenCalled());
})
it('keeps incomplete review dates readable and secondary history collapsed',async()=>{
 api.documents.mockResolvedValue({data:{...snapshot,reviews:[{...snapshot.reviews[0],requestedAt:null,decidedAt:'invalid'}]}})
 api.documentHistory.mockResolvedValue({data:{items:[{revision:1,kind:'REVIEW_DECIDED',recordedAt:null,actorSubjectId:id(3)}],nextCursor:null}})
 render(<ApplicationDocumentsReview {...props}/>)
 await screen.findByText('Decisão preservada',{selector:'.document-decision p'})
 expect(screen.queryByText(/Invalid Date|01\/01\/1970/)).toBeNull()
 expect(screen.getAllByText(/Data não disponível/).length).toBeGreaterThan(1)
 const history=screen.getByText('Histórico documental',{selector:'summary'}).parentElement
 expect(history.open).toBe(false)
 expect(screen.getByRole('heading',{name:'Revisão interna'})).toBeTruthy()
})
it('download refusal preserves uncertain writes and removes the retry incentive',async()=>{
 const key=applicationDocumentIntentKey(props.userId,props.organizationId,props.applicationId)
 const pending={...props,method:'reviewDecide',payload:{requestId:id(6)},idempotencyKey:id(8)}
 sessionStorage.setItem(key,JSON.stringify(pending));api.documentDownload.mockReturnValue('/api/applications/synthetic/documents/versions/synthetic/download')
 navigate.mockImplementation((url,onError)=>{onError({response:{status:403}});return()=>{}})
 render(<ApplicationDocumentsReview {...props}/>);fireEvent.click(await screen.findByRole('button',{name:'Descarregar versão'}))
 expect(api.documentDownload).toHaveBeenCalledWith(props.applicationId,id(5));expect(navigate).toHaveBeenCalledTimes(1)
 expect((await screen.findByRole('alert')).textContent).toMatch(/acesso.*removido|autorização documental/i)
 expect(JSON.parse(sessionStorage.getItem(key))).toEqual(pending);expect(screen.queryByRole('button',{name:'Repetir o mesmo envio'})).toBeNull()
})
it('shows a confirmed decision without waiting for candidate and history reads',async()=>{
 api.documentCandidates.mockImplementation(()=>new Promise(()=>{}))
 api.documentHistory.mockImplementation(()=>new Promise(()=>{}))
 render(<ApplicationDocumentsReview {...props}/> )
 expect(await screen.findByText('Decisão preservada',{selector:'.document-decision p'})).toBeTruthy()
 expect(screen.getByText('dossier.pdf',{selector:'strong'})).toBeTruthy()
})
it('bounds processing polling to 30 seconds even with a stalled response and ignores its late approval',async()=>{
 vi.useFakeTimers()
 let resolveLate
 const scanning={versionId:id(10),filename:'proposal.docx',state:'SCANNING',scanState:'PENDING',usable:false}
 api.documentCandidates.mockResolvedValueOnce({data:{items:[],nextCursor:null}})
  .mockResolvedValueOnce({data:{items:[scanning],nextCursor:null}})
  .mockImplementationOnce(()=>new Promise(resolve=>{resolveLate=resolve}))
 await act(async()=>render(<ApplicationDocumentsReview {...props}/>))
 const file={name:'proposal.docx',type:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',size:18,arrayBuffer:async()=>new Uint8Array(18).buffer}
 await act(async()=>{fireEvent.change(screen.getByLabelText('Ficheiro documental'),{target:{files:[file]}})})
 await act(async()=>{fireEvent.click(screen.getByRole('button',{name:'Iniciar upload seguro'}))})
 await act(async()=>{await vi.advanceTimersByTimeAsync(1000)})
 expect(api.documentCandidates).toHaveBeenCalledTimes(3)
 await act(async()=>{await vi.advanceTimersByTimeAsync(29000)})
 expect(screen.getByText(/continua em processamento/)).toBeTruthy()
 expect(screen.queryByRole('alert')).toBeNull()
 await act(async()=>{resolveLate({data:{items:[{...scanning,state:'AVAILABLE',scanState:'CLEAN',usable:true}],nextCursor:null}})})
 expect(screen.getByRole('button',{name:'Associar versão'}).disabled).toBe(true)
 await act(async()=>{await vi.advanceTimersByTimeAsync(60000)})
 expect(api.documentCandidates).toHaveBeenCalledTimes(3)
})
it('keeps an uncertain decision for retry with the same idempotency key',async()=>{
 api.documents.mockResolvedValue({data:{...snapshot,revision:3,reviews:[{...snapshot.reviews[0],decision:null,comment:null,decidedBy:null,decidedAt:null}]}})
 api.reviewDecide.mockRejectedValueOnce({response:{status:503}}).mockResolvedValueOnce({data:{revision:4}})
 const view=render(<ApplicationDocumentsReview {...props}/> )
 fireEvent.change(await screen.findByLabelText('Comentário'),{target:{value:'Revisto'}})
 fireEvent.click(screen.getByRole('button',{name:'Registar decisão'}))
 const retry=await screen.findByRole('button',{name:'Repetir o mesmo envio'})
 const key=applicationDocumentIntentKey(props.userId,props.organizationId,props.applicationId)
 const first=JSON.parse(sessionStorage.getItem(key))
 expect(first.payload.comment).toBe('Revisto')
 view.unmount();render(<ApplicationDocumentsReview {...props}/> )
 fireEvent.click(await screen.findByRole('button',{name:'Repetir o mesmo envio'}))
 await waitFor(()=>expect(api.reviewDecide).toHaveBeenCalledTimes(2))
 expect(api.reviewDecide.mock.calls[1][1].idempotencyKey).toBe(first.idempotencyKey)
 await waitFor(()=>expect(sessionStorage.getItem(key)).toBeNull())
})
it('preserves an uncertain decision but stops retry prompts after authorization is revoked',async()=>{
 api.documents.mockResolvedValue({data:{...snapshot,revision:3,reviews:[{...snapshot.reviews[0],decision:null,comment:null,decidedBy:null,decidedAt:null}]}})
 api.reviewDecide.mockRejectedValue({response:{status:403,data:{error:{code:'NOT_AUTHORIZED'}}}})
 render(<ApplicationDocumentsReview {...props}/> )
 fireEvent.change(await screen.findByLabelText('Comentário'),{target:{value:'Revisto'}})
 fireEvent.click(screen.getByRole('button',{name:'Registar decisão'}))
 expect((await screen.findByRole('alert')).textContent).toContain('acesso à organização foi removido')
 const key=applicationDocumentIntentKey(props.userId,props.organizationId,props.applicationId)
 expect(JSON.parse(sessionStorage.getItem(key)).payload.comment).toBe('Revisto')
 expect(screen.getByRole('status').textContent).toContain('A intenção foi preservada')
 expect(screen.queryByRole('button',{name:'Repetir o mesmo envio'})).toBeNull()
})
it('presents an expired session as authentication recovery rather than a service retry',async()=>{
 const refusal={response:{status:401,data:{error:{code:'SESSION_REQUIRED'}}}}
 api.documents.mockRejectedValue(refusal);api.documentCandidates.mockRejectedValue(refusal);api.documentHistory.mockRejectedValue(refusal)
 render(<ApplicationDocumentsReview {...props}/> )
 expect((await screen.findByRole('alert')).textContent).toContain('Volte a autenticar-se e selecione a organização')
 expect(screen.queryByText(/Serviço indisponível/)).toBeNull()
 expect(screen.queryByRole('button',{name:'Repetir o mesmo envio'})).toBeNull()
})
it('does not offer a pending decision from another application',async()=>{
 const key=applicationDocumentIntentKey(props.userId,props.organizationId,props.applicationId)
 sessionStorage.setItem(key,JSON.stringify({...props,method:'reviewDecide',payload:{requestId:id(6),decision:'APPROVED',comment:'Anterior',expectedRevision:3},idempotencyKey:id(8)}))
 render(<ApplicationDocumentsReview {...props} applicationId={id(9)}/> )
 await screen.findByText('Decisão preservada',{selector:'.document-decision p'})
 expect(screen.queryByRole('button',{name:'Repetir o mesmo envio'})).toBeNull()
 expect(api.reviewDecide).not.toHaveBeenCalled()
})
it('creates an intent, uploads the selected bytes and leaves association explicit until clean',async()=>{
 render(<ApplicationDocumentsReview {...props}/> )
 await screen.findByText('dossier.pdf',{selector:'strong'})
 expect(screen.getByText(/macros, objetos incorporados/).textContent).toContain('incluindo hiperligações')
 const file={name:'proposal.pdf',type:'application/pdf',size:18,arrayBuffer:async()=>new TextEncoder().encode('%PDF-1.7\nfixture').buffer}
 fireEvent.change(screen.getByLabelText('Ficheiro documental'),{target:{files:[file]}})
 fireEvent.click(screen.getByRole('button',{name:'Iniciar upload seguro'}))
 await waitFor(()=>expect(api.documentUpload).toHaveBeenCalledWith(props.applicationId,id(10),'fixture-capability',file))
 expect(api.documentUploadIntent.mock.calls[0][1]).toMatchObject({expectedSize:18,declaredMime:'application/pdf',fileClass:'PDF',filename:'proposal.pdf',versionNumber:1})
 expect(await screen.findByText('permanece indisponível até o scan terminar',{exact:false})).toBeTruthy()
 expect(api.documentLink).not.toHaveBeenCalled()
})
it('retries a lost upload-intent response with the same stable operation key',async()=>{
 const randomUUID=vi.fn().mockReturnValueOnce(id(8)).mockReturnValueOnce(id(9))
 vi.stubGlobal('crypto',{randomUUID,subtle:{digest:async()=>new Uint8Array(32).fill(7).buffer}})
 api.documentUploadIntent.mockRejectedValueOnce({response:{status:503}}).mockResolvedValueOnce({data:{versionId:id(10),capability:'replacement-capability',state:'PENDING',replayed:true}})
 render(<ApplicationDocumentsReview {...props}/> )
 await screen.findByText('dossier.pdf',{selector:'strong'})
 const file={name:'proposal.pdf',type:'application/pdf',size:18,arrayBuffer:async()=>new TextEncoder().encode('%PDF-1.7\nfixture').buffer}
 fireEvent.change(screen.getByLabelText('Ficheiro documental'),{target:{files:[file]}})
 fireEvent.click(screen.getByRole('button',{name:'Iniciar upload seguro'}))
 expect((await screen.findByRole('alert')).textContent).toContain('resultado incerto')
 fireEvent.click(screen.getByRole('button',{name:'Repetir upload seguro'}))
 await waitFor(()=>expect(api.documentUpload).toHaveBeenCalledWith(props.applicationId,id(10),'replacement-capability',file))
 expect(api.documentUploadIntent).toHaveBeenCalledTimes(2)
 expect(api.documentUploadIntent.mock.calls[1][1].idempotencyKey).toBe(api.documentUploadIntent.mock.calls[0][1].idempotencyKey)
 expect(randomUUID).toHaveBeenCalledTimes(1)
 expect(sessionStorage.getItem(`${applicationDocumentIntentKey(props.userId,props.organizationId,props.applicationId)}:upload`)).toBeNull()
})
it('enables association only for the selected usable version and sends that exact version',async()=>{
 const candidate={documentId:id(4),versionId:id(5),filename:'dossier.pdf',canDownload:true,versionNumber:1,state:'AVAILABLE',scanState:'CLEAN',usable:true}
 api.documentCandidates.mockResolvedValue({data:{items:[candidate],nextCursor:null}})
 render(<ApplicationDocumentsReview {...props}/> )
 const select=await screen.findByLabelText('Versão disponível'),button=screen.getByRole('button',{name:'Associar versão'})
 expect(button.disabled).toBe(true)
 fireEvent.change(select,{target:{value:candidate.versionId}})
 await waitFor(()=>expect(button.disabled).toBe(false))
 fireEvent.click(button)
 await waitFor(()=>expect(api.documentLink).toHaveBeenCalledWith(props.applicationId,{documentId:candidate.documentId,versionId:candidate.versionId,expectedRevision:4,idempotencyKey:id(8)}))
})
it('preserves a still-usable selection across a candidate refresh and blocks it when eligibility is lost',async()=>{
 const usable={documentId:id(4),versionId:id(5),filename:'dossier.pdf',canDownload:true,versionNumber:1,state:'AVAILABLE',scanState:'CLEAN',usable:true}
 api.documentCandidates.mockResolvedValueOnce({data:{items:[usable],nextCursor:null}}).mockResolvedValueOnce({data:{items:[usable],nextCursor:null}}).mockResolvedValueOnce({data:{items:[{...usable,state:'QUARANTINED',scanState:'REJECTED',usable:false}],nextCursor:null}})
 const view=render(<ApplicationDocumentsReview {...props}/> )
 const select=await screen.findByLabelText('Versão disponível'),button=screen.getByRole('button',{name:'Associar versão'})
 fireEvent.change(select,{target:{value:usable.versionId}});await waitFor(()=>expect(button.disabled).toBe(false))
 const file={name:'proposal.pdf',type:'application/pdf',size:18,arrayBuffer:async()=>new TextEncoder().encode('%PDF-1.7\nfixture').buffer}
 fireEvent.change(screen.getByLabelText('Ficheiro documental'),{target:{files:[file]}});fireEvent.click(screen.getByRole('button',{name:'Iniciar upload seguro'}))
 await waitFor(()=>expect(api.documentCandidates).toHaveBeenCalledTimes(2));expect(select.value).toBe(usable.versionId);expect(button.disabled).toBe(false)
 view.rerender(<ApplicationDocumentsReview {...props} organizationId={id(11)}/> )
 await waitFor(()=>expect(screen.getAllByRole('combobox')[0].value).toBe(''));expect(screen.getByRole('button',{name:/Associar/}).disabled).toBe(true)
 cleanup()
 api.documentCandidates.mockClear();api.documentCandidates.mockResolvedValueOnce({data:{items:[usable],nextCursor:null}}).mockResolvedValueOnce({data:{items:[{...usable,state:'QUARANTINED',scanState:'REJECTED',usable:false}],nextCursor:null}})
 render(<ApplicationDocumentsReview {...props}/> )
 const nextSelect=await screen.findByLabelText('Versão disponível'),nextButton=screen.getByRole('button',{name:'Associar versão'})
 fireEvent.change(nextSelect,{target:{value:usable.versionId}});await waitFor(()=>expect(nextButton.disabled).toBe(false))
 fireEvent.change(screen.getByLabelText('Ficheiro documental'),{target:{files:[file]}});fireEvent.click(screen.getByRole('button',{name:'Iniciar upload seguro'}))
 await waitFor(()=>expect(api.documentCandidates).toHaveBeenCalledTimes(2));await waitFor(()=>expect(nextButton.disabled).toBe(true));expect(nextSelect.value).toBe('')
})
it('polls only the candidate projection until the uploaded version becomes usable',async()=>{
 const scanning={documentId:id(4),versionId:id(10),filename:'proposal.docx',versionNumber:1,state:'SCANNING',scanState:'PENDING',usable:false}
 const available={...scanning,state:'AVAILABLE',scanState:'CLEAN',usable:true}
 api.documentCandidates.mockResolvedValueOnce({data:{items:[],nextCursor:null}})
  .mockResolvedValueOnce({data:{items:[scanning],nextCursor:null}})
  .mockResolvedValueOnce({data:{items:[available],nextCursor:null}})
 render(<ApplicationDocumentsReview {...props}/>);await screen.findByText('dossier.pdf',{selector:'strong'})
 const file={name:'proposal.docx',type:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',size:18,arrayBuffer:async()=>new Uint8Array(18).buffer}
 fireEvent.change(screen.getByLabelText('Ficheiro documental'),{target:{files:[file]}});fireEvent.click(screen.getByRole('button',{name:'Iniciar upload seguro'}))
 expect(await screen.findByText('permanece indisponível até o scan terminar',{exact:false})).toBeTruthy()
 expect(await screen.findByText('Documento verificado e disponível para associação.',{}, {timeout:3000})).toBeTruthy()
 expect(api.documentCandidates).toHaveBeenCalledTimes(3)
 const select=screen.getByLabelText('Versão disponível');fireEvent.change(select,{target:{value:id(10)}})
 await waitFor(()=>expect(screen.getByRole('button',{name:'Associar versão'}).disabled).toBe(false))
})
it('keeps a structurally rejected version closed and reports the terminal state',async()=>{
 const scanning={documentId:id(4),versionId:id(10),filename:'proposal.docx',versionNumber:1,state:'SCANNING',scanState:'PENDING',usable:false}
 const rejected={...scanning,state:'QUARANTINED',scanState:'CLEAN',usable:false}
 api.documentCandidates.mockResolvedValueOnce({data:{items:[],nextCursor:null}})
  .mockResolvedValueOnce({data:{items:[scanning],nextCursor:null}})
  .mockResolvedValueOnce({data:{items:[rejected],nextCursor:null}})
 render(<ApplicationDocumentsReview {...props}/>);await screen.findByText('dossier.pdf',{selector:'strong'})
 const file={name:'proposal.docx',type:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',size:18,arrayBuffer:async()=>new Uint8Array(18).buffer}
 fireEvent.change(screen.getByLabelText('Ficheiro documental'),{target:{files:[file]}});fireEvent.click(screen.getByRole('button',{name:'Iniciar upload seguro'}))
 expect((await screen.findByRole('alert',{}, {timeout:3000})).textContent).toContain('recusado pela verificação')
 expect(screen.getByRole('button',{name:'Associar versão'}).disabled).toBe(true)
})
it('ignores a candidate response from the previous organization even when it arrives last',async()=>{
 let resolveOld;const oldResponse=new Promise(resolve=>{resolveOld=resolve})
 const current={documentId:id(4),versionId:id(5),filename:'current.pdf',versionNumber:1,state:'AVAILABLE',scanState:'CLEAN',usable:true}
 api.documentCandidates.mockImplementationOnce(()=>oldResponse).mockResolvedValueOnce({data:{items:[current],nextCursor:null}})
 const view=render(<ApplicationDocumentsReview {...props}/>);await waitFor(()=>expect(api.documentCandidates).toHaveBeenCalledTimes(1))
 view.rerender(<ApplicationDocumentsReview {...props} organizationId={id(11)}/> )
 await waitFor(()=>expect(api.documentCandidates).toHaveBeenCalledTimes(2))
 expect(await screen.findByText('current.pdf',{exact:false})).toBeTruthy()
 await act(async()=>resolveOld({data:{items:[{...current,versionId:id(12),filename:'stale.pdf',usable:false}],nextCursor:null}}))
 await waitFor(()=>expect(screen.queryByText('stale.pdf',{exact:false})).toBeNull())
 expect(screen.getByText('current.pdf',{exact:false})).toBeTruthy()
})
it('explains why the current document set cannot be reviewed without claiming dossier completeness',async()=>{
 api.documents.mockResolvedValue({data:{...snapshot,documents:[{...snapshot.documents[0],state:'SCANNING',scanState:'PENDING',usable:false}],reviews:[]}})
 render(<ApplicationDocumentsReview {...props}/>);
 expect(await screen.findByText('Resolva as versões indisponíveis antes de solicitar revisão.')).toBeTruthy()
 expect(screen.getByRole('button',{name:'Solicitar revisão do conjunto atual'}).disabled).toBe(true)
 expect(screen.getByText('Em verificação')).toBeTruthy()
})
it('keeps review comments and decisions independent for each request',async()=>{
 const first={...snapshot.reviews[0],decision:null,comment:null},second={...first,requestId:id(9)}
 api.documents.mockResolvedValue({data:{...snapshot,reviews:[first,second]}})
 render(<ApplicationDocumentsReview {...props}/>);
 const comments=await screen.findAllByLabelText('Comentário'),decisions=screen.getAllByLabelText('Decisão')
 fireEvent.change(comments[0],{target:{value:'Corrigir orçamento'}})
 fireEvent.change(decisions[0],{target:{value:'CHANGES_REQUESTED'}})
 expect(comments[1].value).toBe('');expect(decisions[1].value).toBe('APPROVED')
 expect(screen.getAllByRole('button',{name:'Registar decisão'})[1].disabled).toBe(true)
})
it('labels only the exact reviewed version and keeps stale decisions historical',async()=>{
 api.documents.mockResolvedValue({data:{...snapshot,reviews:[{...snapshot.reviews[0],stale:true,documents:[{documentId:id(4),versionId:id(12)}]}]}})
 render(<ApplicationDocumentsReview {...props}/>);
 await screen.findByText(/Conjunto desatualizado/,{selector:'strong'})
 expect(screen.getByText(`${id(4)} · versão ${id(12)}`)).toBeTruthy()
 expect(screen.getByText('dossier.pdf',{selector:'strong'})).toBeTruthy()
 expect(screen.queryByRole('button',{name:'Registar decisão'})).toBeNull()
 expect(screen.getByText(/não equivale à submissão oficial/)).toBeTruthy()
})

it.each([
 ['reader',{canEdit:false,canDecide:false,canUpload:false}],
 ['editor',{canEdit:true,canDecide:false,canUpload:false}],
 ['reviewer',{canEdit:false,canDecide:true,canUpload:false}],
 ['admin',{canEdit:true,canDecide:true,canUpload:true}],
 ['missing',undefined]
])('respects independent document permissions for %s',async(_name,capabilities)=>{
 api.documents.mockResolvedValue({data:{...snapshot,capabilities,reviews:[{...snapshot.reviews[0],decision:null}]}})
 render(<ApplicationDocumentsReview {...props}/>);await screen.findByText('dossier.pdf',{selector:'strong'})
 expect(Boolean(screen.queryByRole('button',{name:'Retirar associação'}))).toBe(capabilities?.canEdit===true)
 expect(Boolean(screen.queryByRole('button',{name:'Solicitar revisão do conjunto atual'}))).toBe(capabilities?.canEdit===true)
 expect(Boolean(screen.queryByRole('button',{name:'Associar versão'}))).toBe(capabilities?.canEdit===true)
 expect(Boolean(screen.queryByLabelText('Ficheiro documental'))).toBe(capabilities?.canUpload===true)
 expect(Boolean(screen.queryByLabelText('Decisão'))).toBe(capabilities?.canDecide===true)
 expect(screen.getByRole('button',{name:'Descarregar versão'})).toBeTruthy()
})
it('preserves an uncertain decision without retry when current permission is absent',async()=>{
 const key=applicationDocumentIntentKey(props.userId,props.organizationId,props.applicationId)
 const pending={...props,method:'reviewDecide',payload:{requestId:id(6)},idempotencyKey:id(8)}
 sessionStorage.setItem(key,JSON.stringify(pending))
 api.documents.mockResolvedValue({data:{...snapshot,capabilities:{canEdit:true,canDecide:false,canUpload:true}}})
 render(<ApplicationDocumentsReview {...props}/>);await screen.findByText('dossier.pdf',{selector:'strong'})
 expect(screen.queryByRole('button',{name:'Repetir o mesmo envio'})).toBeNull()
 expect(JSON.parse(sessionStorage.getItem(key))).toEqual(pending);expect(api.reviewDecide).not.toHaveBeenCalled()
})

it('removes mutation and retry controls immediately after a decision is refused',async()=>{
 api.documents.mockResolvedValue({data:{...snapshot,reviews:[{...snapshot.reviews[0],decision:null}]}})
 api.reviewDecide.mockRejectedValue({response:{status:403}})
 render(<ApplicationDocumentsReview {...props}/>);fireEvent.change(await screen.findByLabelText('Comentário'),{target:{value:'Revisão'}})
 fireEvent.click(screen.getByRole('button',{name:'Registar decisão'}));await screen.findByRole('alert')
 expect(screen.queryByLabelText('Decisão')).toBeNull();expect(screen.queryByRole('button',{name:'Retirar associação'})).toBeNull()
 expect(screen.queryByLabelText('Ficheiro documental')).toBeNull();expect(screen.queryByRole('button',{name:'Repetir o mesmo envio'})).toBeNull()
 expect(screen.getByRole('button',{name:'Recarregar permissões documentais'})).toBeTruthy()
 expect(sessionStorage.getItem(applicationDocumentIntentKey(props.userId,props.organizationId,props.applicationId))).not.toBeNull()
})
it('refreshes capabilities with review pagination instead of keeping an obsolete grant',async()=>{
 api.documents.mockResolvedValueOnce({data:{...snapshot,reviewsNextCursor:id(20)}}).mockResolvedValueOnce({data:{...snapshot,capabilities:{canEdit:false,canDecide:false,canUpload:false},reviews:[],reviewsNextCursor:null}})
 render(<ApplicationDocumentsReview {...props}/>);fireEvent.click(await screen.findByRole('button',{name:'Pedidos anteriores'}))
 await waitFor(()=>expect(screen.queryByRole('button',{name:'Retirar associação'})).toBeNull())
 expect(screen.queryByLabelText('Ficheiro documental')).toBeNull()
})
it.each([{documentsRestricted:true},{stale:true},{requestedBy:props.userId}])('keeps review-specific restrictions despite decision permission: %j',async restriction=>{
 api.documents.mockResolvedValue({data:{...snapshot,reviews:[{...snapshot.reviews[0],decision:null,...restriction}]}})
 render(<ApplicationDocumentsReview {...props}/>);await screen.findByText('dossier.pdf',{selector:'strong'})
 expect(screen.queryByLabelText('Decisão')).toBeNull()
})
it('shows review information only for the linked version and hides an unauthorized download',async()=>{
 api.documents.mockResolvedValue({data:{...snapshot,documents:[{...snapshot.documents[0],canDownload:false}],reviews:[{...snapshot.reviews[0],documents:[{documentId:id(4),versionId:id(12)}]}]}})
 render(<ApplicationDocumentsReview {...props}/>)
 expect(await screen.findByText('Sem pedido para esta versão')).toBeTruthy()
 expect(screen.queryByRole('button',{name:'Descarregar versão'})).toBeNull()
 expect(screen.getByRole('button',{name:'Retirar associação'})).toBeTruthy()
})

it('groups requests and history by document without treating an older version as current',async()=>{
 const other={...snapshot.documents[0],documentId:id(12),versionId:id(13),filename:'orçamento.pdf',versionNumber:2}
 const changes={...snapshot.reviews[0],requestId:id(14),decision:'CHANGES_REQUESTED',comment:'Corrigir o total',documents:[{documentId:id(12),versionId:id(13)}]}
 const older={...snapshot.reviews[0],stale:true,documents:[{documentId:id(4),versionId:id(11)}]}
 api.documents.mockResolvedValue({data:{...snapshot,documents:[snapshot.documents[0],other],reviews:[changes,older]}})
 api.documentHistory.mockResolvedValue({data:{items:[
  {revision:4,kind:'REVIEW_DECIDED',requestId:changes.requestId,decision:changes.decision,recordedAt:changes.decidedAt},
  {revision:3,kind:'DOCUMENT_LINKED',documentId:id(4),versionId:id(5),recordedAt:changes.requestedAt},
  {revision:2,kind:'DOCUMENT_REMOVED',documentId:null,restricted:true,recordedAt:changes.requestedAt},
 ],nextCursor:null}})
 render(<ApplicationDocumentsReview {...props}/>)
 const first=within((await screen.findByText('dossier.pdf',{selector:'strong'})).closest('.linked-file'))
 const second=within(screen.getByText('orçamento.pdf',{selector:'strong'}).closest('.linked-file'))
 expect(first.getByText('Sem pedido para esta versão')).toBeTruthy()
 expect(second.getByText('Alterações solicitadas',{selector:'.file-review-state'})).toBeTruthy()
 const activity=second.getByText('Pedidos e histórico',{selector:'summary'}).parentElement
 expect(activity.open).toBe(false)
 expect(within(activity).getByText('Corrigir o total')).toBeTruthy()
 expect(within(activity).getByText(/Decisão registada/)).toBeTruthy()
 expect(within(activity).getByText('Consultar pedido').getAttribute('href')).toBe('#revisao-'+changes.requestId)
 expect(first.getByText(/Outra versão/)).toBeTruthy()
 expect(first.getByText('Versão associada',{selector:'.file-event-list strong'})).toBeTruthy()
 expect(first.queryByText('Corrigir o total')).toBeNull()
 expect(first.queryByText('Documento retirado')).toBeNull()
})
