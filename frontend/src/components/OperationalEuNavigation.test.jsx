import fs from 'node:fs'
import path from 'node:path'
import { expect, it } from 'vitest'

it('keeps one-off EU approval tools out of persistent product navigation', () => {
  const root = path.resolve(process.cwd(), 'src')
  const sidebar = fs.readFileSync(path.join(root, 'components/Layout/Sidebar.jsx'), 'utf8')
  const dashboard = fs.readFileSync(path.join(root, 'pages/Platform/PlatformDashboard.jsx'), 'utf8')
  const app = fs.readFileSync(path.join(root, 'App.jsx'), 'utf8')
  for (const route of ['/administracao/aprovacoes-eu', '/administracao/aceitacoes-eu']) {
    expect(sidebar).not.toContain(`to: '${route}'`)
    expect(dashboard).not.toContain(`to="${route}"`)
    expect(app).toContain(`<Route path="${route}" element={<ProtectedRoute platformOnly>`)
  }
  expect(sidebar).toContain("to: '/integracoes'")
})
