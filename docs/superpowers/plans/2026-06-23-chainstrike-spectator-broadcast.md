# ChainStrike Spectator Broadcast Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let unlimited viewers watch ongoing ChainStrike matches live, from one unified "Watch Live" area in the lobby, via a broadcast video stream — with zero per-viewer engine cost.

**Architecture:** One headless-browser **capture client** per match connects to the game server as a single in-engine spectator (auto-director camera), captures its canvas + audio, and publishes via **WHIP to Cloudflare Stream**, which serves low-latency HLS over a CDN. The lobby embeds the Cloudflare player per match. The Go SFU is taught to count the capture client as a spectator (not a player), and the reward-backend gains a `GET /matches` aggregator returning per-match counts + Cloudflare `playbackId`.

**Tech Stack:** Go (cs-web-server SFU), TypeScript/Vite (game client + capture page), Playwright + headless Chromium (capture runner), Hono + vitest (reward-backend), React/Vite (apps/web lobby), Cloudflare Stream (WHIP ingest + HLS/CDN).

## Global Constraints

- `MAX_CLIENTS = 32` is a hard GoldSrc limit — never raise it. One capture client = 1 spectator slot.
- Player cap stays **30**. Engine runs `+maxplayers 31` (30 players + 1 capture). `maxSpectators = 1`.
- Spectators (the capture client) are **never** counted as players, never queue, never register a callsign, never frag → never reward-eligible.
- Secrets (Cloudflare WHIP URLs/keys) live in **env only** — never committed, never printed in logs or chat.
- Follow existing code style in each package (no unilateral restructuring). Frequent commits. TDD where logic is unit-testable; explicit headless/real-browser verification where it is not.
- Spec of record: `docs/superpowers/specs/2026-06-23-chainstrike-spectator-mode-design.md`.

---

## Phase 0 — De-risk the capture client (GATE)

The whole feature hinges on a headless browser rendering CS (WASM/WebGL) acceptably and producing a publishable stream. Prove this before building anything else. If it fails, stop and revisit (GPU box, or fall back to the 2-slot in-engine model).

### Task 0: Capture spike — headless render + WHIP publish proof

**Files:**
- Create: `docker/cs-capture/spike/run-spike.mjs` (throwaway proof script)
- Create: `docker/cs-capture/spike/README.md` (findings)

**Interfaces:**
- Produces: a documented yes/no on "headless Chromium renders CS and a WHIP publish to Cloudflare Stream goes live", plus working Chromium GL flags reused by Task 7.

- [ ] **Step 1: Create a Cloudflare Stream live input (manual, operator)**

In the Cloudflare dashboard → Stream → Live Inputs → "Create Live Input", enable **WebRTC (WHIP)**. Copy the **WHIP URL** and the **HLS playback URL / playback id**. Keep the WHIP URL out of git. Export locally:
```bash
export CS_SPIKE_WHIP="https://customer-XXXX.cloudflarestream.com/<input>/webRTC/publish"
export CS_GAME_URL="https://game.chainstrike.fun"
```

- [ ] **Step 2: Write the spike script**

```javascript
// docker/cs-capture/spike/run-spike.mjs
// Throwaway: load the game page, spectate, capture the canvas, WHIP-publish.
import { chromium } from "playwright";

const WHIP = process.env.CS_SPIKE_WHIP;
const GAME = process.env.CS_GAME_URL || "https://game.chainstrike.fun";
if (!WHIP) throw new Error("set CS_SPIKE_WHIP");

const browser = await chromium.launch({
  headless: true,
  args: [
    "--use-gl=angle", "--use-angle=swiftshader",
    "--ignore-gpu-blocklist", "--enable-unsafe-webgpu",
    "--autoplay-policy=no-user-gesture-required",
    "--no-sandbox",
  ],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on("console", (m) => console.log("[page]", m.text()));

// Inject capture config BEFORE the page scripts run.
await page.addInitScript((cfg) => { window.__CAPTURE = cfg; }, {
  whip: WHIP, fps: 30, w: 1280, h: 720,
});

await page.goto(`${GAME}/?spectate=1`, { waitUntil: "domcontentloaded" });

// Give the engine time to boot + connect + enter observer, then capture + publish.
await page.waitForTimeout(20000);
const ok = await page.evaluate(async () => {
  const canvas = document.getElementById("canvas");
  if (!canvas) return "no canvas";
  const stream = canvas.captureStream(30);
  if (!stream.getVideoTracks().length) return "no video track";
  const pc = new RTCPeerConnection();
  stream.getTracks().forEach((t) => pc.addTrack(t, stream));
  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  await new Promise((r) => {
    if (pc.iceGatheringState === "complete") return r();
    pc.onicegatheringstatechange = () => pc.iceGatheringState === "complete" && r();
    setTimeout(r, 5000);
  });
  const res = await fetch(window.__CAPTURE.whip, {
    method: "POST",
    headers: { "Content-Type": "application/sdp" },
    body: pc.localDescription.sdp,
  });
  if (!res.ok) return "whip http " + res.status;
  await pc.setRemoteDescription({ type: "answer", sdp: await res.text() });
  return "published";
});
console.log("SPIKE RESULT:", ok);
await page.waitForTimeout(15000); // let the stream run so you can verify playback
await browser.close();
```

- [ ] **Step 3: Run the spike**

```bash
cd docker/cs-capture/spike
npm init -y >/dev/null 2>&1 && npm i -D playwright >/dev/null 2>&1 && npx playwright install chromium
node run-spike.mjs
```
Expected: console prints `SPIKE RESULT: published`, and the Cloudflare Stream live input shows "Connected"/live with a visible CS render when you open the HLS playback URL.

- [ ] **Step 4: Record findings**

Write `docker/cs-capture/spike/README.md` documenting: did it render? CPU/RAM per instance? which GL flags worked? frame rate at 720p? Any audio? This is the GATE — only proceed if render + publish succeeded.

- [ ] **Step 5: Commit the spike + findings**

```bash
git add docker/cs-capture/spike
git commit -m "spike(capture): headless render + WHIP publish proof for spectator broadcast"
```

---

## Phase 1 — Go SFU spectator accounting

Teach the SFU that a `?spectate=1` connection is a spectator: excluded from the player `count`, capped at 1, reported separately.

### Task 1: Pure connection-counting function (TDD)

**Files:**
- Modify: `docker/cs-web-server/src/server/sfu.go` (add `connInfo` type + `countConnections`, near `playersHandler` ~line 651)
- Create: `docker/cs-web-server/src/server/sfu_test.go`

**Interfaces:**
- Produces: `type connInfo struct { connected bool; spectator bool }` and `func countConnections(cs []connInfo) (players, spectators int)` — consumed by Task 2's `playersHandler`.

- [ ] **Step 1: Write the failing test**

```go
// docker/cs-web-server/src/server/sfu_test.go
package main

import "testing"

func TestCountConnections(t *testing.T) {
	cs := []connInfo{
		{connected: true, spectator: false},  // player
		{connected: true, spectator: false},  // player
		{connected: true, spectator: true},   // capture client
		{connected: false, spectator: false}, // stale, ignored
		{connected: false, spectator: true},  // stale spectator, ignored
	}
	players, spectators := countConnections(cs)
	if players != 2 {
		t.Fatalf("players = %d, want 2", players)
	}
	if spectators != 1 {
		t.Fatalf("spectators = %d, want 1", spectators)
	}
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd docker/cs-web-server/src/server && go test ./ -run TestCountConnections -v`
Expected: FAIL — `undefined: connInfo` / `undefined: countConnections`.

- [ ] **Step 3: Write minimal implementation**

Add near `playersHandler` in `sfu.go`:
```go
// connInfo is the minimal per-peer state the player/spectator tally needs,
// extracted so the counting logic is unit-testable without a live PeerConnection.
type connInfo struct {
	connected bool
	spectator bool
}

// countConnections tallies connected players vs spectators. Only Connected peers
// count; stale Failed/Disconnected entries (retained until reaped) are ignored.
func countConnections(cs []connInfo) (players, spectators int) {
	for _, c := range cs {
		if !c.connected {
			continue
		}
		if c.spectator {
			spectators++
		} else {
			players++
		}
	}
	return players, spectators
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd docker/cs-web-server/src/server && go test ./ -run TestCountConnections -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add docker/cs-web-server/src/server/sfu.go docker/cs-web-server/src/server/sfu_test.go
git commit -m "feat(sfu): pure player/spectator counting function"
```

### Task 2: Tag spectator peers + spectator-aware /players + caps

**Files:**
- Modify: `docker/cs-web-server/src/server/sfu.go` — `peerConnectionState` struct (~95), `websocketHandler` (~293), `playersHandler` (~655), constants (~649)

**Interfaces:**
- Consumes: `countConnections` (Task 1).
- Produces: `/players` JSON `{count,max,spectators,maxSpectators}`; spectator peers carry `isSpectator=true`.

- [ ] **Step 1: Add fields/constants**

Change the struct (~line 95) to:
```go
type peerConnectionState struct {
	peerConnection *webrtc.PeerConnection
	websocket      *threadSafeWriter
	signalsCount   int
	isSpectator    bool
}
```
Replace the `maxPlayers` const block (~649) with:
```go
// Must match the engine's +maxplayers (see container CMD): 30 players + 1 capture.
const (
	maxPlayers    = 30
	maxSpectators = 1
)
```

- [ ] **Step 2: Read the spectate flag in `websocketHandler`**

At the top of `websocketHandler` (right after the `Upgrade`, ~line 302), capture the flag from the request before the connection is registered:
```go
isSpectator := r.URL.Query().Get("spectate") == "1"
```
Where the peer is appended to the global list (~line 445), set the field:
```go
state := peerConnectionState{peerConnection, c, DefaultSignalsCount, isSpectator}
```

- [ ] **Step 3: Rewrite `playersHandler` to use the tally**

Replace the body of `playersHandler` (~655) with:
```go
func playersHandler(w http.ResponseWriter, _ *http.Request) {
	listLock.RLock()
	infos := make([]connInfo, 0, len(peerConnections))
	for _, pc := range peerConnections {
		if pc == nil || pc.peerConnection == nil {
			continue
		}
		infos = append(infos, connInfo{
			connected: pc.peerConnection.ConnectionState() == webrtc.PeerConnectionStateConnected,
			spectator: pc.isSpectator,
		})
	}
	listLock.RUnlock()
	players, spectators := countConnections(infos)
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Access-Control-Allow-Origin", "*")
	_ = json.NewEncoder(w).Encode(map[string]int{
		"count": players, "max": maxPlayers,
		"spectators": spectators, "maxSpectators": maxSpectators,
	})
}
```

- [ ] **Step 4: Build to verify it compiles**

Run: `cd docker/cs-web-server/src/server && go build ./... && go test ./ -run TestCountConnections -v`
Expected: build succeeds; counting test still PASS.

- [ ] **Step 5: Commit**

```bash
git add docker/cs-web-server/src/server/sfu.go
git commit -m "feat(sfu): tag spectator peers; /players reports players vs spectators separately"
```

### Task 3: Reconcile maxplayers to 31 across engine config

**Files:**
- Modify: `docker/cs-web-server/Dockerfile:157`
- Modify: `docker/cs-web-server/configs/cstrike/server.cfg` (the `maxplayers`/spectator block)

**Interfaces:** none (config alignment).

- [ ] **Step 1: Set the engine CMD**

In `docker/cs-web-server/Dockerfile`, change line 157 from `CMD ["+map de_dust2", "+maxplayers", "16"]` to:
```dockerfile
CMD ["+map de_dust2", "+maxplayers", "31"]
```

- [ ] **Step 2: Align the cstrike server.cfg**

Ensure `docker/cs-web-server/configs/cstrike/server.cfg` keeps `mp_allowspectators 1` and add a comment near it:
```
// 30 players + 1 broadcast capture client = 31 (engine hard cap 32). Do not exceed.
mp_allowspectators 1
```

- [ ] **Step 3: Verify no other maxplayers drift remains**

Run: `grep -rniE "maxplayers" docker/cs-web-server/Dockerfile docker/cs-web-server/configs docker/cs-web-server/src/server/sfu.go`
Expected: engine `31`, Go `maxPlayers = 30`, `maxSpectators = 1`; no stray `16`/`12` for the cstrike match path.

- [ ] **Step 4: Commit**

```bash
git add docker/cs-web-server/Dockerfile docker/cs-web-server/configs/cstrike/server.cfg
git commit -m "fix(cs-web-server): reconcile maxplayers to 31 (30 players + 1 capture)"
```

---

## Phase 2 — reward-backend `GET /matches`

### Task 4: Match-config parser + aggregator (TDD)

**Files:**
- Create: `services/reward-backend/src/matches.ts`
- Create: `services/reward-backend/src/matches.test.ts`
- Modify: `services/reward-backend/src/types.ts` (add `MatchInfo`, `MatchServerConfig`)

**Interfaces:**
- Produces:
  - `interface MatchServerConfig { id; name; map; url; playbackId }`
  - `interface MatchInfo extends MatchServerConfig { players; maxPlayers; spectators; maxSpectators; live }`
  - `function parseMatchServers(env: string | undefined): MatchServerConfig[]`
  - `function fetchMatches(servers: MatchServerConfig[], fetchImpl?: typeof fetch): Promise<MatchInfo[]>`

- [ ] **Step 1: Add the types**

Append to `services/reward-backend/src/types.ts`:
```typescript
export interface MatchServerConfig {
  id: string;        // lobby/proxy id, e.g. "train" | "d2"
  name: string;      // display, e.g. "DE_TRAIN"
  map: string;       // e.g. "de_train"
  url: string;       // base URL whose /players is polled
  playbackId: string;// Cloudflare Stream playback id for the broadcast
}

export interface MatchInfo extends MatchServerConfig {
  players: number;
  maxPlayers: number;
  spectators: number;
  maxSpectators: number;
  live: boolean;     // server reachable
}
```

- [ ] **Step 2: Write the failing test**

```typescript
// services/reward-backend/src/matches.test.ts
import { describe, it, expect } from "vitest";
import { parseMatchServers, fetchMatches } from "./matches";

describe("parseMatchServers", () => {
  it("parses pipe/comma config", () => {
    const cfg = parseMatchServers(
      "train|DE_TRAIN|de_train|https://game.chainstrike.fun|pb_train," +
      "d2|DE_DUST2|de_dust2|https://game.chainstrike.fun/d2|pb_d2",
    );
    expect(cfg).toHaveLength(2);
    expect(cfg[0]).toMatchObject({ id: "train", map: "de_train", playbackId: "pb_train" });
    expect(cfg[1].url).toBe("https://game.chainstrike.fun/d2");
  });
  it("returns [] for empty", () => {
    expect(parseMatchServers(undefined)).toEqual([]);
  });
});

describe("fetchMatches", () => {
  const servers = [
    { id: "train", name: "DE_TRAIN", map: "de_train", url: "http://a", playbackId: "pb_a" },
    { id: "d2", name: "DE_DUST2", map: "de_dust2", url: "http://b", playbackId: "pb_b" },
  ];
  it("aggregates /players and marks reachable servers live", async () => {
    const fake = (async (input: string) => {
      if (input === "http://a/players")
        return new Response(JSON.stringify({ count: 17, max: 30, spectators: 1, maxSpectators: 1 }));
      throw new Error("down");
    }) as unknown as typeof fetch;
    const out = await fetchMatches(servers, fake);
    expect(out[0]).toMatchObject({ id: "train", players: 17, spectators: 1, live: true });
    expect(out[1]).toMatchObject({ id: "d2", players: 0, live: false, playbackId: "pb_b" });
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd services/reward-backend && npx vitest run src/matches.test.ts`
Expected: FAIL — cannot find `./matches`.

- [ ] **Step 4: Implement `matches.ts`**

```typescript
// services/reward-backend/src/matches.ts
import type { MatchServerConfig, MatchInfo } from "./types";

// Config format: comma-separated entries, each "id|name|map|url|playbackId".
export function parseMatchServers(env: string | undefined): MatchServerConfig[] {
  if (!env) return [];
  return env.split(",").map((e) => e.trim()).filter(Boolean).map((e) => {
    const [id, name, map, url, playbackId] = e.split("|").map((s) => s.trim());
    return { id, name, map, url, playbackId: playbackId ?? "" };
  });
}

interface PlayersResp { count: number; max: number; spectators?: number; maxSpectators?: number }

export async function fetchMatches(
  servers: MatchServerConfig[],
  fetchImpl: typeof fetch = fetch,
): Promise<MatchInfo[]> {
  return Promise.all(
    servers.map(async (s): Promise<MatchInfo> => {
      try {
        const res = await fetchImpl(`${s.url}/players`);
        if (!res.ok) throw new Error(`http ${res.status}`);
        const p = (await res.json()) as PlayersResp;
        return {
          ...s, players: p.count, maxPlayers: p.max,
          spectators: p.spectators ?? 0, maxSpectators: p.maxSpectators ?? 1, live: true,
        };
      } catch {
        return { ...s, players: 0, maxPlayers: 30, spectators: 0, maxSpectators: 1, live: false };
      }
    }),
  );
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd services/reward-backend && npx vitest run src/matches.test.ts`
Expected: PASS (both suites).

- [ ] **Step 6: Commit**

```bash
git add services/reward-backend/src/matches.ts services/reward-backend/src/matches.test.ts services/reward-backend/src/types.ts
git commit -m "feat(backend): match-config parser + /players aggregator"
```

### Task 5: Wire `GET /matches` into the Hono app (TDD)

**Files:**
- Modify: `services/reward-backend/src/api/app.ts` (add route + dep)
- Modify: `services/reward-backend/src/api/app.test.ts` (add a test)

**Interfaces:**
- Consumes: `fetchMatches`, `MatchServerConfig` (Task 4); `AppDeps`.
- Produces: `GET /matches` → `MatchInfo[]`.

- [ ] **Step 1: Write the failing test**

Add to `services/reward-backend/src/api/app.test.ts`:
```typescript
it("GET /matches aggregates configured servers", async () => {
  const servers = [{ id: "train", name: "DE_TRAIN", map: "de_train", url: "http://a", playbackId: "pb_a" }];
  const fakeFetch = (async () =>
    new Response(JSON.stringify({ count: 5, max: 30, spectators: 1, maxSpectators: 1 }))) as unknown as typeof fetch;
  const app = createApp({
    allowlist: [], minMatches: 0, vaultLamports: 0n, budgetBps: 0,
    isEligible: async () => true, matchServers: servers, matchFetch: fakeFetch,
  });
  const res = await app.request("/matches");
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body[0]).toMatchObject({ id: "train", players: 5, live: true, playbackId: "pb_a" });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd services/reward-backend && npx vitest run src/api/app.test.ts -t "GET /matches"`
Expected: FAIL — `matchServers` not in `AppDeps` / route 404.

- [ ] **Step 3: Extend `AppDeps` and add the route**

In `services/reward-backend/src/api/app.ts`, add imports:
```typescript
import { fetchMatches } from "../matches";
import type { MatchServerConfig } from "../types";
```
Add to the `AppDeps` interface:
```typescript
  matchServers?: MatchServerConfig[];
  matchFetch?: typeof fetch;
```
After the `/pool` route, add:
```typescript
  // Live match list for the lobby "Watch Live" area: per-match counts + Cloudflare playbackId.
  app.get("/matches", async (c) => {
    const servers = deps.matchServers ?? [];
    return c.json(await fetchMatches(servers, deps.matchFetch));
  });
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd services/reward-backend && npx vitest run src/api/app.test.ts`
Expected: PASS (new test + existing suite green).

- [ ] **Step 5: Wire real config in the server entrypoint**

In `services/reward-backend/src/api/server.ts`, populate `matchServers` from env where `createApp` is called:
```typescript
import { parseMatchServers } from "../matches";
// ...in the deps object passed to createApp:
matchServers: parseMatchServers(process.env.MATCH_SERVERS),
```
Run: `cd services/reward-backend && npx tsc --noEmit` (expected: no errors).

- [ ] **Step 6: Commit**

```bash
git add services/reward-backend/src/api/app.ts services/reward-backend/src/api/app.test.ts services/reward-backend/src/api/server.ts
git commit -m "feat(backend): GET /matches route fed by MATCH_SERVERS env"
```

---

## Phase 3 — Capture client mode in the game page

Add a capture mode to the served game client so the headless runner (Phase 4) just opens a URL.

### Task 6: `?capture=1` capture-and-publish module

**Files:**
- Create: `docker/cs-web-server/src/client/capture.ts`
- Modify: `docker/cs-web-server/src/client/main.ts` (invoke capture when in capture mode)
- Modify: `docker/cs-web-server/src/client/webrtc.ts` (append `?spectate=1` to the WS URL in spectate mode)

**Interfaces:**
- Consumes: `window.__CAPTURE = { whip: string; fps?: number }` injected by the runner; the engine instance `engine` and the `#canvas` element.
- Produces: `startCapture(canvas: HTMLCanvasElement, whip: string, fps: number): Promise<RTCPeerConnection>`.

- [ ] **Step 1: Implement `capture.ts`**

```typescript
// docker/cs-web-server/src/client/capture.ts
// Capture the rendered game canvas (+audio if available) and WHIP-publish it.
export async function startCapture(
  canvas: HTMLCanvasElement,
  whip: string,
  fps = 30,
): Promise<RTCPeerConnection> {
  const stream = canvas.captureStream(fps);
  // Best-effort: mix in the engine's WebAudio output if a destination is exposed.
  const tap = (window as unknown as { __engineAudioStream?: MediaStream }).__engineAudioStream;
  tap?.getAudioTracks().forEach((t) => stream.addTrack(t));

  const pc = new RTCPeerConnection();
  stream.getTracks().forEach((t) => pc.addTrack(t, stream));
  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  await new Promise<void>((resolve) => {
    if (pc.iceGatheringState === "complete") return resolve();
    pc.onicegatheringstatechange = () => pc.iceGatheringState === "complete" && resolve();
    setTimeout(resolve, 5000);
  });
  const res = await fetch(whip, {
    method: "POST",
    headers: { "Content-Type": "application/sdp" },
    body: pc.localDescription!.sdp,
  });
  if (!res.ok) throw new Error(`WHIP publish failed: ${res.status}`);
  await pc.setRemoteDescription({ type: "answer", sdp: await res.text() });
  return pc;
}
```

- [ ] **Step 2: Append `?spectate=1` to the WS URL in spectate mode**

In `docker/cs-web-server/src/client/webrtc.ts`, where the WebSocket URL is built (~line 163, `new WebSocket(`${protocol}://${host}${serverPath}/websocket`)`), make it spectator-aware:
```typescript
const spec = new URLSearchParams(window.location.search).has("spectate") ||
             new URLSearchParams(window.location.search).has("capture");
const q = spec ? "?spectate=1" : "";
this.ws = new WebSocket(`${protocol}://${host}${serverPath}/websocket${q}`);
```

- [ ] **Step 3: Invoke capture from `main.ts`**

In `docker/cs-web-server/src/client/main.ts`, near the top where `spectateMode` is set (~line 93), add:
```typescript
const captureMode = new URLSearchParams(window.location.search).has('capture')
if (captureMode) spectateMode = true   // capture is a spectator
```
Inside `doJoin()` (~line 408), after the spectate command path, add the capture hook (replace the existing `if (spectateMode) setTimeout(...)` line with a robust observer + capture sequence):
```typescript
if (spectateMode) {
    // Re-issue spectate until the engine confirms observer mode, then auto-direct.
    let tries = 0
    const ensureObs = setInterval(() => {
        x.Cmd_ExecuteString('spectate')
        x.Cmd_ExecuteString('spec_autodirector 1')
        if (++tries >= 6) clearInterval(ensureObs)
    }, 1500)
}
if (captureMode) {
    const cfg = (window as unknown as { __CAPTURE?: { whip: string; fps?: number } }).__CAPTURE
    if (cfg?.whip) {
        // Start publishing once the engine has had time to enter observer mode.
        setTimeout(() => {
            import('./capture').then(({ startCapture }) =>
                startCapture(document.getElementById('canvas') as HTMLCanvasElement, cfg.whip, cfg.fps ?? 30)
                    .then(() => console.log('[capture] publishing'))
                    .catch((e) => console.error('[capture] failed', e)))
        }, 10000)
    }
}
```

- [ ] **Step 4: Type-check the client**

Run: `cd docker/cs-web-server && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Build the client bundle**

Run: `cd docker/cs-web-server && npm run build`
Expected: vite build succeeds (capture chunk emitted).

- [ ] **Step 6: Commit**

```bash
git add docker/cs-web-server/src/client/capture.ts docker/cs-web-server/src/client/main.ts docker/cs-web-server/src/client/webrtc.ts
git commit -m "feat(client): ?capture mode — spectate + autodirector + WHIP publish"
```

---

## Phase 4 — Capture runner container

### Task 7: Playwright runner that supervises one capture page

**Files:**
- Create: `docker/cs-capture/runner.mjs`
- Create: `docker/cs-capture/package.json`
- Create: `docker/cs-capture/Dockerfile`
- Create: `docker/cs-capture/docker-compose.yml`
- Create: `docker/cs-capture/README.md`

**Interfaces:**
- Consumes (env): `MATCH_SERVER_URL`, `WHIP_URL`, `CAPTURE_W`, `CAPTURE_H`, `CAPTURE_FPS`.
- Produces: a long-running container that keeps a capture page alive and auto-restarts it.

- [ ] **Step 1: Write the runner**

```javascript
// docker/cs-capture/runner.mjs
import { chromium } from "playwright";

const GAME = process.env.MATCH_SERVER_URL;     // e.g. https://game.chainstrike.fun  (or .../d2)
const WHIP = process.env.WHIP_URL;             // Cloudflare Stream WHIP publish URL (secret)
const W = +(process.env.CAPTURE_W || 1280);
const H = +(process.env.CAPTURE_H || 720);
const FPS = +(process.env.CAPTURE_FPS || 30);
if (!GAME || !WHIP) throw new Error("MATCH_SERVER_URL and WHIP_URL are required");

async function runOnce() {
  const browser = await chromium.launch({
    headless: true,
    args: [
      "--use-gl=angle", "--use-angle=swiftshader", "--ignore-gpu-blocklist",
      "--autoplay-policy=no-user-gesture-required", "--no-sandbox",
      `--window-size=${W},${H}`,
    ],
  });
  try {
    const page = await browser.newPage({ viewport: { width: W, height: H } });
    page.on("console", (m) => console.log("[page]", m.text()));
    await page.addInitScript((cfg) => { window.__CAPTURE = cfg; }, { whip: WHIP, fps: FPS });
    await page.goto(`${GAME}/?capture=1`, { waitUntil: "domcontentloaded" });
    // Stay alive until the page/engine dies; Playwright rejects on crash/close.
    await page.waitForEvent("close", { timeout: 0 });
  } finally {
    await browser.close().catch(() => {});
  }
}

// Supervisor: restart on any failure with backoff.
for (;;) {
  try { await runOnce(); } catch (e) { console.error("[runner] crashed:", e?.message); }
  console.log("[runner] restarting in 5s");
  await new Promise((r) => setTimeout(r, 5000));
}
```

- [ ] **Step 2: package.json**

```json
{
  "name": "cs-capture",
  "private": true,
  "type": "module",
  "scripts": { "start": "node runner.mjs" },
  "dependencies": { "playwright": "^1.47.0" }
}
```

- [ ] **Step 3: Dockerfile**

```dockerfile
FROM mcr.microsoft.com/playwright:v1.47.0-jammy
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev && npx playwright install chromium
COPY runner.mjs ./
CMD ["node", "runner.mjs"]
```

- [ ] **Step 4: docker-compose (one service per match; secrets via .env, not committed)**

```yaml
services:
  capture-train:
    build: .
    restart: always
    environment:
      MATCH_SERVER_URL: "https://game.chainstrike.fun"
      WHIP_URL: "${WHIP_URL_TRAIN}"
      CAPTURE_W: "1280"
      CAPTURE_H: "720"
      CAPTURE_FPS: "30"
  capture-d2:
    build: .
    restart: always
    environment:
      MATCH_SERVER_URL: "https://game.chainstrike.fun/d2"
      WHIP_URL: "${WHIP_URL_D2}"
      CAPTURE_W: "1280"
      CAPTURE_H: "720"
      CAPTURE_FPS: "30"
```

- [ ] **Step 5: README (ops) + .gitignore for secrets**

Write `docker/cs-capture/README.md`: how to set `WHIP_URL_TRAIN` / `WHIP_URL_D2` in a local `.env` (gitignored), `docker compose up -d`, and how to verify each capture is live in Cloudflare. Add a `.gitignore` line `\.env` in `docker/cs-capture/`.

- [ ] **Step 6: Local smoke (one instance)**

Run (with a real WHIP URL exported):
```bash
cd docker/cs-capture && npm install && npx playwright install chromium
MATCH_SERVER_URL=https://game.chainstrike.fun WHIP_URL="$CS_SPIKE_WHIP" node runner.mjs
```
Expected: `[page] [capture] publishing` within ~30s; Cloudflare live input shows connected; HLS playback shows the live match.

- [ ] **Step 7: Commit**

```bash
git add docker/cs-capture
git commit -m "feat(capture): Playwright runner container — supervised per-match broadcaster"
```

---

## Phase 5 — Lobby "Watch Live"

### Task 8: `WatchLive` component embedding the Cloudflare player

**Files:**
- Create: `apps/web/src/components/WatchLive.tsx`
- Modify: `apps/web/src/components/Home.tsx` (render `<WatchLive />`)
- Modify: `apps/web/src/lib/config.ts` (add `CF_STREAM_CUSTOMER` if needed for the iframe host)

**Interfaces:**
- Consumes: `GET ${API_BASE}/matches` → `MatchInfo[]` (Task 5); `API_BASE` from `config.ts`.
- Produces: a lobby section listing live matches with an embedded low-latency HLS player each.

- [ ] **Step 1: Add the Cloudflare customer host to config**

In `apps/web/src/lib/config.ts`, add:
```typescript
// Cloudflare Stream customer subdomain for iframe playback, e.g. "customer-abc123".
export const CF_STREAM_CUSTOMER = import.meta.env.VITE_CF_STREAM_CUSTOMER ?? "";
```

- [ ] **Step 2: Implement `WatchLive.tsx`**

```tsx
import { useEffect, useState } from "react";
import { API_BASE, CF_STREAM_CUSTOMER } from "../lib/config";

interface MatchInfo {
  id: string; name: string; map: string; url: string; playbackId: string;
  players: number; maxPlayers: number; spectators: number; maxSpectators: number; live: boolean;
}

export function WatchLive() {
  const [matches, setMatches] = useState<MatchInfo[]>([]);
  useEffect(() => {
    let on = true;
    const load = () =>
      fetch(`${API_BASE}/matches`).then((r) => r.json()).then((m) => on && setMatches(m)).catch(() => {});
    load();
    const iv = setInterval(load, 5000);
    return () => { on = false; clearInterval(iv); };
  }, []);

  const live = matches.filter((m) => m.live && m.playbackId);
  if (!live.length) return null;

  return (
    <section className="watch-live panel">
      <div className="panel-head">
        <h2>Watch <span className="accent">Live</span></h2>
        <span className="hint">SPECTATE · LIVE STREAM</span>
      </div>
      <div className="watch-grid">
        {live.map((m) => (
          <div className="watch-card" key={m.id}>
            <div className="watch-meta">
              <span className="watch-map">{m.name}</span>
              <span className="watch-count"><span className="dot" /> {m.players}/{m.maxPlayers}</span>
            </div>
            <div className="watch-player">
              <iframe
                title={m.name}
                src={`https://${CF_STREAM_CUSTOMER}.cloudflarestream.com/${m.playbackId}/iframe?autoplay=true&muted=true`}
                allow="accelerometer; gyroscope; autoplay; encrypted-media; picture-in-picture;"
                allowFullScreen
              />
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
```

- [ ] **Step 3: Render it in `Home.tsx`**

In `apps/web/src/components/Home.tsx`, import and place `<WatchLive />` after the hero `</section>` (e.g. before the existing lower content):
```tsx
import { WatchLive } from "./WatchLive";
// ...inside the returned JSX, after the hero section:
<WatchLive />
```

- [ ] **Step 4: Minimal styling**

Append to the lobby stylesheet (the file that holds `.panel`/`.home`; find with `grep -rl "\.panel-head" apps/web/src`):
```css
.watch-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:16px}
.watch-card{border:1px solid var(--line);border-radius:12px;overflow:hidden;background:#0b0b0b}
.watch-meta{display:flex;justify-content:space-between;align-items:center;padding:10px 12px;font-family:'Spline Sans Mono',monospace}
.watch-player{aspect-ratio:16/9;background:#000}
.watch-player iframe{width:100%;height:100%;border:0;display:block}
```

- [ ] **Step 5: Type-check + build the lobby**

Run: `cd apps/web && npx tsc --noEmit && npm run build`
Expected: no type errors; build succeeds.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/components/WatchLive.tsx apps/web/src/components/Home.tsx apps/web/src/lib/config.ts
git commit -m "feat(lobby): Watch Live — embedded Cloudflare Stream players per live match"
```

---

## Phase 6 — End-to-end verification

### Task 9: Full-path real-browser smoke test

**Files:**
- Create: `docs/superpowers/plans/notes/spectator-smoke-checklist.md` (record results)

**Interfaces:** none — exercises the whole pipeline.

- [ ] **Step 1: Bring up the stack**

Deploy/run: the updated cs-web-server (engine `+maxplayers 31`, spectator-aware `/players`), the reward-backend with `MATCH_SERVERS` set, the `cs-capture` runner(s) with real `WHIP_URL`s, and the lobby with `VITE_CF_STREAM_CUSTOMER` + `VITE_API_BASE` set.

- [ ] **Step 2: Verify spectator accounting**

Run: `curl -s https://game.chainstrike.fun/players`
Expected JSON includes `"spectators":1` (the capture client) while `"count"` reflects only real players, and stays ≤ 30.

- [ ] **Step 3: Verify the aggregator**

Run: `curl -s "$VITE_API_BASE/matches"`
Expected: an array with each configured match, correct `players`, `live:true`, and a non-empty `playbackId`.

- [ ] **Step 4: Verify the lobby end-to-end (real browser)**

Open the lobby in a browser; confirm the "Watch Live" section shows the live match video playing (the actual CS match, auto-director camera), the player count updates, and it works on a phone-sized viewport. Confirm joining as a real player elsewhere does NOT consume a spectator slot and the capture stream is unaffected.

- [ ] **Step 5: Record results + commit**

Write pass/fail per step into `spectator-smoke-checklist.md`.
```bash
git add docs/superpowers/plans/notes/spectator-smoke-checklist.md
git commit -m "test(spectator): end-to-end broadcast smoke checklist results"
```

---

## Self-Review (completed by plan author)

- **Spec coverage:** Capture client + runner (spec §5A) → Phase 0 + Tasks 6,7. SFU spectator accounting (§5B) → Tasks 1–3. `/matches` + Watch Live (§5C) → Tasks 4,5,8. Cloudflare Stream/WHIP (§2) → Tasks 0,6,7,8. Auto-director (§2) → Task 6. Testing (§7) → Tasks 1,4,5 (unit) + Task 9 (real-browser). Capture risk spike (§9) → Phase 0 gate. All spec sections mapped.
- **Placeholder scan:** No "TBD/handle errors/similar to" — every code step has concrete code; infra steps that can't be unit-tested have explicit expected observable output.
- **Type consistency:** `connInfo`/`countConnections` (Tasks 1↔2); `MatchServerConfig`/`MatchInfo`/`parseMatchServers`/`fetchMatches` (Tasks 4↔5↔8); `window.__CAPTURE = {whip,fps}` and `startCapture(canvas,whip,fps)` (Tasks 6↔7); `/players` shape `{count,max,spectators,maxSpectators}` consistent (Tasks 2↔4↔9).
