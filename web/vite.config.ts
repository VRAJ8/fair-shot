import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// The AI agent (agent/server.py) runs on :8787; the dev server proxies /api to it.
export default defineConfig({
  plugins: [react()],
  server: { port: 5173, proxy: { '/api': 'http://127.0.0.1:8787' } },
  build: { chunkSizeWarningLimit: 1600 },
})
