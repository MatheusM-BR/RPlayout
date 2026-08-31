import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:4000',
      '/ws': { target: 'ws://localhost:4000', ws: true },
    },
  },
  // Os pacotes do workspace são TypeScript cru; deixe o Vite transpilar em vez
  // de pré-empacotar.
  optimizeDeps: { exclude: ['@rplayout/protocol', '@rplayout/scheduler'] },
})
