import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: 5173,
    proxy: {
      '/streams': 'http://localhost:3000',
      '/videos': 'http://localhost:3000',
      '/system': 'http://localhost:3000',
    },
  },
})
