# logsidecar

Standalone binary (no engine/CGO). Tails the game server's HLDS log, signs each finished match,
and POSTs it to the backend /results. Reuses the oracle package.

## Build & run
    go build ./cmd/logsidecar
    LOG_PATH=/path/to/server.log \
    BACKEND_URL=http://localhost:8787 \
    ORACLE_SEED_B64=<base64 32-byte ed25519 seed; its pubkey must be in the backend OPERATOR_PUBKEYS allowlist> \
    MATCH_END_PATTERN=': Started map|-+ Mapchange' \
    ./logsidecar

## Identity
Players are resolved by in-game NAME. The web client must POST /register {playerName, wallet}
and join with that exact name. (Confirm at hookup whether the server exposes a log file path,
how match end appears in the log, and the player-name scheme — all are config above.)
