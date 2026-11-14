import React from 'react'
import { afterEach, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import OpportunityDescription, { descriptionBlocks } from './OpportunityDescription'
afterEach(cleanup)

// Shape produced by the collector for a published EU cascade call: one block per line.
const published = [
  'Within the framework of the SUSA project, two partners will offer internships to degree program students.',
  'Basis for Financial Calculation',
  'GNOMON’s amount is based on a combination of the company’s standard cost model for internships and the actual licensing cost.',
  'For both METU and GNOMON, internships must be aligned with the thematic focus of the SUSA project, including but not limited to:',
  'Digital health and healthcare innovation',
  'Health data management and interoperability',
  'Eligible Participants',
  'Internship positions will be open to students enrolled in degree programs.',
  '',
  'Announcement will be published with the following cutoff dates:',
  'September 2025',
  'January 2026',
  '[Excerto — consulte as condições completas na fonte oficial.]',
].join('\n')

it('separates paragraphs, headings and lists without changing the text', () => {
  expect(descriptionBlocks(published).map(block => block.type)).toEqual(['paragraph', 'heading', 'paragraph', 'paragraph', 'list', 'heading', 'paragraph', 'paragraph', 'list', 'note'])
  render(<OpportunityDescription id="d" text={published} />)
  expect(screen.getAllByRole('heading', { level: 3 }).map(node => node.textContent)).toEqual(['Basis for Financial Calculation', 'Eligible Participants'])
  expect(screen.getAllByRole('listitem').map(node => node.textContent)).toEqual(['Digital health and healthcare innovation', 'Health data management and interoperability', 'September 2025', 'January 2026'])
  expect(document.getElementById('d').textContent).toBe(published.replace(/\n/g, ''))
})
it('keeps a single paragraph and explicit bullets as published', () => {
  expect(descriptionBlocks('O presente Aviso visa apoiar ações de formação.')).toEqual([{ type: 'paragraph', text: 'O presente Aviso visa apoiar ações de formação.' }])
  expect(descriptionBlocks('Ações elegíveis\n• Formação\n- Consultoria\nTaxa de 85%')).toEqual([
    { type: 'paragraph', text: 'Ações elegíveis' }, { type: 'list', marked: true, items: ['Formação', 'Consultoria'] }, { type: 'paragraph', text: 'Taxa de 85%' }])
})
it('renders markup in the source as text', () => {
  render(<OpportunityDescription text={'<img src=x onerror=alert(1)> texto.'} />)
  expect(document.querySelector('img')).toBeNull()
  expect(screen.getByText('<img src=x onerror=alert(1)> texto.')).toBeTruthy()
})
