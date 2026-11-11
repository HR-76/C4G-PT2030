import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// The hash permits only the Vite React Fast Refresh preamble; keep it in sync with index.html.
const securityHeaders = { 'X-Frame-Options': 'DENY', 'Content-Security-Policy': "default-src 'self'; script-src 'self' 'sha256-Z2/iFzh9VMlVkEOar1f/oSHWwQk3ve1qk/C2WdsC4Xk='; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'none'; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-src 'self'; frame-ancestors 'none'" }

export default defineConfig({
  plugins: [react()],
  resolve: {
    dedupe: ['react', 'react-dom']
  },
  optimizeDeps: {
    // Keep lazy authentication pages and the renderer in the initial dependency graph.
    include: ['react', 'react-dom/client', 'react/jsx-runtime']
  },
  server: {
    headers: securityHeaders,
    port: 3000,
    strictPort: true,
    proxy: {
      '/api': {
        target: 'http://localhost:5000',
        changeOrigin: true
      }
    }
  },
  preview: { headers: securityHeaders }
})
