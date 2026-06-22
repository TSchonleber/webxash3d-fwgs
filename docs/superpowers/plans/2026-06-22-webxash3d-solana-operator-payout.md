# webxash3d Solana — Phase 0 / Plan 7: Operator Payout Tool (settle + publish on demand)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** An operator-run tool that, **whenever you choose** (one-shot) or **on a chosen interval**, settles a leaderboard period and publishes its Merkle payout on-chain so the top 10 can claim — replacing any automatic hourly scheduler. The oracle signing key lives only in this operator process, never in the public API.

**Architecture:** The backend keeps computing/storing settlements (Plan 5 `/settle`). A new **admin-gated** endpoint exposes the full settlement (root + per-winner proofs). A standalone **operator CLI** (in `services/reward-backend`) orchestrates: trigger settle → fetch settlement → publish on-chain via the distributor program signed by the operator's oracle `Keypair` → (optional) loop on an interval. Pure orchestration is unit-tested with injected mocks; the real chain wiring reuses Plan 3's already-tested `publishSettlement`.

**Tech Stack:** TypeScript ESM, `@coral-xyz/anchor`, `@solana/web3.js`, vitest. Reuses Plan 2/3/5.

**Prereqs:** Plans 2/3/5 green. Distributor IDL at `solana/distributor/target/idl/distributor.json`.

---

## File Structure
- Modify: `services/reward-backend/src/api/app.ts` + `app.test.ts` — admin auth + `GET /admin/settlement/:hour`
- Create: `services/reward-backend/src/operator/runSettlement.ts` + `runSettlement.test.ts` — orchestration
- Create: `services/reward-backend/src/operator/onchain.ts` — real anchor Program + oracle Keypair publisher (not unit-tested; reuses tested `publishSettlement`)
- Create: `services/reward-backend/src/operator/cli.ts` — entrypoint (`settle`, `--hour`, `--every`)
- Create: `services/reward-backend/src/operator/README.md` — deploy + run guide

---

### Task 1: Admin-gated settlement export endpoint

Add a bearer-token admin gate and an endpoint returning the full stored settlement (so the operator can publish it). The token comes from `deps.adminToken`; if unset, admin routes are disabled (404).

- [ ] **Step 1: Add failing tests** — append to `services/reward-backend/src/api/app.test.ts`
```ts
  it("admin settlement export requires the admin token and returns proofs", async () => {
    const app = createApp({ ...deps, adminToken: "secret" });
    // ingest + settle first
    await app.request("/results", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(signedEnvelope(matchAt("m1"), kp)) });
    await app.request(`/settle/${hour}`, { method: "POST" });

    const noAuth = await app.request(`/admin/settlement/${hour}`);
    expect(noAuth.status).toBe(401);

    const ok = await app.request(`/admin/settlement/${hour}`, { headers: { authorization: "Bearer secret" } });
    expect(ok.status).toBe(200);
    const body = await ok.json();
    expect(body.rootHex).toMatch(/^[0-9a-f]{64}$/);
    expect(body.total).toBe("100000000");
    expect(body.awards.length).toBeGreaterThan(0);
    expect(body.awards[0].proofHex).toBeDefined();
  });

  it("admin routes are 404 when no admin token configured", async () => {
    const app = createApp(deps); // no adminToken
    const res = await app.request(`/admin/settlement/${hour}`, { headers: { authorization: "Bearer x" } });
    expect(res.status).toBe(404);
  });
```

- [ ] **Step 2: Run & verify fail** — `cd services/reward-backend && npm test`. Expected: FAIL (route missing).

- [ ] **Step 3: Implement** — in `src/api/app.ts`, extend `AppDeps` with `adminToken?: string` and add (after the existing routes, before `return app`):
```ts
  // --- admin (operator) routes ---
  const requireAdmin = (c: any): Response | null => {
    if (!deps.adminToken) return c.json({ error: "admin disabled" }, 404);
    const auth = c.req.header("authorization") ?? "";
    if (auth !== `Bearer ${deps.adminToken}`) return c.json({ error: "unauthorized" }, 401);
    return null;
  };

  app.get("/admin/settlement/:hour", (c) => {
    const denied = requireAdmin(c); if (denied) return denied;
    const hour = Number(c.req.param("hour"));
    const s = store.getSettlement(hour);
    if (!s) return c.json({ error: "hour not settled" }, 404);
    return c.json({
      periodId: s.periodId,
      rootHex: Buffer.from(s.root).toString("hex"),
      total: s.totalAmount.toString(),
      awards: s.awards.map((a) => ({
        index: a.index, wallet: a.wallet, amount: a.amount.toString(),
        proofHex: s.proofsByWallet[a.wallet].map((b) => Buffer.from(b).toString("hex")),
      })),
    });
  });
```
> Note: the `requireAdmin` 404-before-401 ordering means "no token configured" hides the route entirely; a configured token returns 401 on mismatch.

- [ ] **Step 4: Run & verify pass** — `npm test`. Expected: all API tests PASS (incl. the two new).

- [ ] **Step 5: Commit**
```bash
git add services/reward-backend/src/api/app.ts services/reward-backend/src/api/app.test.ts
git commit -m "feat(api): admin-gated settlement export endpoint"
```

---

### Task 2: Settlement orchestration (unit-tested)

`runSettlement` ties the steps together with injected functions so it tests without a network or chain.

- [ ] **Step 1: Write the failing test** — `src/operator/runSettlement.test.ts`
```ts
import { describe, it, expect, vi } from "vitest";
import { runSettlement } from "./runSettlement";

describe("runSettlement", () => {
  it("settles, fetches the settlement, and publishes it; returns a summary", async () => {
    const settle = vi.fn().mockResolvedValue({ winners: 10, total: "100000000" });
    const fetchSettlement = vi.fn().mockResolvedValue({
      periodId: 100, rootHex: "ab".repeat(32), total: "100000000",
      awards: [{ index: 0, wallet: "W", amount: "50000000", proofHex: ["cd".repeat(32)] }],
    });
    const publish = vi.fn().mockResolvedValue("txsig123");

    const out = await runSettlement(100, { settle, fetchSettlement, publish });
    expect(settle).toHaveBeenCalledWith(100);
    expect(fetchSettlement).toHaveBeenCalledWith(100);
    expect(publish).toHaveBeenCalledTimes(1);
    const [periodId, rootHex, total] = publish.mock.calls[0];
    expect(periodId).toBe(100);
    expect(rootHex).toBe("ab".repeat(32));
    expect(total).toBe("100000000");
    expect(out).toMatchObject({ periodId: 100, winners: 1, total: "100000000", signature: "txsig123" });
  });

  it("skips publishing when there are no winners", async () => {
    const settle = vi.fn().mockResolvedValue({ winners: 0, total: "0" });
    const fetchSettlement = vi.fn().mockResolvedValue({ periodId: 100, rootHex: "00".repeat(32), total: "0", awards: [] });
    const publish = vi.fn();
    const out = await runSettlement(100, { settle, fetchSettlement, publish });
    expect(publish).not.toHaveBeenCalled();
    expect(out.signature).toBeNull();
  });
});
```

- [ ] **Step 2: Run & verify fail** — `npm test`. Expected: FAIL, `runSettlement` missing.

- [ ] **Step 3: Implement** — `src/operator/runSettlement.ts`
```ts
export interface AdminSettlement {
  periodId: number;
  rootHex: string;
  total: string;
  awards: { index: number; wallet: string; amount: string; proofHex: string[] }[];
}

export interface SettlementDeps {
  settle(hour: number): Promise<{ winners: number; total: string }>;
  fetchSettlement(hour: number): Promise<AdminSettlement>;
  publish(periodId: number, rootHex: string, total: string): Promise<string>;
}

export interface SettlementSummary {
  periodId: number; winners: number; total: string; signature: string | null;
}

export async function runSettlement(hour: number, deps: SettlementDeps): Promise<SettlementSummary> {
  await deps.settle(hour);
  const s = await deps.fetchSettlement(hour);
  if (s.awards.length === 0) {
    return { periodId: s.periodId, winners: 0, total: s.total, signature: null };
  }
  const signature = await deps.publish(s.periodId, s.rootHex, s.total);
  return { periodId: s.periodId, winners: s.awards.length, total: s.total, signature };
}
```

- [ ] **Step 4: Run & verify pass** — `npm test`. Expected: orchestration tests PASS.

- [ ] **Step 5: Commit**
```bash
git add services/reward-backend/src/operator/runSettlement.ts services/reward-backend/src/operator/runSettlement.test.ts
git commit -m "feat(operator): settlement orchestration (settle -> fetch -> publish)"
```

---

### Task 3: Real chain wiring + CLI

`onchain.ts` builds the real Anchor program + oracle keypair publisher. `cli.ts` wires the HTTP fetchers + the on-chain publisher into `runSettlement`, supports `--hour current|<n>` and `--every <seconds>`.

- [ ] **Step 1: Create `src/operator/onchain.ts`**
```ts
import { readFileSync } from "node:fs";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { AnchorProvider, Program, Wallet, BN } from "@coral-xyz/anchor";
import idl from "../../../../solana/distributor/target/idl/distributor.json" with { type: "json" };

export function loadKeypair(path: string): Keypair {
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(path, "utf8"))));
}

export interface OnchainConfig { rpcUrl: string; oracleKeypairPath: string; }

// Returns a publish(periodId, rootHex, total) that signs publish_period as the oracle.
export function makePublisher(cfg: OnchainConfig) {
  const connection = new Connection(cfg.rpcUrl, "confirmed");
  const oracle = loadKeypair(cfg.oracleKeypairPath);
  const provider = new AnchorProvider(connection, new Wallet(oracle), { commitment: "confirmed" });
  const program = new Program(idl as any, provider);

  return async (periodId: number, rootHex: string, total: string): Promise<string> => {
    const root = [...Buffer.from(rootHex, "hex")];
    return program.methods
      .publishPeriod(new BN(periodId), root, new BN(total))
      .accounts({ oracle: oracle.publicKey })
      .signers([oracle])
      .rpc();
  };
}
```
> Note: `with { type: "json" }` import attributes need Node ≥ 20.10 (Node 25 OK). If the runner objects, `JSON.parse(readFileSync(...))` the IDL path instead.

- [ ] **Step 2: Create `src/operator/cli.ts`**
```ts
import { runSettlement, type AdminSettlement } from "./runSettlement";
import { makePublisher } from "./onchain";

const API = process.env.API_BASE ?? "http://localhost:8787";
const ADMIN = process.env.ADMIN_TOKEN ?? "";
const RPC = process.env.RPC_URL ?? "http://localhost:8899";
const ORACLE_KEY = process.env.ORACLE_KEYPAIR ?? "";

function currentUtcHour(): number { return Math.floor(Date.now() / 3_600_000); }

function parseArgs() {
  const a = process.argv.slice(2);
  const hourArg = a[a.indexOf("--hour") + 1];
  const everyArg = a.includes("--every") ? Number(a[a.indexOf("--every") + 1]) : 0;
  return { hourArg, everySec: everyArg };
}

async function settleOnce(hour: number) {
  const publish = makePublisher({ rpcUrl: RPC, oracleKeypairPath: ORACLE_KEY });
  const headers = { authorization: `Bearer ${ADMIN}` };
  const out = await runSettlement(hour, {
    settle: async (h) => (await fetch(`${API}/settle/${h}`, { method: "POST" })).json(),
    fetchSettlement: async (h) => (await fetch(`${API}/admin/settlement/${h}`, { headers })).json() as Promise<AdminSettlement>,
    publish,
  });
  console.log(`[settle] hour ${out.periodId}: ${out.winners} winners, ${out.total} lamports, tx=${out.signature ?? "none"}`);
  return out;
}

async function main() {
  const { hourArg, everySec } = parseArgs();
  const pick = () => (hourArg && hourArg !== "current" ? Number(hourArg) : currentUtcHour() - 1); // settle the just-finished hour
  if (everySec > 0) {
    console.log(`[operator] settling every ${everySec}s. Ctrl-C to stop.`);
    // eslint-disable-next-line no-constant-condition
    while (true) {
      try { await settleOnce(pick()); } catch (e) { console.error("[settle] error:", e); }
      await new Promise((r) => setTimeout(r, everySec * 1000));
    }
  } else {
    await settleOnce(pick());
  }
}
main();
```

- [ ] **Step 3: Add scripts** to `services/reward-backend/package.json`: `"operator": "tsx src/operator/cli.ts"`.

- [ ] **Step 4: Typecheck/build sanity**

Run: `cd services/reward-backend && npx tsc --noEmit` (expect no errors) and `npm test` (all still green). The CLI itself is exercised by the unit-tested `runSettlement`; the chain call reuses the publish pattern proved in Plan 3.

- [ ] **Step 5: Commit**
```bash
git add services/reward-backend/src/operator/onchain.ts services/reward-backend/src/operator/cli.ts services/reward-backend/package.json services/reward-backend/package-lock.json
git commit -m "feat(operator): on-chain publisher + settle CLI (on-demand and --every interval)"
```

---

### Task 4: Operator README (deploy + run)

- [ ] **Step 1: Create `src/operator/README.md`**
```markdown
# operator payout tool

Settle a leaderboard period and publish its Merkle payout on-chain — on demand or on an interval.
The oracle key lives only here, never in the public API.

## One-time chain setup (devnet)
    cd ../../..//solana/distributor
    solana-keygen new -o oracle.json            # the operator/oracle key
    solana config set --url devnet
    anchor build && anchor deploy --provider.cluster devnet
    # call initialize(oracle_pubkey), init_vault, then fund the vault PDA with SOL

## Env
    API_BASE=http://localhost:8787
    ADMIN_TOKEN=<same token the backend API was started with>
    RPC_URL=https://api.devnet.solana.com
    ORACLE_KEYPAIR=/abs/path/to/oracle.json

## Pay the top 10 — WHEN YOU CHOOSE (one-shot, settles the just-finished UTC hour)
    npm run operator
    npm run operator -- --hour 495034     # or a specific hour bucket

## Pay on a chosen interval (e.g. every 30 min)
    npm run operator -- --every 1800

Each run: POST /settle/:hour -> GET /admin/settlement/:hour -> publish_period(root,total) signed by the oracle.
Players then claim via the web client (served from the backend's stored settlement).
```

- [ ] **Step 2: Commit**
```bash
git add services/reward-backend/src/operator/README.md
git commit -m "docs(operator): deploy + run guide"
```

---

## Self-Review

**Spec coverage (this plan = operator-controlled settlement replacing the auto-scheduler, per the user's directive):**
- "Pay the top of the leaderboard at intervals when we choose" → Task 3 CLI: one-shot (`--hour`) and interval (`--every`). ✅
- Settlement stays solvency-capped (Plan 2/5 `settleHour`) and on-chain via the oracle (Plan 1 `publish_period`). ✅
- Oracle key isolated to the operator process (not the public API) → `onchain.ts` loads it from `ORACLE_KEYPAIR`; admin endpoint only exposes public settlement data. ✅
- Admin export gated by bearer token; disabled (404) when no token set. → Task 1. ✅

**Placeholder scan:** none in code. README setup commands use example paths/values.

**Type consistency:** `AdminSettlement{periodId,rootHex,total,awards[{index,wallet,amount,proofHex}]}` returned by `/admin/settlement/:hour` (Task 1) matches the shape consumed by `runSettlement`/`makePublisher` (Tasks 2/3). `publish(periodId:number, rootHex:string, total:string)` signature consistent across the mock test, `runSettlement`, and `onchain.ts`. On-chain call matches `publish_period(period_id:u64, merkle_root:[u8;32], total_amount:u64)` (root via hex→byte array, BN amounts) — same as Plan 3.

**Known follow-ups:** wire eligibility (the backend `/settle` already gates via its injected `isEligible`; set `GAME_MINT` once the token exists); persist settlements across API restarts (in-memory today); the operator could also auto-`fund` the vault (manual for now); the just-finished-hour default (`currentUtcHour()-1`) assumes the operator runs shortly after the hour — `--hour` overrides for any period.
```
