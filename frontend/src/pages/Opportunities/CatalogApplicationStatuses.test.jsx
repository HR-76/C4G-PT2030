import {afterEach, beforeEach, expect, it, vi} from 'vitest'
import {act, cleanup, fireEvent, render, screen} from '@testing-library/react'
import {MemoryRouter} from 'react-router-dom'
const summaries = vi.hoisted(() => vi.fn())
vi.mock('../../api/api', () => ({privateApplicationsApi: {opportunitySummaries: summaries}}))
import CatalogApplicationStatuses, {ApplicationStatusCell} from './CatalogApplicationStatuses'

const zero = id => ({opportunityId:id,count:0,statuses:{},applicationId:null})
const single = (id,status='APPROVED') => ({opportunityId:id,count:1,statuses:{[status]:1},applicationId:'application-'+id})
const content = (organizationId='org-a', scope='user:org-a', ids=['one']) => <MemoryRouter><CatalogApplicationStatuses organizationId={organizationId} scope={scope} items={ids.map(id=>({id}))}>{ids.map(id=><div key={id} data-testid={id}><ApplicationStatusCell id={id}/></div>)}</CatalogApplicationStatuses></MemoryRouter>
beforeEach(() => {vi.resetAllMocks()})
afterEach(cleanup)

it('shows the existing application status colours and exact links for each visible opportunity',async()=>{
 summaries.mockResolvedValue({data:{items:[single('one'),single('two','SUBMITTED'),single('three','REJECTED')]}})
 render(content('org-a','user:org-a',['one','two','three']))
 expect((await screen.findByText('Aprovada')).classList.contains('chip-green')).toBe(true)
 expect(screen.getByText('Submetida').classList.contains('chip-orange')).toBe(true)
 expect(screen.getByText('Reprovada').classList.contains('chip-red')).toBe(true)
 expect(screen.getByText('Aprovada').closest('a').getAttribute('href')).toBe('/candidaturas/application-one')
 expect(summaries).toHaveBeenCalledWith(['one','two','three'],expect.any(AbortSignal))
})

it('preserves several statuses and their counts rather than selecting one as the application state',async()=>{
 summaries.mockResolvedValue({data:{items:[{opportunityId:'one',count:3,statuses:{PREPARATION:2,APPROVED:1},applicationId:null}]}})
 render(content())
 expect((await screen.findByRole('link',{name:'3 candidaturas'})).getAttribute('href')).toBe('/candidaturas?oportunidade=one')
 expect(screen.getByText('2 Em preparação').classList.contains('chip-blue')).toBe(true)
 expect(screen.getByText('1 Aprovada').classList.contains('chip-green')).toBe(true)
})

it('only declares no applications after a complete successful response',async()=>{
 summaries.mockResolvedValue({data:{items:[zero('one')]}})
 render(content())
 expect(screen.queryByText('Sem candidaturas visíveis')).toBeNull()
 await screen.findByText('Sem candidaturas visíveis')
})

it.each([403,503])('keeps access or service failure %s distinct from zero and offers a fresh retry',async status=>{
 summaries.mockRejectedValueOnce({response:{status}}).mockResolvedValueOnce({data:{items:[single('one')]}})
 render(content())
 await screen.findByRole('alert')
 expect(screen.getByTestId('one').textContent).toBe('Indisponível')
 expect(screen.queryByText('Sem candidaturas visíveis')).toBeNull()
 fireEvent.click(screen.getByRole('button',{name:'Repetir consulta de candidaturas'}))
 await screen.findByText('Aprovada')
 expect(summaries).toHaveBeenCalledTimes(2)
})

it('refuses an incomplete or foreign response instead of exposing another opportunity status',async()=>{
 summaries.mockResolvedValue({data:{items:[single('other')]}})
 render(content());await screen.findByRole('alert')
 expect(screen.queryByText('Aprovada')).toBeNull()
})

it('clears old status immediately on organization or user scope change and ignores the late response',async()=>{
 let finish
 summaries.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve})).mockResolvedValueOnce({data:{items:[zero('one')]}})
 const view=render(content())
 const signal=summaries.mock.calls[0][1]
 view.rerender(content('org-b','second-user:org-b'))
 expect(signal.aborted).toBe(true)
 await screen.findByText('Sem candidaturas visíveis')
 await act(async()=>{finish({data:{items:[single('one')]}})})
 expect(screen.queryByText('Aprovada')).toBeNull()
 expect(screen.getByTestId('one').textContent).toBe('Sem candidaturas visíveis')
})

it('does not make private requests without an organization or visible rows',()=>{
 const view=render(content(null,'',[]));expect(summaries).not.toHaveBeenCalled()
 view.rerender(content(null,'',['one']));expect(summaries).not.toHaveBeenCalled()
 view.rerender(content('org-a','user:org-a',[]));expect(summaries).not.toHaveBeenCalled()
})

it('removes an already displayed status synchronously when the user scope changes',async()=>{
 summaries.mockResolvedValueOnce({data:{items:[single('one')]}}).mockImplementationOnce(()=>new Promise(()=>{}))
 const view=render(content());await screen.findByText('Aprovada')
 view.rerender(content('org-a','another-user:org-a'))
 expect(screen.queryByText('Aprovada')).toBeNull()
 expect(screen.getByTestId('one').textContent).toBe('A consultar…')
})
