import { afterEach, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { ApplicationInformation } from './ApplicationPresentation'
import { dateLabel } from './lifecycle'

afterEach(cleanup)

it('shows the same civil deadline in application views', () => {
  const deadline = '2026-12-31'
  render(<ApplicationInformation app={{ internal_deadline: deadline }} formatBudget={() => null} />)
  expect(dateLabel(deadline)).toBe('31/12/2026')
  expect(screen.getByText('31/12/2026')).toBeTruthy()
})

it('preserves the missing deadline and optional date presentation', () => {
  render(<ApplicationInformation app={{}} formatBudget={() => null} />)
  expect(dateLabel(null)).toBe('—')
  expect(screen.getByText('Não definido')).toBeTruthy()
  expect(screen.queryByText('Prazo oportunidade')).toBeNull()
  expect(screen.queryByText('Criado em')).toBeNull()
})
