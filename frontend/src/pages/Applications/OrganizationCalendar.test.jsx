import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import OrganizationCalendar from './OrganizationCalendar'

const read = vi.hoisted(() => vi.fn())
vi.mock('../../api/api', () => ({ privateApplicationsApi: { calendar: read } }))
vi.mock('../../contexts/AuthContext', () => ({ useAuth: () => ({ organization: { id: 'org' } }) }))

const date = '2026-11-12'
const project = { id: '00000000-0000-4000-8000-000000000001', title: 'Projeto Norte' }
const task = { id: 'task:1', taskId: '1', applicationId: project.id, applicationTitle: project.title, title: 'Rever orçamento', status: 'PREPARATION', date }
const deadline = { ...task, id: 'application:1', taskId: null, title: project.title }
const data = {
  today: date, agenda: [deadline, task], applications: [project],
  days: [{ date, count: 3, previews: [deadline, task] }], hasNextPage: false,
}

beforeEach(() => {
  read.mockReset()
  read.mockResolvedValue({ data })
})
afterEach(cleanup)

function show() {
  render(<MemoryRouter initialEntries={['/calendario?mes=2026-11']}><OrganizationCalendar /></MemoryRouter>)
}

it('shows the month and the project state and carries the selected filter when opening a record', async () => {
  show()
  const agenda = within(screen.getByRole('region', { name: 'Próximos prazos' }))
  const taskLink = await agenda.findByRole('link', { name: task.title })
  expect(agenda.getAllByText('Em preparação')).toHaveLength(2)
  expect(agenda.getByText('Prazo interno')).toBeTruthy()
  expect(agenda.getByText('Tarefa')).toBeTruthy()
  expect(taskLink.getAttribute('href')).toContain('#equipa-tarefas')
  fireEvent.change(screen.getByLabelText('Candidatura'), { target: { value: project.id } })
  const filtered = await agenda.findByRole('link', { name: task.title })
  expect(decodeURIComponent(filtered.getAttribute('href'))).toContain('/calendario?mes=2026-11&candidatura=' + project.id)
  fireEvent.click(screen.getByRole('button', { name: 'Mês seguinte' }))
  await waitFor(() => expect(read.mock.calls.at(-1)[0]).toMatchObject({ month: '2026-12', applicationId: project.id }))
  expect(screen.getByRole('heading', { name: 'dezembro de 2026' })).toBeTruthy()
})

it('opens all deadlines for a selected day, pages them and returns to upcoming deadlines', async () => {
  read.mockImplementation(async ({ day, page }) => ({ data: { ...data, agenda: page ? [task] : data.agenda, hasNextPage: Boolean(day && !page) } }))
  show()
  fireEvent.click(await screen.findByRole('button', { name: /12 de novembro, 3 prazos/ }))
  const dayAgenda = within(screen.getByRole('region', { name: /Prazos de .*12 de novembro/ }))
  fireEvent.click(await dayAgenda.findByRole('button', { name: 'Seguinte' }))
  await dayAgenda.findByText('Página 2')
  expect(read.mock.calls.at(-1)[0]).toMatchObject({ day: date, page: 2 })
  fireEvent.click(dayAgenda.getByRole('button', { name: 'Ver próximos prazos' }))
  await screen.findByRole('region', { name: 'Próximos prazos' })
  expect(read.mock.calls.at(-1)[0].day).toBeUndefined()
})

it('filters both views by application status, preserving the month and combining with the project filter', async () => {
  const other = { id: '00000000-0000-4000-8000-000000000002', title: 'Projeto Sul' }
  const submitted = { ...deadline, id: 'application:2', applicationId: other.id, applicationTitle: other.title, title: other.title, status: 'SUBMITTED', date: '2026-11-16' }
  read.mockImplementation(async ({ applicationId, status }) => {
    const matches = event => (!applicationId || event.applicationId === applicationId) && (!status || event.status === status)
    const agenda = [...data.agenda, submitted].filter(matches)
    const days = [...new Set(agenda.map(event => event.date))].map(date => {
      const previews = agenda.filter(event => event.date === date)
      return { date, previews, count: previews.length }
    })
    return { data: { ...data, applications: [project, other], agenda, days } }
  })
  show()
  fireEvent.click(await screen.findByRole('button', { name: /12 de novembro, 2 prazos/ }))
  await screen.findByRole('region', { name: /Prazos de .*12 de novembro/ })
  fireEvent.change(screen.getByLabelText('Estado da candidatura'), { target: { value: 'SUBMITTED' } })
  const agenda = within(screen.getByRole('region', { name: 'Próximos prazos' }))
  const submittedLink = await agenda.findByRole('link', { name: other.title })
  expect(agenda.queryByRole('link', { name: task.title })).toBeNull()
  expect(screen.queryByRole('button', { name: /12 de novembro, 2 prazos/ })).toBeNull()
  expect(screen.getByRole('button', { name: /16 de novembro, 1 prazo/ })).toBeTruthy()
  expect(decodeURIComponent(submittedLink.getAttribute('href'))).toContain('/calendario?mes=2026-11&estado=SUBMITTED')
  expect(read.mock.calls.at(-1)[0]).toMatchObject({ month: '2026-11', status: 'SUBMITTED', day: undefined })
  fireEvent.change(screen.getByLabelText('Candidatura'), { target: { value: project.id } })
  await agenda.findByText('Sem próximos prazos.')
  expect(read.mock.calls.at(-1)[0]).toMatchObject({ month: '2026-11', applicationId: project.id, status: 'SUBMITTED' })
  fireEvent.change(screen.getByLabelText('Estado da candidatura'), { target: { value: '' } })
  await agenda.findByRole('link', { name: task.title })
  expect(screen.getByLabelText('Candidatura').value).toBe(project.id)
})

it('drops an old response when changing month and shows a denied read without stale events', async () => {
  let resolve
  read.mockImplementationOnce(() => new Promise(done => { resolve = done }))
    .mockRejectedValueOnce({ response: { status: 403 } })
  show()
  fireEvent.click(screen.getByRole('button', { name: 'Mês seguinte' }))
  await screen.findByRole('alert')
  await act(async () => resolve({ data }))
  expect(read.mock.calls[0][2].aborted).toBe(true)
  expect(screen.queryByRole('link', { name: task.title })).toBeNull()
})
