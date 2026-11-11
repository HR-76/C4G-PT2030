// @vitest-environment node
import { expect, it } from 'vitest'
import config from '../../vite.config.js'

it.each(['server', 'preview'])('prevents embedding the %s frontend in another origin', mode => {
  const headers = config[mode].headers
  expect(headers['Content-Security-Policy']).toContain("frame-ancestors 'none'")
  expect(headers['X-Frame-Options']).toBe('DENY')
})
