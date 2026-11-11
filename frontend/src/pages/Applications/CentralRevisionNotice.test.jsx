import React from 'react'
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
const get=vi.hoisted(()=>vi.fn())
vi.mock('../../api/api',()=>({centralOpportunitiesApi:{get}}))
import CentralRevisionNotice from './CentralRevisionNotice'
afterEach(()=>{cleanup();get.mockReset()})
const record={origin:'CENTRAL',opportunityId:'one',centralRevisionId:'old',opportunityClosingDate:'2026-10-01'}
it('shows changed deadlines without changing the application revision or internal deadline',async()=>{
 get.mockResolvedValue({data:{revisionId:'new',snapshot:{closingDate:'2026-12-01'},temporal:{state:'OPEN'}}})
 render(<MemoryRouter><CentralRevisionNotice record={record}/></MemoryRouter>)
 expect(await screen.findByText(/O prazo publicado mudou/)).toBeTruthy()
 expect(screen.getByText(/A candidatura mantém a revisão original/)).toBeTruthy()
 expect(record.centralRevisionId).toBe('old')
})
it('does not announce a change when the source revision is unchanged',async()=>{
 get.mockResolvedValue({data:{revisionId:'old',snapshot:{closingDate:'2026-10-01'}}})
 render(<MemoryRouter><CentralRevisionNotice record={record}/></MemoryRouter>)
 await waitFor(()=>expect(get).toHaveBeenCalledWith('one'))
 expect(screen.queryByRole('status')).toBeNull()
})
it('does not fetch central data for a private application',()=>{
 render(<MemoryRouter><CentralRevisionNotice record={{...record,origin:'PRIVATE'}}/></MemoryRouter>)
 expect(get).not.toHaveBeenCalled()
})
