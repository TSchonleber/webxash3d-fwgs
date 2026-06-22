# webxash3d Solana — Phase 0 / Plan 5: Reward Backend HTTP API

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The HTTP glue that connects the oracle (Plan 4) and the future web client to the settlement logic (Plan 2): ingest signed match results, expose the live hourly leaderboard, settle an hour, and serve each winner their claim args.

**Architecture:** A small Hono app added to `services/reward-backend`. All routes are tested **in-process via `app.request(...)`** — no port binding, no domain, no network. The signature check verifies the Go oracle's ed25519 envelope over the exact signed bytes (so Plan 4's envelope is hardened to carry the result as a JSON string). Storage is in-memory for Phase 0 (a `MatchStore` bucketed by UTC hour + a settlement cache). A thin `server.ts` runs it on `localhost:PORT` for local/dev — never needs a domain.

**Tech Stack:** TypeScript ESM, Hono, `@hono/node-server` (runtime only), `tweetnacl` (raw ed25519 verify), vitest.

**Prereqs:** Plan 2 (`services/reward-backend`, green) and Plan 4 (`docker/cs-web-server/src/server/oracle`, green).

---

## File Structure
- Modify: `docker/cs-web-server/src/server/oracle/oracle.go` + `oracle_test.go` — envelope `result` as exact JSON string (cross-lang sig stability)
- Modify: `services/reward-backend/package.json` — add `hono`, `@hono/node-server`, `tweetnacl`
- Create: `services/reward-backend/src/api/verify.ts` + `verify.test.ts`
- Create: `services/reward-backend/src/api/store.ts` + `store.test.ts`
- Create: `services/reward-backend/src/api/app.ts` + `app.test.ts`
- Create: `services/reward-backend/src/api/server.ts` — runnable entry (not unit-tested)
- Create: `services/reward-backend/src/api/README.md`

---

### Task 1: Harden the Go oracle envelope (sign-stable result string)

The signed payload is the canonical JSON bytes; send them verbatim as a string so the verifier checks the exact same bytes regardless of JSON key ordering across languages.

- [ ] **Step 1: Update `oracle_test.go` expectation**

In `docker/cs-web-server/src/server/oracle/oracle_test.go`, change the `TestPostSendsSignedEnvelope` capture struct so `Result` is a string and assert it parses back to the same match:
```go
	var got struct {
		Result       string `json:"result"`
		Signature    string `json:"signature"`
		ServerPubkey string `json:"serverPubkey"`
	}
	// ... after the request ...
	if got.Result == "" || got.Signature == "" || got.ServerPubkey == "" {
		t.Fatalf("envelope incomplete: %+v", got)
	}
	var rt MatchResult
	if err := json.Unmarshal([]byte(got.Result), &rt); err != nil || rt.MatchID != "m" {
		t.Fatalf("result string must be the exact signed json: %v", err)
	}
```

- [ ] **Step 2: Run & verify fail** — `cd docker/cs-web-server/src/server/oracle && go test ./...` Expected: FAIL (envelope.Result is currently json.RawMessage/object).

- [ ] **Step 3: Update `oracle.go` envelope**

Change the `envelope` struct + `Post` in `oracle.go`:
```go
type envelope struct {
	Result       string `json:"result"`       // exact JSON bytes that were signed
	Signature    string `json:"signature"`    // base64
	ServerPubkey string `json:"serverPubkey"` // base64 (raw 32-byte ed25519 pubkey)
}

// Post signs the result and POSTs the signed envelope to url.
func (s *Signer) Post(url string, res MatchResult) error {
	payload, sig := s.Sign(res)
	env := envelope{
		Result:       string(payload),
		Signature:    base64.StdEncoding.EncodeToString(sig),
		ServerPubkey: base64.StdEncoding.EncodeToString(s.priv.Public().(ed25519.PublicKey)),
	}
	body, _ := json.Marshal(env)
	resp, err := http.Post(url, "application/json", bytes.NewReader(body))
	if err != nil { return err }
	defer resp.Body.Close()
	if resp.StatusCode >= 300 { return fmt.Errorf("backend rejected result: %d", resp.StatusCode) }
	return nil
}
```

- [ ] **Step 4: Run & verify pass** — `go test ./...` Expected: all oracle tests PASS.

- [ ] **Step 5: Commit**
```bash
git add docker/cs-web-server/src/server/oracle/oracle.go docker/cs-web-server/src/server/oracle/oracle_test.go
git commit -m "fix(oracle): send signed result as exact JSON string for cross-lang verify"
```

---

### Task 2: Add API dependencies

- [ ] **Step 1: Add deps** to `services/reward-backend/package.json` `dependencies`: `"hono": "^4.5.0"`, `"@hono/node-server": "^1.12.0"`, `"tweetnacl": "^1.0.3"`. Run: `cd services/reward-backend && npm install`.

- [ ] **Step 2: Commit**
```bash
git add services/reward-backend/package.json services/reward-backend/package-lock.json
git commit -m "chore(reward-backend): add hono + tweetnacl for HTTP API"
```

---

### Task 3: Envelope verification

Verifies the Go oracle's signed envelope: ed25519-verify the base64 signature over the UTF-8 bytes of the `result` string, using the `serverPubkey` — but only if that pubkey is in the operator allowlist. Returns the parsed `MatchResult` or null.

- [ ] **Step 1: Write the failing test** — `src/api/verify.test.ts`
```ts
import { describe, it, expect } from "vitest";
import nacl from "tweetnacl";
import { verifyEnvelope } from "./verify";

function makeEnvelope(matchId: string, keypair: nacl.SignKeyPair) {
  const result = JSON.stringify({ matchId, endedAtMs: 1, players: [] });
  const sig = nacl.sign.detached(new TextEncoder().encode(result), keypair.secretKey);
  return {
    result,
    signature: Buffer.from(sig).toString("base64"),
    serverPubkey: Buffer.from(keypair.publicKey).toString("base64"),
  };
}

describe("verifyEnvelope", () => {
  it("accepts a valid signature from an allowlisted server", () => {
    const kp = nacl.sign.keyPair();
    const allow = [Buffer.from(kp.publicKey).toString("base64")];
    const res = verifyEnvelope(makeEnvelope("m1", kp), allow);
    expect(res?.matchId).toBe("m1");
  });
  it("rejects a server not on the allowlist", () => {
    const kp = nacl.sign.keyPair();
    expect(verifyEnvelope(makeEnvelope("m1", kp), [])).toBeNull();
  });
  it("rejects a tampered result", () => {
    const kp = nacl.sign.keyPair();
    const allow = [Buffer.from(kp.publicKey).toString("base64")];
    const env = makeEnvelope("m1", kp);
    env.result = env.result.replace("m1", "m2"); // tamper after signing
    expect(verifyEnvelope(env, allow)).toBeNull();
  });
});
```

- [ ] **Step 2: Run & verify fail** — `npm test`. Expected: FAIL, `verifyEnvelope` missing.

- [ ] **Step 3: Implement** — `src/api/verify.ts`
```ts
import nacl from "tweetnacl";
import type { MatchResult } from "../types";

export interface SignedEnvelope { result: string; signature: string; serverPubkey: string; }

export function verifyEnvelope(env: SignedEnvelope, allowlist: string[]): MatchResult | null {
  if (!allowlist.includes(env.serverPubkey)) return null;
  try {
    const ok = nacl.sign.detached.verify(
      new TextEncoder().encode(env.result),
      Buffer.from(env.signature, "base64"),
      Buffer.from(env.serverPubkey, "base64")
    );
    if (!ok) return null;
    return JSON.parse(env.result) as MatchResult;
  } catch {
    return null;
  }
}
```

- [ ] **Step 4: Run & verify pass** — `npm test`. Expected: verify tests PASS.

- [ ] **Step 5: Commit**
```bash
git add services/reward-backend/src/api/verify.ts services/reward-backend/src/api/verify.test.ts
git commit -m "feat(api): verify oracle signed result envelope against operator allowlist"
```

---

### Task 4: In-memory store (matches by hour + settlements)

- [ ] **Step 1: Write the failing test** — `src/api/store.test.ts`
```ts
import { describe, it, expect } from "vitest";
import { MatchStore } from "./store";
import type { MatchResult } from "../types";

const m = (id: string, endedAtMs: number): MatchResult => ({ matchId: id, endedAtMs, players: [] });

describe("MatchStore", () => {
  it("buckets matches by UTC hour", () => {
    const s = new MatchStore();
    s.addMatch(m("a", 100 * 3600_000 + 5));
    s.addMatch(m("b", 100 * 3600_000 + 999));
    s.addMatch(m("c", 101 * 3600_000));
    expect(s.matchesForHour(100).map((x) => x.matchId)).toEqual(["a", "b"]);
    expect(s.matchesForHour(101).map((x) => x.matchId)).toEqual(["c"]);
  });
  it("dedupes by matchId within an hour", () => {
    const s = new MatchStore();
    s.addMatch(m("a", 100 * 3600_000));
    s.addMatch(m("a", 100 * 3600_000)); // same id, ignored
    expect(s.matchesForHour(100)).toHaveLength(1);
  });
  it("stores and returns a settlement for an hour", () => {
    const s = new MatchStore();
    const settlement: any = { periodId: 100, root: Buffer.alloc(32), totalAmount: 0n, awards: [], proofsByWallet: {} };
    s.saveSettlement(100, settlement);
    expect(s.getSettlement(100)).toBe(settlement);
    expect(s.getSettlement(999)).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run & verify fail** — `npm test`. Expected: FAIL, `MatchStore` missing.

- [ ] **Step 3: Implement** — `src/api/store.ts`
```ts
import type { MatchResult } from "../types";
import type { Settlement } from "../settle";
import { utcHourBucket } from "../period";

export class MatchStore {
  private byHour = new Map<number, Map<string, MatchResult>>();
  private settlements = new Map<number, Settlement>();

  addMatch(r: MatchResult): void {
    const hour = utcHourBucket(r.endedAtMs);
    let bucket = this.byHour.get(hour);
    if (!bucket) { bucket = new Map(); this.byHour.set(hour, bucket); }
    if (!bucket.has(r.matchId)) bucket.set(r.matchId, r);
  }

  matchesForHour(hour: number): MatchResult[] {
    return [...(this.byHour.get(hour)?.values() ?? [])];
  }

  saveSettlement(hour: number, s: Settlement): void { this.settlements.set(hour, s); }
  getSettlement(hour: number): Settlement | undefined { return this.settlements.get(hour); }
}
```

- [ ] **Step 4: Run & verify pass** — `npm test`. Expected: store tests PASS.

- [ ] **Step 5: Commit**
```bash
git add services/reward-backend/src/api/store.ts services/reward-backend/src/api/store.test.ts
git commit -m "feat(api): in-memory match store bucketed by hour + settlement cache"
```

---

### Task 5: Hono app (routes)

Routes:
- `GET /health` → `{ ok: true }`
- `POST /results` → verify envelope (allowlist from config); 401 if invalid; else store match → `{ stored: true }`
- `GET /leaderboard/:hour` → `rankHour(matchesForHour(hour), { minMatches })`
- `POST /settle/:hour` → `settleHour(matchesForHour(hour), ctx)`; save settlement; return `{ periodId, total, winners: awards.length }`
- `GET /claim/:hour/:wallet` → from the saved settlement, return `buildClaimArgs`-shaped data (index, amount string, proof hex[]) or 404

Dependencies (verify allowlist, eligibility reader, settle config) are passed into a `createApp(deps)` factory so tests inject stubs (no chain, no real key).

- [ ] **Step 1: Write the failing test** — `src/api/app.test.ts`
```ts
import { describe, it, expect } from "vitest";
import nacl from "tweetnacl";
import { createApp } from "./app";

function signedEnvelope(result: object, kp: nacl.SignKeyPair) {
  const r = JSON.stringify(result);
  const sig = nacl.sign.detached(new TextEncoder().encode(r), kp.secretKey);
  return { result: r, signature: Buffer.from(sig).toString("base64"), serverPubkey: Buffer.from(kp.publicKey).toString("base64") };
}

const hour = 100;
const matchAt = (id: string) => ({
  matchId: id, endedAtMs: hour * 3600_000,
  players: Array.from({ length: 10 }, (_, i) => ({
    wallet: `W${i}`, team: i < 5 ? "A" : "B", won: i < 5, kills: 15 - i, deaths: 5, headshots: 2,
    shotsFired: 100, shotsHit: 40, avgReactionMs: 300,
  })),
});

describe("createApp", () => {
  const kp = nacl.sign.keyPair();
  const deps = {
    allowlist: [Buffer.from(kp.publicKey).toString("base64")],
    minMatches: 1,
    vaultLamports: 1_000_000_000n,
    budgetBps: 1000,
    isEligible: async () => true,
  };

  it("health ok", async () => {
    const res = await createApp(deps).request("/health");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it("rejects an unsigned/forged result with 401", async () => {
    const app = createApp(deps);
    const forged = { result: JSON.stringify(matchAt("m1")), signature: "AA", serverPubkey: "BB" };
    const res = await app.request("/results", { method: "POST", body: JSON.stringify(forged), headers: { "content-type": "application/json" } });
    expect(res.status).toBe(401);
  });

  it("ingests a signed result, ranks it, settles, and serves a claim", async () => {
    const app = createApp(deps);
    const post = await app.request("/results", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify(signedEnvelope(matchAt("m1"), kp)),
    });
    expect(post.status).toBe(200);

    const lb = await (await app.request(`/leaderboard/${hour}`)).json();
    expect(lb.length).toBe(10);
    expect(lb[0].rank).toBe(1);

    const settle = await (await app.request(`/settle/${hour}`, { method: "POST" })).json();
    expect(settle.winners).toBeGreaterThan(0);
    expect(settle.total).toBe("100000000");

    const top = lb[0].wallet;
    const claim = await app.request(`/claim/${hour}/${top}`);
    expect(claim.status).toBe(200);
    const cj = await claim.json();
    expect(cj.index).toBe(0);
    expect(Array.isArray(cj.proof)).toBe(true);

    const miss = await app.request(`/claim/${hour}/NOBODY`);
    expect(miss.status).toBe(404);
  });
});
```

- [ ] **Step 2: Run & verify fail** — `npm test`. Expected: FAIL, `createApp` missing.

- [ ] **Step 3: Implement** — `src/api/app.ts`
```ts
import { Hono } from "hono";
import { verifyEnvelope, type SignedEnvelope } from "./verify";
import { MatchStore } from "./store";
import { rankHour } from "../leaderboard";
import { settleHour } from "../settle";
import { buildClaimArgs } from "../publisher";

export interface AppDeps {
  allowlist: string[];
  minMatches: number;
  vaultLamports: bigint;
  budgetBps: number;
  isEligible: (wallet: string) => Promise<boolean>;
  store?: MatchStore;
}

export function createApp(deps: AppDeps) {
  const store = deps.store ?? new MatchStore();
  const app = new Hono();

  app.get("/health", (c) => c.json({ ok: true }));

  app.post("/results", async (c) => {
    const env = (await c.req.json()) as SignedEnvelope;
    const result = verifyEnvelope(env, deps.allowlist);
    if (!result) return c.json({ error: "invalid signature or unknown server" }, 401);
    store.addMatch(result);
    return c.json({ stored: true });
  });

  app.get("/leaderboard/:hour", (c) => {
    const hour = Number(c.req.param("hour"));
    return c.json(rankHour(store.matchesForHour(hour), { minMatches: deps.minMatches }));
  });

  app.post("/settle/:hour", async (c) => {
    const hour = Number(c.req.param("hour"));
    const s = await settleHour(store.matchesForHour(hour), {
      vaultLamports: deps.vaultLamports, budgetBps: deps.budgetBps,
      minMatches: deps.minMatches, isEligible: deps.isEligible, periodId: hour,
    });
    store.saveSettlement(hour, s);
    return c.json({ periodId: s.periodId, total: s.totalAmount.toString(), winners: s.awards.length });
  });

  app.get("/claim/:hour/:wallet", (c) => {
    const hour = Number(c.req.param("hour"));
    const wallet = c.req.param("wallet");
    const s = store.getSettlement(hour);
    if (!s) return c.json({ error: "hour not settled" }, 404);
    try {
      const args = buildClaimArgs(s, wallet);
      return c.json({
        periodId: args.periodId.toNumber(),
        index: args.index.toNumber(),
        amount: args.amount.toString(),
        proof: args.proof.map((p) => Buffer.from(p).toString("hex")),
      });
    } catch {
      return c.json({ error: "not a winner" }, 404);
    }
  });

  return app;
}
```

- [ ] **Step 4: Run & verify pass** — `npm test`. Expected: ALL package tests PASS (Plan 2/3 + new API).

- [ ] **Step 5: Commit**
```bash
git add services/reward-backend/src/api/app.ts services/reward-backend/src/api/app.test.ts
git commit -m "feat(api): hono app (results ingest, leaderboard, settle, claim)"
```

---

### Task 6: Runnable server + README

- [ ] **Step 1: Create `src/api/server.ts`** (runnable entry; not unit-tested)
```ts
import { serve } from "@hono/node-server";
import { createApp } from "./app";
import { rpcBalanceReader, isHoldEligible } from "../eligibility";
import { Connection } from "@solana/web3.js";

const PORT = Number(process.env.PORT ?? 8787);
const ALLOWLIST = (process.env.OPERATOR_PUBKEYS ?? "").split(",").filter(Boolean);
const MIN_TOKENS = Number(process.env.MIN_TOKENS ?? 1000);
const MINT = process.env.GAME_MINT ?? "";
const RPC = process.env.RPC_URL ?? "https://api.devnet.solana.com";

const reader = rpcBalanceReader(new Connection(RPC));
const app = createApp({
  allowlist: ALLOWLIST,
  minMatches: Number(process.env.MIN_MATCHES ?? 1),
  vaultLamports: BigInt(process.env.VAULT_LAMPORTS ?? "0"),
  budgetBps: Number(process.env.BUDGET_BPS ?? 1000),
  isEligible: (w) => (MINT ? isHoldEligible(reader, w, MINT, MIN_TOKENS) : Promise.resolve(true)),
});

serve({ fetch: app.fetch, port: PORT });
console.log(`reward-backend API on http://localhost:${PORT}`);
```
Add to `package.json` scripts: `"start": "tsx src/api/server.ts"`.

- [ ] **Step 2: Create `src/api/README.md`**
```markdown
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
```

- [ ] **Step 3: Commit**
```bash
git add services/reward-backend/src/api/server.ts services/reward-backend/src/api/README.md services/reward-backend/package.json services/reward-backend/package-lock.json
git commit -m "feat(api): runnable localhost server entry + README"
```

---

## Self-Review

**Spec coverage (this plan = the HTTP surface tying §4 oracle → §6 settlement → client):**
- §10/§6 "results only from operator servers, verified" → Task 3 `verifyEnvelope` (allowlist + ed25519 over exact bytes) + Task 1 sign-stable envelope. ✅
- §6 "hourly leaderboard" + "settle a budgeted % of vault" → Task 5 `/leaderboard`, `/settle` (reuses Plan 2 `rankHour`/`settleHour`). ✅
- §6 "winners claim with a proof" → Task 5 `/claim` (reuses Plan 3 `buildClaimArgs`). ✅
- §5 hold-eligibility gate at settle → `server.ts` wires `rpcBalanceReader`/`isHoldEligible`; tests inject a stub. ✅
- No domain dependency anywhere — tests in-process, runtime on localhost. ✅
- Deferred (correctly): persistence (in-memory now), the hourly cron trigger + N+1 verification buffer, on-chain publish call from `/settle` (publisher exists from Plan 3; wiring it behind `/settle` with a real oracle key is an ops step), KYC gate.

**Placeholder scan:** none. `server.ts` reads real env vars with sane localhost defaults.

**Type consistency:** `SignedEnvelope{result,signature,serverPubkey}` matches the hardened Go envelope (Task 1) field names exactly. `verifyEnvelope` returns `MatchResult` (Plan 2 type). `MatchStore` uses `Settlement` (Plan 2) + `utcHourBucket` (Plan 2). `/settle` passes the exact `SettleCtx` shape from Plan 2. `/claim` serializes `ClaimArgs` (Plan 3) as JSON-safe (BN→number/string, Buffer→hex). Amounts are bigint→string at the JSON boundary throughout.

**Known follow-ups:** durable storage; an hourly scheduler that calls `/settle` + the on-chain publisher (Plan 3) with the operator oracle key + the N+1 buffer; KYC/payout-eligibility gate; rate limiting / CORS for the real client origin.
