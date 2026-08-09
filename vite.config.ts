import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const backendPort = process.env.PI_LIVECRAFT_BACKEND_PORT ?? '43121'
const configuredVitePort = process.env.PI_LIVECRAFT_VITE_PORT

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    // Playwright supplies an isolated port and must fail rather than silently
    // incrementing into an unexpected/stale stack. Normal dev keeps Vite's
    // default auto-increment behavior when 5173 is occupied.
    port: configuredVitePort ? Number(configuredVitePort) : 5173,
    strictPort: configuredVitePort !== undefined,
    proxy: {
      '/api': `http://127.0.0.1:${backendPort}`,
    },
  },
})
