# web client

Player UI: Privy login, live hourly leaderboard, prize pool, claim, and the WASM CS 1.6 panel.

## Run
    cp .env.example .env     # set VITE_PRIVY_APP_ID (free at privy.io) for real login
    npm install
    npm run dev              # http://localhost:5173  (talks to API at VITE_API_BASE)

VITE_DEV_BYPASS=1 skips Privy so the main UI renders without an app id (dev/screenshots).

## Notes
- The leaderboard/prize/claim are real against the Plan 5 API (run it: `cd services/reward-backend && npm start`).
- Actually PLAYING the game needs CS 1.6 assets (valve.zip) + a running cs-web-server; the panel shows connect state otherwise.
- No domain needed anywhere; all localhost.
