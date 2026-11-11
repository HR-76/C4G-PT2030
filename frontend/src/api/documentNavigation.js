// Navigate to the authenticated API route, which verifies and streams the attachment.
// No signed URL or whole-document XHR/blob enters application state.
export function documentDownloadPath(applicationId, versionId, base = '/api') {
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
  if (!uuid.test(applicationId) || !uuid.test(versionId)) throw new Error('INVALID_INPUT')
  const url = new URL(`${base.replace(/\/$/, '')}/applications/${applicationId}/documents/versions/${versionId}/download`, window.location.origin)
  if (url.origin !== window.location.origin) throw new Error('DOWNLOAD_ORIGIN_INVALID')
  return url.pathname
}

export function navigateDocumentDownload(url, onError) {
  const target = new URL(url, window.location.origin)
  if (target.origin !== window.location.origin || !/^\/api\/applications\/[0-9a-f-]+\/documents\/versions\/[0-9a-f-]+\/download$/i.test(target.pathname) || target.search || target.hash) throw new Error('DOWNLOAD_TARGET_INVALID')
  const frame = document.createElement('iframe')
  frame.hidden = true
  frame.referrerPolicy = 'no-referrer'
  frame.setAttribute('sandbox', 'allow-same-origin allow-downloads')
  frame.title = 'Download documental'
  let timer
  const dispose = () => { clearTimeout(timer); frame.remove() }
  frame.onload = () => {
    try {
      if (frame.contentWindow.location.href === 'about:blank') return
      const value = JSON.parse(frame.contentDocument.body.textContent)
      const code = value?.error?.code
      const status = ({SESSION_REQUIRED:401,NOT_AUTHORIZED:403,RESOURCE_NOT_AVAILABLE:404,DOCUMENT_NOT_AVAILABLE:404,SERVICE_UNAVAILABLE:503})[code] || 503
      onError({response:{status,data:{error:{code}}}})
    } catch {
      // A foreign error page is opaque; never read its content or infer success.
      onError({response:{status:503}})
    }
    dispose()
  }
  frame.src = target.href
  document.body.appendChild(frame)
  timer = setTimeout(dispose, 300000)
  return dispose
}
