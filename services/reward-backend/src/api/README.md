# reward-backend HTTP API

Hono app. Tested fully in-process (no port/domain). Run locally:

    npm install
    npm start            # http://localhost:8787  (no domain required)

## Env
PORT, OPERATOR_PUBKEYS (comma-sep base64 ed25519 server pubkeys), MIN_TOKENS, GAME_MINT,
RPC_URL, VAULT_LAMPORTS, BUDGET_BPS, MIN_MATCHES.

## Routes
- GET  /health
- POST /results            signed oracle envelope -> verify(allowlist) -> store
- GET  /leaderboard/:hour  ranked board for a UTC hour
- POST /settle/:hour       settle the hour -> cache settlement
- GET  /claim/:hour/:wallet  claim args (index, amount, proof hex) for a winner

## Deploy later (no domain needed)
Run on any host/IP, or a free subdomain (Render/Railway/Fly), or a tunnel (cloudflared/ngrok).
The web client just needs the base URL.
