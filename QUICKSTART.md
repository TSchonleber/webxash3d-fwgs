# Quickstart — webxash3d + Solana hold-to-play rewards

Browser Counter-Strike 1.6 (Xash3D-FWGS compiled to WASM) with a Solana rewards layer:
hold a token to play, climb an hourly skill leaderboard, top 10 paid from a prize pool that the
operator settles on-chain. This file gets you from clone → tests → running locally.

> Heavy lifting and design rationale live in [`docs/superpowers/`](docs/superpowers/)
> (the spec + 8 implementation plans).

## 1. Clone (with submodules)

The game engine/client is referenced via **git submodules** (yohimik's `xash3d-fwgs`, `cs16-client`,
`hlsdk-portable`). You must pull them:

```bash
git clone --recurse-submodules https://github.com/TSchonleber/webxash3d-fwgs
# already cloned without them?
git submodule update --init --recursive
```

## 2. What's where

| Path | What | Run |
|---|---|---|
| `solana/distributor` | Anchor payout program (vault, oracle-signed publish, Merkle claim) | `anchor test` |
| `services/reward-backend` | Leaderboard, payout split, anti-cheat, Merkle, HTTP API, operator tool | `npm install && npm test` |
| `docker/cs-web-server/src/server/oracle` | Go result-oracle + log sidecar | `go test ./...` |
| `apps/web` | Vite client: Privy login, live leaderboard, prize pool, claim, game panel | `npm install && npm run dev` |
| `docs/superpowers/` | Spec + all implementation plans | — |

**Toolchain:** Node ≥ 20, Go ≥ 1.25, Rust (stable), Solana CLI, Anchor **0.31.1** (via `avm`).
Anchor 0.30.x will NOT build on recent Rust — use 0.31.1.

## 3. Run the rewards stack locally (no domain, no real funds)

```bash
# backend API on http://localhost:8787
cd services/reward-backend && npm install && npm start

# web client on http://localhost:5173 (VITE_DEV_BYPASS=1 skips Privy for local viewing)
cd apps/web && npm install && cp .env.example .env && VITE_DEV_BYPASS=1 npm run dev
```

Set `VITE_PRIVY_APP_ID` in `apps/web/.env` (free at privy.io) for real login.

### Pay the leaderboard (operator) — when you choose, or on an interval
```bash
cd services/reward-backend
# one-shot: settle the just-finished UTC hour and publish on-chain
npm run operator
# specific hour:        npm run operator -- --hour 495034
# every 30 minutes:     npm run operator -- --every 1800
```
Requires `ADMIN_TOKEN`, `RPC_URL`, and `ORACLE_KEYPAIR` (see `services/reward-backend/src/operator/README.md`).

### Feed real match results from a game server
The log sidecar (`docker/cs-web-server/src/server/oracle/cmd/logsidecar`) tails the server's HLDS log,
signs each finished match, and POSTs it to the backend — no engine rebuild needed.
See `docker/cs-web-server/src/server/oracle/SIDECAR.md`.

## 4. Actually playing the game

The web client loads the **compiled WASM** from the `xash3d-fwgs` / `cs16-client` npm packages at build time.
To *play*, you additionally need:

1. **CS 1.6 game content** (`valve.zip` / `cstrike` data) — this is **Steam copyrighted material and is not in
   this repo** (nor upstream's, by design). Supply it yourself per the upstream README.
2. A running **`cs-web-server`** (see `docker/cs-web-server/`) for the WebRTC game session.

Without those, the game panel renders its connect/load state; the rewards UI (leaderboard, prize pool,
claim) works fully against the local API regardless.

## 5. Status

This is a Phase-0 build: all components are test-driven and run locally/devnet. Not yet done (intentionally):
a live token + mainnet, the `sfu.go` engine wire-in, the live Privy→Anchor claim signer, and bundled game
assets. See the plans in `docs/superpowers/plans/` for the full picture.
