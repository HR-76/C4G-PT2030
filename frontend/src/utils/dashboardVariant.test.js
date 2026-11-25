import { expect, it } from 'vitest'
import { usesTechnicianDashboard } from './dashboardVariant'

it('picks the dashboard variant from the backend navigation list, never from the profile', () => {
  expect(usesTechnicianDashboard({ navigation: { dashboard: 'TECHNICIAN' } })).toBe(true)
  expect(usesTechnicianDashboard({ profileCode: 'CONTRIBUTOR', navigation: { dashboard: 'ORGANIZATION' } })).toBe(false)
  expect(usesTechnicianDashboard({ profileCode: 'CONTRIBUTOR' })).toBe(false)
  expect(usesTechnicianDashboard(null)).toBe(false)
})
