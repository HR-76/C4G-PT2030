import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'
export default defineConfig({
  root: fileURLToPath(new URL('../', import.meta.url)),
  resolve: { alias: { vitest: fileURLToPath(new URL('./node_modules/vitest/dist/index.js', import.meta.url)) } },
  oxc: { jsx: { runtime: 'automatic' } },
  test: { environment: 'jsdom', include: ['src/pages/Billing/*.test.jsx', 'src/pages/Platform/*.test.jsx', 'src/pages/Notifications.test.jsx', 'src/pages/Imports/*.test.jsx', 'src/components/*.test.jsx', 'src/pages/Opportunities/*.test.jsx', 'src/pages/Interests/*.test.{js,jsx}', 'src/pages/Applications/*.test.jsx', 'src/pages/Organization/*.test.jsx', 'src/pages/Pq1/*.test.{js,jsx}', 'src/pages/Prequalification/*.test.{js,jsx}', 'src/pages/Editorial/*.test.{js,jsx}', 'src/pages/OpportunityCriteria/*.test.{js,jsx}'] },
})
