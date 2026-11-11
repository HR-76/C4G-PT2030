import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'
export default defineConfig(({ mode }) => {
  if(mode !== 'catalog-isolated') throw new Error('This entry requires catalog-isolated mode')
  return { plugins:[react()],resolve:{dedupe:['react','react-dom']},build:{rollupOptions:{input:fileURLToPath(new URL('./catalog-isolated.html',import.meta.url))}} }
})
