import { defineConfig } from 'vite'
import base from './vite.catalog-isolated.config.js'
export default defineConfig(({ mode }) => ({
  ...base({ mode }),
  define: { __GCNI_CONTROLLED_REHEARSAL__: true },
  plugins: [...base({ mode }).plugins, { name: 'controlled-rehearsal-marker', generateBundle() {
    this.emitFile({ type: 'asset', fileName: 'catalog-control-build.json', source: JSON.stringify({ version: 1, controlled: true, mode }) })
  } }],
}))
