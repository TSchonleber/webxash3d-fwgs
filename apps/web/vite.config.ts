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
  resolve: {
    alias: {
      // Use the browser Buffer shim so @coral-xyz/anchor works in the browser.
      buffer: 'buffer',
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
})
