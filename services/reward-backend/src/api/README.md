# reward-backend HTTP API

Hono app. Tested fully in-process (no port/domain). Run locally:

    npm install
    npm start            # http://localhost:8787  (no domain required)

## Env
PORT, OPERATOR_PUBKEYS (comma-sep base64 ed25519 server pubkeys), MIN_TOKENS, GAME_MINT,
RPC_URL, VAULT_LAMPORTS, BUDGET_BPS, MIN_MATCHES, ADMIN_TOKEN.

`LEADERBOARD_DB_PATH` — when set, matches and settlements are persisted to a SQLite
file at that path (via Node's built-in `node:sqlite`) and survive a restart. Unset =
in-memory only (wiped on restart). In Docker, point it at a mounted volume.

## Routes
- GET  /health
- POST /results            signed oracle envelope -> verify(allowlist) -> store
- GET  /leaderboard/:hour  board ranked by KILLS (desc) for a period
- POST /settle/:hour       settle the period -> cache settlement
- GET  /claim/:hour/:wallet  claim args (index, amount, proof hex) for a winner

Ranking metric: total **kills** (most kills = rank 1), tiebroken by fewer deaths,
then fewer matches, then wallet. The top 7 split the pool on a sliding scale.
Note: a "hour"/period is a 30-minute bucket (see `period.ts`).

## Deploy (Docker, persisted)
From this directory:

    docker compose up -d --build      # API on :8787, DB on the leaderboard-data volume

The named `leaderboard-data` volume keeps the SQLite DB across `up`/`down`/restart.
Or run on any host/IP, a free subdomain (Render/Railway/Fly), or a tunnel
(cloudflared/ngrok) — the web client just needs the base URL.
