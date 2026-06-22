/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // Solana web3.js / anchor reach for Node globals in the browser.
  define: {
    global: 'globalThis',
  },
  // Pre-bundle the Buffer shim so the runtime polyfill in main.tsx resolves
  // to the real npm package (not Vite's externalized stub).
  optimizeDeps: {
    include: ['buffer'],
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
})
