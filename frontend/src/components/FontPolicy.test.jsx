// @vitest-environment node
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import react from '@vitejs/plugin-react'
import { JSDOM } from 'jsdom'
import { describe, expect, it } from 'vitest'
import viteConfig from '../../vite.config.js'

const fontDirective = policy => policy?.split(';').map(value => value.trim()).find(value => value.startsWith('font-src '))

describe('system font network boundary', () => {
  it('ships a document policy which blocks font network requests', () => {
    const html = readFileSync(new URL('../../index.html', import.meta.url), 'utf8')
    const { document } = new JSDOM(html).window
    const policies = [...document.querySelectorAll('meta[http-equiv="Content-Security-Policy"]')].map(meta => meta.content)
    expect(policies.some(policy => fontDirective(policy) === "font-src 'none'")).toBe(true)
    expect(document.querySelector('link[href*="fonts.googleapis.com"]')).toBeNull()
  })

  it.each(['server', 'preview'])('enforces the same font boundary in %s response headers', mode => {
    expect(fontDirective(viteConfig[mode]?.headers?.['Content-Security-Policy'])).toBe("font-src 'none'")
  })
})

describe('frontend content security policy', () => {
  it('restricts script execution and dangerous document capabilities in every served policy', () => {
    const html = readFileSync(new URL('../../index.html', import.meta.url), 'utf8')
    const documentPolicy = new JSDOM(html).window.document.querySelector('meta[http-equiv="Content-Security-Policy"]').content
    const policies = [documentPolicy, viteConfig.server.headers['Content-Security-Policy'], viteConfig.preview.headers['Content-Security-Policy']]
    for (const policy of policies) {
      const directives = Object.fromEntries(policy.split(';').map(part => part.trim().split(/\s+/)).filter(parts => parts[0]).map(([name, ...values]) => [name, values]))
      const refreshHash = createHash('sha256').update(react.preambleCode.replace('__BASE__', '/')).digest('base64')
      expect(directives['script-src']).toEqual(["'self'", `'sha256-${refreshHash}'`])
      expect(directives['object-src']).toEqual(["'none'"])
      expect(directives['base-uri']).toEqual(["'none'"])
      expect(directives['form-action']).toEqual(["'self'"])
      expect(directives['connect-src']).toContain("'self'")
      expect(directives['frame-src']).toContain("'self'")
    }
    // frame-ancestors is enforced only when delivered as an HTTP header.
    expect(new Set(policies.map(policy => policy.replace("; frame-ancestors 'none'", ''))).size).toBe(1)
  })
})
