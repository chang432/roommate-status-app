import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Dev server proxies /api to a real backend when one exists.
// Until then the app falls back to the in-memory mock in src/api/client.js,
// so the UI is fully usable without a server running.
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': {
        target: process.env.VITE_API_TARGET || 'http://localhost:8000',
        changeOrigin: true,
      },
    },
  },
})
