import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { BackupsView } from './PlatformBackups'

vi.mock('../../api/api', () => ({ platformDirectoryApi: {} }))
vi.mock('../../contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 'admin' } }) }))
afterEach(cleanup)

const item = (database, at, state = 'AVAILABLE', extra = {}) => ({ database, at, sizeBytes: 12804688, file: '20261123T023259Z.dump.enc', state, restoreTestedAt: null, ...extra })
const report = (overrides = {}) => ({ status: 'OK', lastGoodAt: '2026-11-23T02:32:59.000Z', lastRestoreTestAt: null, maxAgeHours: 36,
  retention: { daily: 14, weekly: 8 }, checkedAt: '2026-11-23T12:00:00.000Z',
  databases: [{ database: 'c4g_central_staging', ok: true, lastAt: '2026-11-23T02:32:59.000Z', ageHours: 9 }, { database: 'c4g_tenant_staging', ok: true, lastAt: '2026-11-23T02:32:59.000Z', ageHours: 9 }],
  items: [item('c4g_central_staging', '2026-11-23T02:32:59.000Z'), item('c4g_tenant_staging', '2026-11-23T02:32:59.000Z', 'AVAILABLE', { sizeBytes: 7037536 })], ...overrides })
const show = api => render(<BackupsView api={api} />)

it('shows that the copies are up to date, with Lisbon time, sizes and the list', async () => {
  show({ backups: vi.fn().mockResolvedValue({ data: report() }) })
  const summary = await screen.findByRole('status', { name: 'Estado das cópias de segurança' })
  expect(within(summary).getByRole('heading', { name: 'As cópias de segurança estão em dia' })).toBeTruthy()
  expect(summary.textContent).toContain('Última cópia boa: 23/11/26, 02:32')
  expect(summary.textContent).toContain('Cópias disponíveis: 2')
  expect(summary.textContent).toContain('14 diárias e 8 semanais')
  const rows = screen.getAllByRole('row').slice(1)
  expect(rows.map(row => within(row).getAllByRole('cell').map(cell => cell.textContent))).toEqual([
    ['23/11/26, 02:32', 'Central', 'Disponível', '12,2 MB', 'Central · 23/11/2026 02:32'],
    ['23/11/26, 02:32', 'Entidades', 'Disponível', '6,7 MB', 'Entidades · 23/11/2026 02:32']])
  expect(screen.getByText('Central · 23/11/2026 02:32').getAttribute('title')).toBe('c4g_central_staging/20261123T023259Z.dump.enc')
  expect(screen.queryByRole('button', { name: /Fazer cópia/ })).toBeNull()
})

it('marks a copy whose restore was tested and says when', async () => {
  show({ backups: vi.fn().mockResolvedValue({ data: report({ lastRestoreTestAt: '2026-11-22T05:30:41.000Z',
    items: [item('c4g_central_staging', '2026-11-22T02:31:01.000Z', 'RESTORE_TESTED', { restoreTestedAt: '2026-11-22T05:30:41.000Z' })] }) }) })
  expect(await screen.findByText('Disponível · restauro testado')).toBeTruthy()
  expect(screen.getByText('Testado em 22/11/26, 05:30')).toBeTruthy()
  expect(screen.getByRole('status', { name: 'Estado das cópias de segurança' }).textContent).toContain('Último teste de restauro: 22/11/26, 05:30.')
})

it('warns when a database is late and names it', async () => {
  show({ backups: vi.fn().mockResolvedValue({ data: report({ status: 'STALE', lastGoodAt: '2026-11-20T02:30:00.000Z',
    databases: [{ database: 'c4g_central_staging', ok: true, lastAt: '2026-11-23T02:32:59.000Z', ageHours: 9 }, { database: 'c4g_tenant_staging', ok: false, lastAt: '2026-11-20T02:30:00.000Z', ageHours: 81 }] }) }) })
  expect(await screen.findByRole('heading', { name: 'As cópias de segurança estão em atraso' })).toBeTruthy()
  expect(screen.getByText('Em atraso: Entidades (última em 20/11/26, 02:30).')).toBeTruthy()
})

it('says there are no copies without calling it a failure', async () => {
  show({ backups: vi.fn().mockResolvedValue({ data: report({ status: 'EMPTY', lastGoodAt: null, databases: [], items: [] }) }) })
  expect(await screen.findByRole('heading', { name: 'Ainda não existem cópias de segurança' })).toBeTruthy()
  expect(screen.getByRole('heading', { name: 'Sem cópias' })).toBeTruthy()
  expect(screen.queryByRole('alert')).toBeNull()
})

it('tells an unconfigured environment, a refusal and a failure apart, and retries', async () => {
  const api = { backups: vi.fn()
    .mockRejectedValueOnce({ response: { status: 503, data: { error: { code: 'BACKUPS_NOT_CONFIGURED' } } } })
    .mockRejectedValueOnce({ response: { status: 403 } })
    .mockRejectedValueOnce({ response: { status: 503, data: { error: { code: 'SERVICE_UNAVAILABLE' } } } })
    .mockResolvedValue({ data: report() }) }
  show(api)
  expect((await screen.findByRole('alert')).textContent).toBe('A consulta das cópias de segurança não está ligada neste ambiente.')
  expect(screen.queryByText(/Sem cópias/)).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }))
  expect(await screen.findByText('Esta área está reservada à administração C4G.')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }))
  expect(await screen.findByText('Não foi possível consultar as cópias de segurança. Tente novamente.')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }))
  expect(await screen.findByRole('heading', { name: 'As cópias de segurança estão em dia' })).toBeTruthy()
})
