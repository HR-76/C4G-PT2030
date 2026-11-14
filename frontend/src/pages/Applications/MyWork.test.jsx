import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
const mocks = vi.hoisted(() => ({ read: vi.fn(), auth: { user: { id: 'user' }, organization: { id: 'org', name: 'Organização' } } }))
vi.mock('../../api/api', () => ({ privateApplicationsApi: { myWork: mocks.read } }))
vi.mock('../../contexts/AuthContext', () => ({ useAuth: () => mocks.auth }))
import MyWork from './MyWork'
const task = { taskId: 'task', applicationId: 'app', applicationTitle: 'Eficiência energética', title: 'Rever orçamento', deadline: '2026-11-10', status: 'OPEN', group: 'overdue' }
const page = { items: [task], total: 1, counts: { overdue: 1 }, nextCursor: null }
const view = () => <MemoryRouter><MyWork /></MemoryRouter>
beforeEach(() => { mocks.auth.organization = { id: 'org', name: 'Organização' }; mocks.read.mockReset(); mocks.read.mockResolvedValue({ data: page }) })
afterEach(cleanup)
it('groups open tasks and opens an accessible read-only modal with candidature link and restored focus', async () => {
 render(view()); const button = await screen.findByRole('button', { name: 'Ver tarefa Rever orçamento' }); button.focus(); fireEvent.click(button)
 expect(screen.getByRole('dialog')).toBeTruthy(); expect(screen.getByRole('link', { name: /Abrir equipa/ }).getAttribute('href')).toBe('/candidaturas/app#equipa-tarefas')
 fireEvent.keyDown(document, { key: 'Escape' }); await waitFor(() => expect(document.activeElement).toBe(button)); expect(screen.queryByRole('dialog')).toBeNull()
})
it('sends all filters to the server and resets pagination; terminal tasks never enter overdue group', async () => {
 render(view()); await screen.findByText(task.title)
 mocks.read.mockResolvedValue({ data: { ...page, items: [{ ...task, status: 'COMPLETED', group: 'completed' }], counts: { completed: 1 } } })
 fireEvent.change(screen.getByLabelText('Candidatura'), { target: { value: 'energia' } }); fireEvent.change(screen.getByLabelText('Estado'), { target: { value: 'COMPLETED' } }); fireEvent.click(screen.getByText('Aplicar filtros'))
 await screen.findByRole('region', { name: 'Concluídas' }); expect(screen.queryByRole('region', { name: 'Em atraso' })).toBeNull()
 expect(mocks.read.mock.calls.at(-1)[0]).toEqual({ q: '', applicationQ: 'energia', status: 'COMPLETED', period: 'all' })
})
it('loads next page and clears every earlier result on denied continuation', async () => {
 mocks.read.mockResolvedValueOnce({ data: { ...page, total: 26, nextCursor: 'next' } }).mockRejectedValueOnce({ response: { status: 403 } })
 render(view()); fireEvent.click(await screen.findByText('Mais tarefas')); await screen.findByRole('alert'); expect(screen.queryByText(task.title)).toBeNull()
 expect(mocks.read.mock.calls[1][0].cursor).toBe('next')
})
it('discards a late response from a former organization and closes its modal', async () => {
 let resolve; mocks.read.mockImplementationOnce(() => new Promise(r => { resolve = r }))
 const root = render(view()); mocks.auth.organization = { id: 'other', name: 'Outra' }; mocks.read.mockResolvedValue({ data: { items: [], total: 0, counts: {} } }); root.rerender(view())
 await screen.findByText('Sem tarefas com estes filtros'); await act(async () => resolve({ data: page })); expect(screen.queryByText(task.title)).toBeNull()
 expect(mocks.read.mock.calls[0][2].aborted).toBe(true)
})
it('refreshing the window removes stale tasks and closes the modal on revoked permission', async () => {
 render(view()); fireEvent.click(await screen.findByRole('button', { name: 'Ver tarefa Rever orçamento' })); mocks.read.mockRejectedValue({ response: { status: 403 } }); fireEvent.focus(window)
 await screen.findByRole('alert'); expect(screen.queryByRole('dialog')).toBeNull(); expect(screen.queryByText(task.title)).toBeNull()
})
it('coming back to the window reads again without clearing the list or closing the open task', async () => {
 render(view()); fireEvent.click(await screen.findByRole('button', { name: 'Ver tarefa Rever orçamento' }))
 let answer; mocks.read.mockReturnValue(new Promise(resolve => { answer = resolve }))
 fireEvent.focus(window)
 await waitFor(() => expect(mocks.read).toHaveBeenCalledTimes(2))
 expect(screen.getByRole('dialog')).toBeTruthy(); expect(screen.getByRole('button', { name: 'Ver tarefa Rever orçamento' })).toBeTruthy()
 expect(screen.queryByText('A carregar tarefas…')).toBeNull()
 await act(async () => answer({ data: { ...page, items: [{ ...task, deadline: '2026-12-01' }] } }))
 expect(within(screen.getByRole('dialog')).getByText(/01\/12\/2026/)).toBeTruthy()
})
it('closes the open task after a silent read only when it is no longer in the answer', async () => {
 render(view()); fireEvent.click(await screen.findByRole('button', { name: 'Ver tarefa Rever orçamento' }))
 mocks.read.mockResolvedValue({ data: { items: [], total: 0, counts: {}, nextCursor: null } })
 fireEvent.focus(window)
 await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
 expect(screen.queryByRole('button', { name: 'Ver tarefa Rever orçamento' })).toBeNull()
})
it('keeps the previous tasks on screen, dimmed and inactive, while other filters are read', async () => {
 render(view()); const button = await screen.findByRole('button', { name: 'Ver tarefa Rever orçamento' })
 let answer; mocks.read.mockReturnValue(new Promise(resolve => { answer = resolve }))
 fireEvent.change(screen.getByLabelText('Estado'), { target: { value: 'COMPLETED' } }); fireEvent.click(screen.getByRole('button', { name: 'Aplicar filtros' }))
 await waitFor(() => expect(mocks.read).toHaveBeenCalledTimes(2))
 const group = button.closest('section')
 expect(screen.getByRole('button', { name: 'Ver tarefa Rever orçamento' })).toBeTruthy()
 expect(group.classList.contains('my-work-stale')).toBe(true); expect(group.hasAttribute('inert')).toBe(true)
 await act(async () => answer({ data: { items: [], total: 0, counts: {}, nextCursor: null } }))
 expect(screen.queryByRole('button', { name: 'Ver tarefa Rever orçamento' })).toBeNull()
})
