// Export of the whole team chat as plain text, so the team can keep a copy before the 90-day retention deletes it.
const MAX_PAGES = 400

const stamp = value => new Intl.DateTimeFormat('pt-PT', {
  timeZone: 'Europe/Lisbon', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit'
}).format(new Date(value))

// Pages arrive newest first (each page is ascending); follow the cursor until the history ends.
export async function loadWholeChat(fetchPage, signal) {
  const pages = []
  let cursor
  for (let index = 0; index < MAX_PAGES; index += 1) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
    const { data } = await fetchPage(cursor ? { cursor } : undefined)
    pages.push(data.items || [])
    if (!data.nextCursor) return pages.reverse().flat()
    cursor = data.nextCursor
  }
  throw new Error('CHAT_EXPORT_TOO_LARGE')
}

export function chatToText(messages, title) {
  const lines = messages.map(message => `[${stamp(message.createdAt)}] ${message.authorName || 'Membro'}: ${String(message.body).replace(/\r?\n/g, ' ↵ ')}`)
  return `${title}\nExportado em ${stamp(new Date())}\n\n${lines.join('\n')}\n`
}

export function downloadText(text, filename) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}
