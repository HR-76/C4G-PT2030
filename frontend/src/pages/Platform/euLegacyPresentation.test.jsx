import { expect, it } from 'vitest'
import { code, money, time } from './euLegacyPresentation'

it('formats published and missing allocations', () => {
  expect(money([])).toBe('Sem dotação publicada')
  expect(money(null)).toBe('Sem dotação publicada')
  expect(money([{ amount: '1234.5', currencyState: 'PRESENT' }, { amount: '20', currencyState: 'UNKNOWN' }]))
    .toBe('1234,5 €; 20 (moeda por confirmar)')
})

it('formats instants in Lisbon time', () => {
  expect(time('2026-01-15T12:30:00Z')).toBe('15/01/26, 12:30')
  expect(time('2026-07-15T12:30:00Z')).toBe('15/07/26, 13:30')
})

it('prefers the response code, then the message, then the fallback', () => {
  expect(code({ response: { data: { error: { code: 'PACOTE_DESATUALIZADO' } } }, message: 'other' })).toBe('PACOTE_DESATUALIZADO')
  expect(code({ message: 'falha' })).toBe('falha')
  expect(code(null)).toBe('SERVICO_INDISPONIVEL')
})
