# oracle

Trusted-server oracle logic for the Solana hold-to-play leaderboard. Standalone, stdlib-only, unit-tested.

## Test
    go test ./...

## Pieces
- `logparse` HLDS log line -> typed events (kill/headshot/teamwin/enter)
- `aggregate` events -> MatchResult (CT->A, TERRORIST->B; benign telemetry defaults)
- `session` Privy TokenVerifier + connection-index -> wallet registry
- `oracle` ed25519 sign + POST signed envelope to the reward backend

## Wire-in seams (in ../sfu.go / ../main.go — done when integrating, not here)
1. **Auth gate**: in `websocketHandler`, read the Privy token (query param `?token=` or first WS message),
   call `registry.Authenticate(index, token)`; on error, close the socket. On disconnect call `registry.Unbind(index)`.
2. **uid <-> index correlation**: when the engine reports a player connect from a connection's synthetic addr
   (ip[0]==index), record uid->index so `Resolver(uid)` = `registry.WalletForIndex(index)`.
3. **Engine log tap**: feed the embedded engine's HLDS log lines to `ParseLine`; push events into the
   per-match `Aggregator`. (Exact tap depends on the goxash3d-fwgs engine API — TODO at integration.)
4. **On match end**: `signer.Post(backendURL+"/results", agg.Finalize(nowMs))`.
5. **Demo recording**: issue the engine console `record <matchId>` at match start and store the .dem
   (engine-console dependent; integration concern).

## Deferred
Richer per-player telemetry (accuracy/reaction) via an AMXX plugin; the backend `/results` HTTP endpoint
that verifies the signature against an allowlist of operator server pubkeys.
