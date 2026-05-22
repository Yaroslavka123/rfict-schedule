import path from 'node:path'

import { svelte } from '@sveltejs/vite-plugin-svelte'
import { defineConfig } from 'vite'

const BACKEND_API_BASE_URL = 'https://rfict.up.railway.app'

export default defineConfig({
  plugins: [svelte()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    proxy: {
      '/api': {
        target: BACKEND_API_BASE_URL,
        changeOrigin: true,
      },
    },
  },
  preview: {
    proxy: {
      '/api': {
        target: BACKEND_API_BASE_URL,
        changeOrigin: true,
      },
    },
  },
})
