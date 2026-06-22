import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { Buffer } from 'buffer'
import { Providers } from './components/Providers'
import App from './App.tsx'

// Solana web3.js / anchor expect Node's Buffer global in the browser.
if (!(globalThis as { Buffer?: unknown }).Buffer) {
  ;(globalThis as { Buffer?: unknown }).Buffer = Buffer
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Providers>
      <App />
    </Providers>
  </StrictMode>,
)
