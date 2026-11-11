import { describe, expect, it, vi } from 'vitest'
import { chatToText, loadWholeChat } from './chatExport'

const message = (id, body, createdAt, authorName = 'Ana') => ({ messageId: id, body, createdAt, authorName })

describe('exportação do chat', () => {
  it('segue o cursor até ao fim e devolve as mensagens em ordem cronológica', async () => {
    const pages = {
      first: { items: [message('3', 'c', '2026-11-03T10:00:00Z'), message('4', 'd', '2026-11-04T10:00:00Z')], nextCursor: 'older' },
      older: { items: [message('1', 'a', '2026-11-01T10:00:00Z'), message('2', 'b', '2026-11-02T10:00:00Z')], nextCursor: null }
    }
    const fetchPage = vi.fn(async params => ({ data: pages[params?.cursor || 'first'] }))
    const all = await loadWholeChat(fetchPage)
    expect(all.map(item => item.messageId)).toEqual(['1', '2', '3', '4'])
    expect(fetchPage).toHaveBeenNthCalledWith(1, undefined)
    expect(fetchPage).toHaveBeenNthCalledWith(2, { cursor: 'older' })
  })

  it('recusa um histórico sem fim em vez de ficar num ciclo', async () => {
    const fetchPage = async () => ({ data: { items: [], nextCursor: 'x' } })
    await expect(loadWholeChat(fetchPage)).rejects.toThrow('CHAT_EXPORT_TOO_LARGE')
  })

  it('interrompe quando o pedido é cancelado', async () => {
    const controller = new AbortController()
    controller.abort()
    await expect(loadWholeChat(async () => ({ data: { items: [], nextCursor: null } }), controller.signal)).rejects.toThrow()
  })

  it('formata hora de Lisboa, autor e mensagens com quebras de linha', () => {
    const text = chatToText([message('1', 'linha 1\nlinha 2', '2026-07-01T12:30:00Z', 'Rui')], 'Chat da candidatura')
    expect(text).toContain('Chat da candidatura')
    expect(text).toContain('Rui: linha 1 ↵ linha 2')
    expect(text).toMatch(/\[01\/07\/2026,? 13:30\]/)
  })
})
