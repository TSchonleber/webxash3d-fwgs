# ChainStrike Spectator Mode — Design (Broadcast)

**Date:** 2026-06-23
**Status:** Approved (pending spec review)
**Scope:** Let anyone watch ongoing ChainStrike matches live, from one unified
location in the lobby, via a broadcast video stream — **unlimited viewers, zero
per-viewer engine slots.**

---

## 1. Goal

A user in the lobby (`chainstrike.fun`) sees a **"Watch Live"** area with the ongoing
matches and watches them as an embedded **low-latency video stream**. There is **no
per-viewer game client** — viewers just watch video, so the audience is unlimited and
works on any device. Each match is captured once and broadcast to everyone.

## 2. Decisions

| Decision | Choice |
|---|---|
| Watch experience | **Broadcast video stream only** (no per-viewer in-engine spectate, no free-look) |
| Distribution | **Managed stream service — Cloudflare Stream** (WHIP ingest → low-latency HLS → global CDN). Mux is the drop-in alternative. |
| Capture | One **headless-browser capture client per match**, in-engine spectator w/ auto-director, `captureStream()` → WHIP push |
| Engine slot cost | **1 spectator slot per match** (the capture client) — never counts as a player |
| Player cap | **30** (unchanged) |
| Viewers | **Unlimited** (HLS/CDN; no engine involvement) |
| Camera | **Auto-director** (`spec_autodirector 1`) — follows the action; viewers cannot steer |
| Latency | A few seconds (low-latency HLS) — acceptable for watching, not synchronous play |
| Reward eligibility | Capture client never registers a callsign, never frags → never rewarded |

**Superseded:** the earlier per-viewer "30 players + 2 in-engine spectator slots" design.
In-engine spectate is dropped; the only spectator on a server is the single capture client.

## 3. Binding constraint (still relevant)

`MAX_CLIENTS = 32` is hardcoded in the cs16-client mod (`com_model.h`,
`pm_shared.h`, `hud_msg.cpp`) — the GoldSrc protocol limit. We don't fight it: the
capture client is **one** spectator (1 slot), well within 32. Engine runs
`+maxplayers 31` (30 players + 1 capture) — or keep 32 with the extra slot idle.

## 4. Why broadcast (tradeoffs, eyes open)

- ✅ Unlimited concurrent viewers; near-zero client cost; mobile-friendly; one unified
  location; no per-viewer engine load; only 1 engine slot consumed per match.
- ⚠️ **No free-look** — everyone sees the same auto-director camera.
- ⚠️ **Latency** — low-latency HLS is a few seconds behind real-time.
- ⚠️ **Capture client is real new infra** — the dedicated server is headless game
  *logic* and produces no video. The only thing that renders a picture is an engine
  *client*, so we run a headless browser per match, 24/7, that renders + captures +
  pushes. WebGL-in-headless is CPU-heavy and finicky; this is the main build risk.

## 5. Architecture — three pieces

### Piece A — Capture client / broadcaster (the new core)

A headless, supervised browser that renders one match and pushes its video out.

- **Page**: a capture mode of the existing game client
  (`cs-web-server/src/client`) — e.g. `?capture=1` (implies spectate). It:
  - boots the engine, connects to its match server as a spectator
    (`?spectate=1` on the websocket so the SFU tags it),
  - issues `spectate` + `spec_autodirector 1` (state-confirmed poll, not a fixed
    timer) so the camera auto-follows the action,
  - hides all HUD chrome/overlays not wanted on the broadcast,
  - captures the canvas (`canvas.captureStream(30)`) **plus game audio** (route the
    engine's WebAudio output into the captured stream),
  - opens an `RTCPeerConnection` and performs a **WHIP** publish to the match's
    Cloudflare Stream live-input ingest URL (bearer/stream key from env).
  - caps capture at a sane resolution/fps (e.g. 1280×720@30, configurable) to keep
    CPU bounded without a GPU.
- **Runner**: a small container (Playwright/Puppeteer + headless Chromium, SwiftShader
  software WebGL) that loads the capture page, keeps it alive, and **auto-restarts** on
  crash / map change / disconnect. One runner instance per match server.
  - Config per instance (env): `MATCH_SERVER_URL`, `WHIP_URL`, `WHIP_TOKEN`,
    `CAPTURE_W/H/FPS`. Secrets via env only (never committed, never printed).

### Piece B — Go SFU (`docker/cs-web-server/src/server/sfu.go`)

Minimal change — just make the capture client a non-player spectator.

- Read `?spectate=1` on `/websocket`; tag `peerConnectionState.isSpectator`.
- `/players` returns `{ count, max, spectators, maxSpectators }`; `count` excludes
  spectators. `maxSpectators = 1` (the capture client). Reject a 2nd spectator.
- Reconcile `maxplayers` to one source of truth (`+maxplayers 31`, `maxPlayers 30`,
  `maxSpectators 1`), fixing the existing CMD `16` / Go const `30` / cfg `12` drift.

### Piece C — Lobby + reward-backend (the unified "Watch Live" location)

- **`GET /matches`** in `services/reward-backend/src/api/app.ts` (Hono):
  config-driven server list (env `MATCH_SERVERS`), per entry
  `{ id, name, map, url, playbackId }`. For each, fetch `/players` and assemble:
  ```json
  [{ "id":"train","name":"DE_TRAIN","map":"de_train",
     "players":17,"maxPlayers":30,"live":true,
     "playbackId":"<cloudflare-stream-playback-id>" }]
  ```
  `playbackId` maps each match to its Cloudflare Stream output. `live` reflects both
  server reachability and (optionally) stream-active state. Parallel fetch + short cache.
- **"Watch Live" component** in `apps/web` (e.g. `components/WatchLive.tsx`), placed in
  `Home.tsx` alongside `GamePanel`:
  - polls `GET ${API_BASE}/matches`,
  - renders an **embedded low-latency HLS player per live match** (Cloudflare Stream
    `<stream>` web component or an `hls.js` `<video>` against the playback URL),
    with live player count + map label,
  - offline/empty state when no match is live.
  - This is the single unified place to watch both matches.

## 6. Data flow

```
Match server (30 players, headless game logic — no video)
   ▲ WebRTC data channels (game netcode)
   │
Capture client (headless browser, 1 spectator slot)
   render + spec_autodirector + captureStream(canvas+audio)
   │  WHIP publish
   ▼
Cloudflare Stream (transcode → low-latency HLS → global CDN)
   │  HLS
   ▼
Lobby "Watch Live"  ── GET /matches (counts + playbackId) ── reward-backend
   embedded HLS player(s)  →  ∞ viewers, one unified location
```

## 7. Testing

- **Go unit tests** (`sfu.go`): spectator excluded from player `count`; capture client
  tagged via `?spectate=1`; 2nd spectator refused; `/players` payload shape.
- **reward-backend test** (Hono harness, `app.test.ts` pattern): `GET /matches` shape,
  parallel aggregation, unreachable server → `live:false`, `playbackId` mapping.
- **Capture client**: an automated check that the page enters observer + autodirector
  and produces a non-empty `MediaStream`; a manual/headless run that confirms a WHIP
  publish succeeds and the Cloudflare playback URL goes live.
- **Real-browser smoke test** (per project rule): lobby "Watch Live" renders the live
  stream end-to-end (capture → Cloudflare → embedded player), match counts update, and
  `/players.count` is unaffected by the capture client (`spectators:1`).

## 8. Out of scope (deferred)

- Per-viewer interactive 3D spectate / free-look (the 2-slot model) — dropped.
- Viewer-steerable camera / director controls / multiple camera angles.
- Full HLTV world-state relay (per-viewer free-look at scale).
- Raising `MAX_CLIENTS` above 32.
- Self-hosted media server (chose managed Cloudflare Stream); Mux noted as alternative.
- Stream chat / overlays / scoreboard graphics on the broadcast (future polish).

## 9. Risks / open items

- **Capture reliability is the #1 risk.** Headless WebGL is finicky; the runner must
  supervise and auto-restart, and we must verify CS renders acceptably under SwiftShader
  (or budget a GPU box). Spike this first.
- **Cloudflare Stream account + live inputs**: one live input per match; WHIP URLs +
  keys are secrets (env only). Provisioning/cost owned by the operator.
- **Auto-director quality**: `spec_autodirector` behavior in this build needs in-engine
  verification (does it follow frags sensibly?). Fallback: a fixed/roaming camera.
- **Latency expectation**: set UI copy so viewers know it's "live (~few s delay)".
- **`MATCH_SERVERS` ↔ proxy mapping**: the `/d2` routing lives on the deployment host;
  `/matches` ids must line up with it and with the per-match capture-runner config.
- **Audio capture**: routing engine WebAudio into `captureStream` may need a tap on the
  engine's audio context; verify during the capture spike.
