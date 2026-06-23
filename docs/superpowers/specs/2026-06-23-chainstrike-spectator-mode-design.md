# ChainStrike Spectator Mode — Design

**Date:** 2026-06-23
**Status:** Approved (pending spec review)
**Scope:** Let users watch ongoing ChainStrike matches live, in full 3D, without taking a player slot.

---

## 1. Goal

A user in the lobby (`chainstrike.fun`) can see the list of ongoing matches and click
"Watch" to drop into any match as a **3D in-engine spectator** — free-look and
follow-player observer mode, rendered by the real CS 1.6 / Xash3D WASM engine in
the browser — **without consuming a player slot, without affecting the join-queue,
and without ever being eligible for rewards.**

## 2. Binding constraint (read this first)

`MAX_CLIENTS = 32` is hardcoded in the cs16-client mod
(`packages/cs16-client/cs16-client/common/com_model.h`, `pm_shared/pm_shared.h`,
`cl_dll/hud_msg.cpp`). It is the GoldSrc protocol limit — player entity indices,
scoreboard, movement prediction, and voice all assume ≤ 32 clients. Raising it is
out of scope (would require recompiling the mod and breaks protocol/HUD/prediction).

**Therefore: one game engine = 32 client slots, total.** With a 30-player cap, exactly
**2 spectator slots fit per match server.**

## 3. Decisions

| Decision | Choice |
|---|---|
| What spectating renders | **Full 3D in-engine spectate** (real engine, observer mode) |
| Player cap | **30** (firm) |
| Spectator capacity | **2 per match server** (`maxplayers 32` − 30 players) |
| Spectator vs player accounting | **Separate** — spectators don't count as players, bypass the join-queue, can watch a full match |
| Scaling spectator demand | **Add more match servers** (per-match viewers capped at 2; HLTV relay is an explicitly deferred future option, not built here) |
| Match discovery | **`GET /matches` aggregator** in the reward-backend |
| Reward eligibility | Spectators **never** rewarded (no callsign registration, never frag → oracle never sees them) |

## 4. Current state (what already exists)

Spectator mode is ~40% scaffolded and **built against the wrong accounting model**:

- `cs-web-server/src/client/main.ts`: a `?spectate` URL flag, a `#spectate` button,
  a two-match server picker (`DE_TRAIN` = server A path `''`, `DE_DUST2` = server B
  path `'/d2'`), and a fragile fixed-6s-timer `spectate` command.
- `cs-web-server/src/client/index.html`: the `#spectate` button, `#servers` picker,
  `#queue`, `#connecting` DOM all exist.
- The two "matches" are two backend containers routed by a **host-side proxy**
  (`/` and `/d2`) deployed on the game host — **not** in this repo.

**What's wrong / missing:**
1. Spectators run through the **player join-queue** (`checkQueue`) and are **counted as
   players** by `/players` — so they get blocked on a full match and eat a player slot.
   Directly violates the "separate capacity" decision.
2. Observer entry is a fragile fixed timer, not state-confirmed.
3. No spectator HUD (banner, followed player, controls, leave/join).
4. **No entry point in the lobby** (`apps/web`) at all.
5. `maxplayers` is inconsistent: engine CMD `+maxplayers 16`, Go const `maxPlayers = 30`,
   `configs/cstrike/server.cfg`-adjacent `12`. Must be reconciled to a single source.

## 5. Architecture — three layers

### Layer A — Go SFU (`docker/cs-web-server/src/server/sfu.go`)

The SFU is the WebRTC signaling + slot-accounting layer. It must distinguish
spectator peers from player peers and enforce per-class caps.

- **Detect spectator** at the websocket handshake: `?spectate=1` query param on
  `/websocket`. Store `isSpectator bool` on `peerConnectionState`.
- **Caps** (constants, env-overridable):
  - `maxPlayers = 30`
  - `maxSpectators = 2`
  - engine `+maxplayers = 32` (player cap + spectator cap)
- **Enforce at connect** (before allocating a pool slot / completing signaling):
  - Reject a **player** connect when connected players ≥ `maxPlayers`.
    (Client already shows a queue; the server is the backstop.)
  - Reject a **spectator** connect when connected spectators ≥ `maxSpectators`,
    with a distinguishable close/refusal the client can surface as
    "spectator slots full".
- **`/players` response shape** (additive, backward-compatible):
  ```json
  { "count": 17, "max": 30, "spectators": 1, "maxSpectators": 2 }
  ```
  `count` = connected peers where `!isSpectator` and state == Connected.
  `spectators` = connected peers where `isSpectator` and state == Connected.
- **Reconcile `maxplayers`**: engine CMD → `+maxplayers 32`; Go `maxPlayers = 30`,
  `maxSpectators = 2`; cfg files aligned. One source of truth, documented inline.

Why this guarantees separation: players are gated at 30, spectators at 2, engine
holds 32 → `30 + 2 = 32` always fits. Players can never exceed 30, so the 2
spectator slots are effectively always available.

### Layer B — Game client (`docker/cs-web-server/src/client/{main.ts,webrtc.ts,index.html}`)

- **Spectate transport**: when in spectate mode, `webrtc.ts` opens the websocket with
  `?spectate=1` (so Layer A tags the peer). Flag threaded via the existing
  `__csServerPath` / a global, set before `main()`.
- **Skip the queue**: spectator path does **not** call `checkQueue`; it connects
  immediately even when the match is player-full.
- **Reliable observer entry**: replace the fixed-6s `spectate` timer with a poll that
  re-issues `spectate` (and sets `spec_mode` / free-look) until the engine confirms
  observer state, then stops. Bind cycle-player / view-mode controls.
- **Spectator HUD overlay** (new DOM in `index.html`, wired in `main.ts`):
  - "▸ SPECTATING — <map>" banner
  - currently-followed player name
  - controls hint (cycle player, change view, leave)
  - "Join this match" button (reloads without `spectate`, into the queue) and
    "Leave" button (→ lobby)
  - hide the fire/move action buttons for spectators
- **Reward-safe by construction**: spectator entry never calls `POST /register`;
  spectators stay on the spectator team and never frag, so the oracle log parser
  never attributes anything to them.
- **Server preselect**: honor `?server=<id>` (e.g. `d2`) to skip the picker and drop
  straight into that match in spectate mode.

### Layer C — Lobby + reward-backend

- **`GET /matches`** in `services/reward-backend/src/api/app.ts` (Hono):
  - Config-driven server list (env `MATCH_SERVERS`, default the known train/d2 boxes),
    each entry `{ id, name, map, url }`.
  - For each, fetch its `/players`; assemble:
    ```json
    [{ "id":"train","name":"DE_TRAIN","map":"de_train","url":"https://game.chainstrike.fun",
       "players":17,"maxPlayers":30,"spectators":1,"maxSpectators":2,"live":true }]
    ```
  - `live=false` (and zeroed counts) when a server's `/players` is unreachable.
  - Short server-side cache / parallel fetch so the endpoint is cheap under lobby polling.
- **"Watch Live" component** in `apps/web` (new, e.g. `components/WatchLive.tsx`):
  - polls `GET ${API_BASE}/matches`; lists ongoing matches with map + live player count
    + spectator count.
  - each row: **Watch** button → opens `${GAME_URL}?spectate=1&server=<id>` in a new tab.
  - when `spectators >= maxSpectators`, disable Watch with "spectator slots full (2/2)".
  - placed alongside `GamePanel` in the lobby (`Home.tsx`).

## 6. Data flow

```
Lobby (apps/web)
  └─ GET /matches ──> reward-backend ──(parallel)──> each server /players
        └─ render Watch Live list
              └─ click Watch ──> open <serverUrl>?spectate=1&server=<id>

Game page (cs-web-server served bundle)
  └─ spectate mode: skip queue, WS connect ?spectate=1
        └─ SFU tags peer isSpectator, caps at 2, excludes from player count
              └─ engine boots, auto `spectate` until observer confirmed
                    └─ spectator HUD; free-look / follow; never registers, never frags
```

## 7. Testing

- **Go unit tests** (`sfu_test.go` or alongside): player vs spectator counting in the
  `/players` payload; spectator-cap refusal at 2; player-cap refusal at 30; spectators
  excluded from `count`.
- **reward-backend test** (existing Hono harness, `src/api/app.test.ts` pattern):
  `GET /matches` shape, live/offline aggregation, parallel fetch, unreachable server
  degrades to `live:false`.
- **Real-browser smoke test** (per project rule — vitest/jsdom cannot exercise the
  engine/WebRTC path): load `?spectate=1`, confirm observer mode engages, free-look /
  follow works, no player slot consumed (`/players.count` unchanged, `spectators` = 1),
  HUD renders, "Join this match" and "Leave" work, 3rd spectator is refused.

## 8. Out of scope (explicitly deferred)

- **HLTV relay** for many viewers on one match (the "scale by relays" model). Documented
  as the future upgrade if a single match ever needs > 2 concurrent viewers.
- Raising `MAX_CLIENTS` above 32.
- 2D match dashboards / minimaps.
- Spectator chat / director cameras.
- Host-side proxy config for `/d2` (lives on the deployment host, not this repo).

## 9. Risks / open items

- **Observer command reliability**: `spectate` must land after the engine has fully
  joined the server. Mitigated by the state-confirmed poll (B), but exact
  cvar/command sequence (`spectate`, `spec_mode`, `spec_autodirector`) needs a quick
  in-engine verification during implementation.
- **Spectator slot starvation is impossible by construction** (30+2=32) — but if a
  future change raises the player cap, the spectator slots vanish; the reconciled
  single-source constants must make that tradeoff explicit.
- **Proxy/`?server=` mapping**: lobby deep-link `server` ids must match the client's
  picker paths (`train`→`''`, `d2`→`'/d2'`).
