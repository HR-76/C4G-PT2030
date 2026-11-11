import {afterEach,expect,it,vi} from 'vitest'
import {documentDownloadPath,navigateDocumentDownload} from '../../api/documentNavigation'
const id='00000000-0000-4000-8000-000000000001'
afterEach(()=>{document.body.innerHTML='';vi.useRealTimers()})
it('accepts only the fixed authenticated same-origin route, never a signed URL',()=>{
 expect(documentDownloadPath(id,id)).toBe(`/api/applications/${id}/documents/versions/${id}/download`)
 expect(()=>documentDownloadPath('../x',id)).toThrow()
 expect(()=>documentDownloadPath(id,id,'https://foreign.invalid/api')).toThrow()
 expect(()=>navigateDocumentDownload('https://foreign.invalid/object',vi.fn())).toThrow()
 expect(()=>navigateDocumentDownload('/api/other',vi.fn())).toThrow()
})
it('uses isolated navigation without exposing or persisting a capability',()=>{
 vi.useFakeTimers();const error=vi.fn(),dispose=navigateDocumentDownload(documentDownloadPath(id,id),error)
 const frame=document.querySelector('iframe');expect(frame.src).toContain('/download');expect(frame.referrerPolicy).toBe('no-referrer')
 expect(frame.getAttribute('sandbox')).toBe('allow-same-origin allow-downloads');expect(error).not.toHaveBeenCalled()
 dispose();expect(document.querySelector('iframe')).toBeNull()
})
