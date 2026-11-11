import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
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
