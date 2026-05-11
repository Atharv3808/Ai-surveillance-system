import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react({ jsxRuntime: 'automatic' })],

  server: {
    proxy: {
      // REST API
      '/api': {
        target: 'http://localhost:8000',
        changeOrigin: true,
      },
      // WebSocket (Django Channels)
      '/ws': {
        target: 'ws://localhost:8000',
        ws: true,
        changeOrigin: true,
      },
      // Django media files (evidence screenshots, uploaded videos, etc.)
      '/media': {
        target: 'http://localhost:8000',
        changeOrigin: true,
      },
    },
  },

  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: './src/tests/setup.js',
  },
})
