# webxash3d Solana — Phase 0 / Plan 2: Reward Backend (settlement domain logic)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A standalone TypeScript package that turns a stream of match results into the hourly top-10 payout set the on-chain distributor (Plan 1) consumes — computing the leaderboard, applying tier-1 anti-cheat and hold-eligibility gating, splitting a solvency-capped pool, and building a Merkle root **byte-identical** to the program's verification.

**Architecture:** Pure, dependency-injected domain modules (no network, no chain) so everything is unit-testable with `vitest`. The chain publisher + HTTP API + matchmaking are deliberately deferred to later plans; this plan delivers the deterministic core and its Merkle compatibility guarantee. Each module is one file with one responsibility.

**Tech Stack:** TypeScript, Node 25, `vitest`, `@solana/web3.js` (types + `Connection` interface only), `bn.js`, `js-sha3` (keccak256).

**Location:** `services/reward-backend/` in the fork (repo root `/Users/r4vager/Desktop/webxash3d-fwgs`, branch `feat/solana-rewards`). The repo's `pnpm-workspace.yaml` globs `packages/*`, so a `services/*` package stays isolated — install it with its own `npm install`.

**Merkle convention (MUST match Plan 1 `solana/distributor`):**
- Leaf: `keccak256( index_u64_LE || claimant_pubkey_32 || amount_u64_LE )`
- Parent: `keccak256( sort(a,b).0 || sort(a,b).1 )` (sorted by bytes)
- Cross-compatibility is locked by a known-answer test (Task 4) whose expected root is generated from `solana/distributor/tests/merkle.ts` on the same awards.

---

## File Structure

- Create: `services/reward-backend/package.json`
- Create: `services/reward-backend/tsconfig.json`
- Create: `services/reward-backend/vitest.config.ts`
- Create: `services/reward-backend/src/types.ts` — shared domain types
- Create: `services/reward-backend/src/period.ts` — UTC hour bucketing
- Create: `services/reward-backend/src/merkle.ts` — keccak Merkle tree (matches on-chain)
- Create: `services/reward-backend/src/leaderboard.ts` — hourly points engine
- Create: `services/reward-backend/src/payout.ts` — solvency-capped top-10 split
- Create: `services/reward-backend/src/anticheat.ts` — tier-1 heuristics
- Create: `services/reward-backend/src/eligibility.ts` — hold-≥1000 balance read (injected connection)
- Tests live beside each module as `*.test.ts`.

---

### Task 1: Package scaffold

**Files:** create `package.json`, `tsconfig.json`, `vitest.config.ts`

- [ ] **Step 1: Create `services/reward-backend/package.json`**
```json
{
  "name": "@webxash3d/reward-backend",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": { "test": "vitest run", "test:watch": "vitest" },
  "dependencies": {
    "@solana/web3.js": "^1.95.0",
    "bn.js": "^5.2.1",
    "js-sha3": "^0.9.3"
  },
  "devDependencies": {
    "@types/bn.js": "^5.1.5",
    "@types/node": "^20.11.0",
    "typescript": "^5.4.0",
    "vitest": "^1.6.0"
  }
}
```

- [ ] **Step 2: Create `services/reward-backend/tsconfig.json`**
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "types": ["node"]
  },
  "include": ["src"]
}
```

- [ ] **Step 3: Create `services/reward-backend/vitest.config.ts`**
```ts
import { defineConfig } from "vitest/config";
export default defineConfig({ test: { include: ["src/**/*.test.ts"] } });
```

- [ ] **Step 4: Install**

Run: `cd services/reward-backend && npm install`
Expected: `node_modules` present, no errors.

- [ ] **Step 5: Commit**
```bash
git add services/reward-backend/package.json services/reward-backend/tsconfig.json services/reward-backend/vitest.config.ts services/reward-backend/package-lock.json
git commit -m "chore(reward-backend): scaffold vitest TS package"
```

---

### Task 2: Domain types

**Files:** Create `src/types.ts` (no test — consumed by tested modules)

- [ ] **Step 1: Create `src/types.ts`**
```ts
export type Team = "A" | "B";

export interface MatchPlayer {
  wallet: string;        // base58 pubkey
  team: Team;
  won: boolean;          // player's team won the match
  kills: number;
  deaths: number;
  headshots: number;
  shotsFired: number;
  shotsHit: number;
  avgReactionMs: number; // mean ms from enemy-visible to first damage
}

export interface MatchResult {
  matchId: string;
  endedAtMs: number;     // unix ms
  players: MatchPlayer[];
}

export interface RankedEntry {
  wallet: string;
  points: number;
  matches: number;
  rank: number;          // 1-based
}

export interface Award {
  index: number;         // 0-based position in the published set
  wallet: string;        // base58
  amount: bigint;        // lamports
}
```

- [ ] **Step 2: Commit**
```bash
git add services/reward-backend/src/types.ts
git commit -m "feat(reward-backend): domain types"
```

---

### Task 3: Period bucketing

**Files:** Create `src/period.ts`, `src/period.test.ts`

- [ ] **Step 1: Write the failing test** — `src/period.test.ts`
```ts
import { describe, it, expect } from "vitest";
import { utcHourBucket } from "./period";

describe("utcHourBucket", () => {
  it("maps a timestamp to its UTC clock-hour index", () => {
    // 1970-01-01T02:30:00Z => hour 2
    expect(utcHourBucket(2 * 3600_000 + 30 * 60_000)).toBe(2);
  });
  it("is stable within an hour and increments across the boundary", () => {
    const base = 100 * 3600_000;
    expect(utcHourBucket(base)).toBe(100);
    expect(utcHourBucket(base + 3599_999)).toBe(100);
    expect(utcHourBucket(base + 3600_000)).toBe(101);
  });
});
```

- [ ] **Step 2: Run & verify fail** — Run: `npm test`. Expected: FAIL, `utcHourBucket` not exported.

- [ ] **Step 3: Implement** — `src/period.ts`
```ts
export function utcHourBucket(unixMs: number): number {
  return Math.floor(unixMs / 3_600_000);
}
```

- [ ] **Step 4: Run & verify pass** — Run: `npm test`. Expected: period tests PASS.

- [ ] **Step 5: Commit**
```bash
git add services/reward-backend/src/period.ts services/reward-backend/src/period.test.ts
git commit -m "feat(reward-backend): UTC hour bucketing"
```

---

### Task 4: Merkle builder (on-chain compatible)

**Files:** Create `src/merkle.ts`, `src/merkle.test.ts`

- [ ] **Step 1: Write the failing test** — `src/merkle.test.ts`
```ts
import { describe, it, expect } from "vitest";
import { PublicKey } from "@solana/web3.js";
import { buildTree, leafHash } from "./merkle";
import type { Award } from "./types";

const A = (index: number, wallet: string, amount: bigint): Award => ({ index, wallet, amount });

describe("merkle", () => {
  it("single-leaf tree root equals the leaf hash", () => {
    const w = PublicKey.default.toBase58();
    const award = A(0, w, 500_000_000n);
    const { root } = buildTree([award]);
    expect(Buffer.compare(root, leafHash(award))).toBe(0);
  });

  it("produces valid proofs that re-derive the root (sorted-pair convention)", () => {
    const ws = Array.from({ length: 5 }, (_, i) => new PublicKey(Buffer.alloc(32, i + 1)).toBase58());
    const awards = ws.map((w, i) => A(i, w, BigInt((i + 1) * 1e8)));
    const { root, proofs } = buildTree(awards);
    // re-derive root from each leaf + proof exactly as the on-chain program does
    const kc = (b: Buffer) => Buffer.from(require("js-sha3").keccak_256.arrayBuffer(b));
    awards.forEach((a, i) => {
      let node = leafHash(a);
      for (const sib of proofs[i]) {
        const [lo, hi] = Buffer.compare(node, sib) <= 0 ? [node, sib] : [sib, node];
        node = kc(Buffer.concat([lo, hi]));
      }
      expect(Buffer.compare(node, root)).toBe(0);
    });
  });

  it("matches the on-chain helper's root for a fixed vector (cross-compat lock)", () => {
    // EXPECTED is generated once from solana/distributor/tests/merkle.ts on the
    // same awards (index i, claimant = 32-byte buffer filled with i+1, amount=(i+1)*1e8, 3 leaves).
    // Implementer: produce this hex with the anchor helper and paste it here.
    const ws = Array.from({ length: 3 }, (_, i) => new PublicKey(Buffer.alloc(32, i + 1)).toBase58());
    const awards = ws.map((w, i) => A(i, w, BigInt((i + 1) * 1e8)));
    const { root } = buildTree(awards);
    const EXPECTED = "<<PASTE_HEX_FROM_ANCHOR_HELPER>>";
    expect(root.toString("hex")).toBe(EXPECTED);
  });
});
```

- [ ] **Step 2: Run & verify fail** — Run: `npm test`. Expected: FAIL, `buildTree`/`leafHash` missing.

- [ ] **Step 3: Implement** — `src/merkle.ts` (port of `solana/distributor/tests/merkle.ts`, keyed on base58 wallet)
```ts
import { keccak_256 } from "js-sha3";
import { PublicKey } from "@solana/web3.js";
import type { Award } from "./types";

const kc = (b: Buffer): Buffer => Buffer.from(keccak_256.arrayBuffer(b));
const u64le = (n: bigint): Buffer => {
  const b = Buffer.alloc(8);
  b.writeBigUInt64LE(n);
  return b;
};
const u64leNum = (n: number): Buffer => u64le(BigInt(n));

export function leafHash(a: Award): Buffer {
  return kc(Buffer.concat([u64leNum(a.index), new PublicKey(a.wallet).toBuffer(), u64le(a.amount)]));
}

function parent(a: Buffer, b: Buffer): Buffer {
  const [lo, hi] = Buffer.compare(a, b) <= 0 ? [a, b] : [b, a];
  return kc(Buffer.concat([lo, hi]));
}

export function buildTree(awards: Award[]): { root: Buffer; proofs: Buffer[][] } {
  if (awards.length === 0) throw new Error("empty award set");
  let layer = awards.map(leafHash);
  const layers: Buffer[][] = [layer];
  while (layer.length > 1) {
    const next: Buffer[] = [];
    for (let i = 0; i < layer.length; i += 2) {
      next.push(i + 1 < layer.length ? parent(layer[i], layer[i + 1]) : layer[i]);
    }
    layer = next;
    layers.push(layer);
  }
  const proofs = awards.map((_, idx) => {
    const proof: Buffer[] = [];
    let i = idx;
    for (let l = 0; l < layers.length - 1; l++) {
      const sib = i % 2 === 0 ? i + 1 : i - 1;
      if (sib < layers[l].length) proof.push(layers[l][sib]);
      i = Math.floor(i / 2);
    }
    return proof;
  });
  return { root: layers[layers.length - 1][0], proofs };
}
```

- [ ] **Step 4: Generate the cross-compat vector and paste it**

Run (from the anchor workspace, reuse its helper) to print the expected root:
```bash
cd ~/Desktop/webxash3d-fwgs/solana/distributor
cat > /tmp/vec.ts <<'EOF'
import { PublicKey } from "@solana/web3.js";
import BN from "bn.js";
import { buildTree } from "./tests/merkle";
const awards = [0,1,2].map(i => ({ index: i, claimant: new PublicKey(Buffer.alloc(32, i+1)), amount: new BN((i+1)*1e8) }));
console.log(buildTree(awards).root.toString("hex"));
EOF
npx ts-node /tmp/vec.ts 2>/dev/null || npx ts-mocha -p ./tsconfig.json /tmp/vec.ts
```
Paste the printed hex into `EXPECTED` in `src/merkle.test.ts`. (If neither runner prints cleanly, wrap the snippet in a throwaway `it()` that `console.log`s inside `tests/` and run `anchor test`.)

- [ ] **Step 5: Run & verify pass** — Run: `npm test`. Expected: all 3 merkle tests PASS, including the fixed-vector cross-compat lock.

- [ ] **Step 6: Commit**
```bash
git add services/reward-backend/src/merkle.ts services/reward-backend/src/merkle.test.ts
git commit -m "feat(reward-backend): on-chain-compatible merkle builder with cross-compat lock"
```

---

### Task 5: Hourly leaderboard points engine

**Files:** Create `src/leaderboard.ts`, `src/leaderboard.test.ts`

Points per match for a player: `100*(won?1:0) + 10*kills - 2*deaths + 5*headshots`, floored at 0 per match. Hourly total = sum over the player's matches in the hour. Players with fewer than `minMatches` are excluded from ranking. Ties broken by fewer matches played (efficiency), then by wallet string ascending for determinism.

- [ ] **Step 1: Write the failing test** — `src/leaderboard.test.ts`
```ts
import { describe, it, expect } from "vitest";
import { rankHour } from "./leaderboard";
import type { MatchResult } from "./types";

const mk = (matchId: string, endedAtMs: number, rows: any[]): MatchResult => ({
  matchId, endedAtMs,
  players: rows.map((r) => ({
    wallet: r.w, team: "A", won: r.won, kills: r.k ?? 0, deaths: r.d ?? 0,
    headshots: r.hs ?? 0, shotsFired: 100, shotsHit: 50, avgReactionMs: 300,
  })),
});

describe("rankHour", () => {
  it("sums match points and ranks descending", () => {
    const matches: MatchResult[] = [
      mk("m1", 0, [{ w: "A", won: true, k: 10, d: 2, hs: 4 }, { w: "B", won: false, k: 5, d: 8 }]),
      mk("m2", 1000, [{ w: "A", won: false, k: 3, d: 5 }, { w: "B", won: true, k: 9, d: 3, hs: 2 }]),
    ];
    // A: (100+100-4+20)=216 + (0+30-10)=20 => 236 ; B: (0+50-16)=34 + (100+90-6+10)=194 => 228
    const board = rankHour(matches, { minMatches: 1 });
    expect(board[0]).toMatchObject({ wallet: "A", rank: 1, points: 236, matches: 2 });
    expect(board[1]).toMatchObject({ wallet: "B", rank: 2, points: 228, matches: 2 });
  });

  it("excludes players below minMatches", () => {
    const matches: MatchResult[] = [ mk("m1", 0, [{ w: "A", won: true, k: 1 }, { w: "B", won: false }]) ];
    const board = rankHour(matches, { minMatches: 2 });
    expect(board).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run & verify fail** — Run: `npm test`. Expected: FAIL, `rankHour` missing.

- [ ] **Step 3: Implement** — `src/leaderboard.ts`
```ts
import type { MatchResult, RankedEntry } from "./types";

export interface RankOptions { minMatches: number; }

export function matchPoints(p: { won: boolean; kills: number; deaths: number; headshots: number }): number {
  return Math.max(0, 100 * (p.won ? 1 : 0) + 10 * p.kills - 2 * p.deaths + 5 * p.headshots);
}

export function rankHour(matches: MatchResult[], opts: RankOptions): RankedEntry[] {
  const points = new Map<string, number>();
  const counts = new Map<string, number>();
  for (const m of matches) {
    for (const p of m.players) {
      points.set(p.wallet, (points.get(p.wallet) ?? 0) + matchPoints(p));
      counts.set(p.wallet, (counts.get(p.wallet) ?? 0) + 1);
    }
  }
  const rows = [...points.entries()]
    .filter(([w]) => (counts.get(w) ?? 0) >= opts.minMatches)
    .map(([wallet, pts]) => ({ wallet, points: pts, matches: counts.get(wallet)! }))
    .sort((a, b) => b.points - a.points || a.matches - b.matches || a.wallet.localeCompare(b.wallet));
  return rows.map((r, i) => ({ ...r, rank: i + 1 }));
}
```

- [ ] **Step 4: Run & verify pass** — Run: `npm test`. Expected: leaderboard tests PASS.

- [ ] **Step 5: Commit**
```bash
git add services/reward-backend/src/leaderboard.ts services/reward-backend/src/leaderboard.test.ts
git commit -m "feat(reward-backend): hourly points leaderboard engine"
```

---

### Task 6: Solvency-capped top-10 payout split

**Files:** Create `src/payout.ts`, `src/payout.test.ts`

Pool = `floor(vaultLamports * budgetBps / 10000)`. Split across the top `min(10, board.length)` by integer weights `[30,18,12,9,7,5,5,5,5,4]` (sum 100): `amount_i = floor(pool * w_i / 100)`; assign any rounding remainder to rank 1 so the sum equals `pool` exactly. Returns `Award[]` with sequential `index` and the winners' wallets. The sum of amounts is the `total_amount` passed to `publish_period` and is ≤ pool ≤ vault balance (solvency).

- [ ] **Step 1: Write the failing test** — `src/payout.test.ts`
```ts
import { describe, it, expect } from "vitest";
import { computeAwards, WEIGHTS } from "./payout";
import type { RankedEntry } from "./types";

const board = (n: number): RankedEntry[] =>
  Array.from({ length: n }, (_, i) => ({ wallet: `w${i}`, points: 1000 - i, matches: 5, rank: i + 1 }));

describe("computeAwards", () => {
  it("splits a 10% pool across top 10 by weight, remainder to rank 1, sum == pool", () => {
    const vault = 1_000_000_000n; // 1 SOL
    const { awards, pool } = computeAwards(board(12), { vaultLamports: vault, budgetBps: 1000 });
    expect(pool).toBe(100_000_000n); // 0.1 SOL
    expect(awards).toHaveLength(10);
    expect(awards[0].index).toBe(0);
    const sum = awards.reduce((s, a) => s + a.amount, 0n);
    expect(sum).toBe(pool); // exact, no leakage
    // weight ordering: rank1 (incl remainder) >= rank2 >= ... rank10
    for (let i = 1; i < awards.length; i++) expect(awards[i - 1].amount >= awards[i].amount).toBe(true);
  });

  it("pays fewer than 10 when the board is short and never exceeds pool", () => {
    const { awards, pool } = computeAwards(board(3), { vaultLamports: 500_000_000n, budgetBps: 2000 });
    expect(awards).toHaveLength(3);
    const sum = awards.reduce((s, a) => s + a.amount, 0n);
    expect(sum <= pool).toBe(true);
  });

  it("returns no awards for an empty board", () => {
    const { awards } = computeAwards([], { vaultLamports: 1_000_000_000n, budgetBps: 1000 });
    expect(awards).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run & verify fail** — Run: `npm test`. Expected: FAIL, `computeAwards` missing.

- [ ] **Step 3: Implement** — `src/payout.ts`
```ts
import type { RankedEntry, Award } from "./types";

export const WEIGHTS = [30, 18, 12, 9, 7, 5, 5, 5, 5, 4]; // sum = 100

export interface PayoutConfig { vaultLamports: bigint; budgetBps: number; } // budgetBps: 1000 = 10%

export function computeAwards(
  board: RankedEntry[],
  cfg: PayoutConfig
): { awards: Award[]; pool: bigint } {
  const pool = (cfg.vaultLamports * BigInt(cfg.budgetBps)) / 10_000n;
  const n = Math.min(WEIGHTS.length, board.length);
  if (n === 0) return { awards: [], pool };
  const weightSum = WEIGHTS.slice(0, n).reduce((s, w) => s + w, 0);
  const amounts: bigint[] = [];
  for (let i = 0; i < n; i++) amounts.push((pool * BigInt(WEIGHTS[i])) / BigInt(weightSum));
  // assign remainder to rank 1 so the full split equals `pool` (when board has >=10) ...
  const distributed = amounts.reduce((s, a) => s + a, 0n);
  const target = n === WEIGHTS.length ? pool : distributed; // short board: don't inflate beyond weighted share
  amounts[0] += target - distributed;
  const awards: Award[] = board.slice(0, n).map((e, i) => ({ index: i, wallet: e.wallet, amount: amounts[i] }));
  return { awards, pool };
}
```

- [ ] **Step 4: Run & verify pass** — Run: `npm test`. Expected: payout tests PASS.

- [ ] **Step 5: Commit**
```bash
git add services/reward-backend/src/payout.ts services/reward-backend/src/payout.test.ts
git commit -m "feat(reward-backend): solvency-capped top-10 payout split"
```

---

### Task 7: Tier-1 anti-cheat heuristics

**Files:** Create `src/anticheat.ts`, `src/anticheat.test.ts`

Flags a player's match stats as suspicious if ANY: accuracy `shotsHit/shotsFired > 0.95`; headshot ratio `headshots/kills > 0.9` with `kills >= 5`; `avgReactionMs < 80`; `kills > 60`. Returns `{ suspicious, reasons[] }`. Pure; the verification buffer + KYC gating that consume this live in a later plan.

- [ ] **Step 1: Write the failing test** — `src/anticheat.test.ts`
```ts
import { describe, it, expect } from "vitest";
import { screenPlayer } from "./anticheat";
import type { MatchPlayer } from "./types";

const base: MatchPlayer = {
  wallet: "w", team: "A", won: true, kills: 20, deaths: 10,
  headshots: 5, shotsFired: 200, shotsHit: 80, avgReactionMs: 300,
};

describe("screenPlayer", () => {
  it("passes a normal stat line", () => {
    expect(screenPlayer(base).suspicious).toBe(false);
  });
  it("flags impossible accuracy", () => {
    const r = screenPlayer({ ...base, shotsFired: 100, shotsHit: 99 });
    expect(r.suspicious).toBe(true);
    expect(r.reasons).toContain("accuracy");
  });
  it("flags inhuman reaction time", () => {
    expect(screenPlayer({ ...base, avgReactionMs: 40 }).reasons).toContain("reaction");
  });
  it("flags headshot-only kills", () => {
    expect(screenPlayer({ ...base, kills: 10, headshots: 10 }).reasons).toContain("headshot_ratio");
  });
});
```

- [ ] **Step 2: Run & verify fail** — Run: `npm test`. Expected: FAIL, `screenPlayer` missing.

- [ ] **Step 3: Implement** — `src/anticheat.ts`
```ts
import type { MatchPlayer } from "./types";

export interface Screen { suspicious: boolean; reasons: string[]; }

export function screenPlayer(p: MatchPlayer): Screen {
  const reasons: string[] = [];
  if (p.shotsFired > 0 && p.shotsHit / p.shotsFired > 0.95) reasons.push("accuracy");
  if (p.kills >= 5 && p.headshots / p.kills > 0.9) reasons.push("headshot_ratio");
  if (p.avgReactionMs < 80) reasons.push("reaction");
  if (p.kills > 60) reasons.push("kills");
  return { suspicious: reasons.length > 0, reasons };
}
```

- [ ] **Step 4: Run & verify pass** — Run: `npm test`. Expected: anti-cheat tests PASS.

- [ ] **Step 5: Commit**
```bash
git add services/reward-backend/src/anticheat.ts services/reward-backend/src/anticheat.test.ts
git commit -m "feat(reward-backend): tier-1 anti-cheat heuristics"
```

---

### Task 8: Hold-eligibility (token balance) read

**Files:** Create `src/eligibility.ts`, `src/eligibility.test.ts`

`isHoldEligible(reader, wallet, mint, minTokens)` returns true iff the wallet's SPL balance of `mint` (in whole tokens, using the mint's decimals) is `>= minTokens`. The chain reader is an injected interface so tests need no network; production wires it to `@solana/web3.js` `Connection.getParsedTokenAccountsByOwner`. Fail closed: any reader error → ineligible.

- [ ] **Step 1: Write the failing test** — `src/eligibility.test.ts`
```ts
import { describe, it, expect } from "vitest";
import { isHoldEligible, type BalanceReader } from "./eligibility";

const reader = (uiAmount: number | null): BalanceReader => ({
  async uiBalance() { if (uiAmount === null) throw new Error("rpc down"); return uiAmount; },
});

describe("isHoldEligible", () => {
  it("true when balance >= min", async () => {
    expect(await isHoldEligible(reader(1500), "w", "mint", 1000)).toBe(true);
  });
  it("false when balance below min", async () => {
    expect(await isHoldEligible(reader(999), "w", "mint", 1000)).toBe(false);
  });
  it("fails closed on reader error", async () => {
    expect(await isHoldEligible(reader(null), "w", "mint", 1000)).toBe(false);
  });
});
```

- [ ] **Step 2: Run & verify fail** — Run: `npm test`. Expected: FAIL, `isHoldEligible` missing.

- [ ] **Step 3: Implement** — `src/eligibility.ts`
```ts
export interface BalanceReader {
  // returns the wallet's UI (decimal-adjusted) balance of the mint
  uiBalance(wallet: string, mint: string): Promise<number>;
}

export async function isHoldEligible(
  reader: BalanceReader,
  wallet: string,
  mint: string,
  minTokens: number
): Promise<boolean> {
  try {
    const bal = await reader.uiBalance(wallet, mint);
    return bal >= minTokens;
  } catch {
    return false; // fail closed
  }
}

// Production adapter (not unit-tested; needs a live RPC). Wire in the API layer (later plan).
import type { Connection } from "@solana/web3.js";
import { PublicKey } from "@solana/web3.js";
export function rpcBalanceReader(connection: Connection): BalanceReader {
  return {
    async uiBalance(wallet: string, mint: string): Promise<number> {
      const res = await connection.getParsedTokenAccountsByOwner(new PublicKey(wallet), {
        mint: new PublicKey(mint),
      });
      let total = 0;
      for (const { account } of res.value) {
        total += (account.data as any).parsed.info.tokenAmount.uiAmount ?? 0;
      }
      return total;
    },
  };
}
```

- [ ] **Step 4: Run & verify pass** — Run: `npm test`. Expected: eligibility tests PASS.

- [ ] **Step 5: Commit**
```bash
git add services/reward-backend/src/eligibility.ts services/reward-backend/src/eligibility.test.ts
git commit -m "feat(reward-backend): hold-eligibility balance read (injected reader, fail-closed)"
```

---

### Task 9: Settlement pipeline wiring + README

**Files:** Create `src/settle.ts`, `src/settle.test.ts`, `services/reward-backend/README.md`

`settleHour(matches, ctx)` ties the modules together: rank → screen each ranked winner's best/worst stats → drop suspicious or hold-ineligible wallets → take top 10 → split pool → build Merkle root. Returns `{ periodId, root, totalAmount, awards, proofsByWallet }` ready for the (later) on-chain publisher. Eligibility/screen predicates are injected so the test stays pure.

- [ ] **Step 1: Write the failing test** — `src/settle.test.ts`
```ts
import { describe, it, expect } from "vitest";
import { settleHour } from "./settle";
import type { MatchResult } from "./types";
import { PublicKey } from "@solana/web3.js";

const W = (i: number) => new PublicKey(Buffer.alloc(32, i + 1)).toBase58();
const match = (id: string, end: number, winners: number[], losers: number[]): MatchResult => ({
  matchId: id, endedAtMs: end,
  players: [
    ...winners.map((i) => ({ wallet: W(i), team: "A" as const, won: true, kills: 15, deaths: 5, headshots: 3, shotsFired: 150, shotsHit: 60, avgReactionMs: 250 })),
    ...losers.map((i) => ({ wallet: W(i), team: "B" as const, won: false, kills: 6, deaths: 12, headshots: 1, shotsFired: 150, shotsHit: 55, avgReactionMs: 280 })),
  ],
});

describe("settleHour", () => {
  it("ranks, gates, splits, and builds a coherent root", async () => {
    const matches = [match("m1", 0, [0, 1, 2, 3, 4], [5, 6, 7, 8, 9])];
    const out = await settleHour(matches, {
      vaultLamports: 1_000_000_000n,
      budgetBps: 1000,
      minMatches: 1,
      isEligible: async () => true,
    });
    expect(out.awards.length).toBeGreaterThan(0);
    expect(out.awards.length).toBeLessThanOrEqual(10);
    const sum = out.awards.reduce((s, a) => s + a.amount, 0n);
    expect(sum).toBe(out.totalAmount);
    // every award has a proof
    for (const a of out.awards) expect(out.proofsByWallet[a.wallet]).toBeDefined();
  });

  it("drops hold-ineligible winners before paying", async () => {
    const matches = [match("m1", 0, [0, 1, 2, 3, 4], [5, 6, 7, 8, 9])];
    const out = await settleHour(matches, {
      vaultLamports: 1_000_000_000n, budgetBps: 1000, minMatches: 1,
      isEligible: async (w) => w !== W(0), // top winner ineligible
    });
    expect(out.awards.find((a) => a.wallet === W(0))).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run & verify fail** — Run: `npm test`. Expected: FAIL, `settleHour` missing.

- [ ] **Step 3: Implement** — `src/settle.ts`
```ts
import type { MatchResult, Award } from "./types";
import { rankHour } from "./leaderboard";
import { computeAwards } from "./payout";
import { screenPlayer } from "./anticheat";
import { buildTree } from "./merkle";

export interface SettleCtx {
  vaultLamports: bigint;
  budgetBps: number;
  minMatches: number;
  isEligible: (wallet: string) => Promise<boolean>;
  periodId?: number;
}

export interface Settlement {
  periodId: number;
  root: Buffer;
  totalAmount: bigint;
  awards: Award[];
  proofsByWallet: Record<string, Buffer[]>;
}

export async function settleHour(matches: MatchResult[], ctx: SettleCtx): Promise<Settlement> {
  // flag wallets that were suspicious in ANY match this hour
  const flagged = new Set<string>();
  for (const m of matches) for (const p of m.players) if (screenPlayer(p).suspicious) flagged.add(p.wallet);

  const board = rankHour(matches, { minMatches: ctx.minMatches }).filter((e) => !flagged.has(e.wallet));

  // hold-eligibility gate (sequential keeps the injected predicate simple/deterministic)
  const eligible = [];
  for (const e of board) if (await ctx.isEligible(e.wallet)) eligible.push(e);

  const reindexed = eligible.slice(0, 10).map((e, i) => ({ ...e, rank: i + 1 }));
  const { awards } = computeAwards(reindexed, { vaultLamports: ctx.vaultLamports, budgetBps: ctx.budgetBps });

  const proofsByWallet: Record<string, Buffer[]> = {};
  let root = Buffer.alloc(32);
  let totalAmount = 0n;
  if (awards.length > 0) {
    const tree = buildTree(awards);
    root = tree.root;
    awards.forEach((a, i) => (proofsByWallet[a.wallet] = tree.proofs[i]));
    totalAmount = awards.reduce((s, a) => s + a.amount, 0n);
  }
  return { periodId: ctx.periodId ?? 0, root, totalAmount, awards, proofsByWallet };
}
```

- [ ] **Step 4: Run & verify pass** — Run: `npm test`. Expected: ALL tests across the package PASS.

- [ ] **Step 5: Write `services/reward-backend/README.md`**
```markdown
# reward-backend

Pure settlement domain logic for the hourly leaderboard payouts (Phase 0, Plan 2).

## Test
    npm install
    npm test

## Modules
- `period` UTC hour bucketing (period_id)
- `merkle` keccak Merkle tree — byte-identical to `solana/distributor`
- `leaderboard` hourly points engine
- `payout` solvency-capped top-10 split
- `anticheat` tier-1 heuristics
- `eligibility` hold-≥N token balance (injected reader, fail-closed)
- `settle` pipeline: rank → screen → gate → split → root

## Deferred (later plans)
On-chain publisher (calls `publish_period` as the oracle), HTTP API (ingest results, serve proofs),
MMR matchmaking, KYC gating, the N+1-hour verification buffer.
```

- [ ] **Step 6: Commit**
```bash
git add services/reward-backend/src/settle.ts services/reward-backend/src/settle.test.ts services/reward-backend/README.md
git commit -m "feat(reward-backend): settlement pipeline (rank->screen->gate->split->root) + README"
```

---

## Self-Review

**Spec coverage (this plan = spec §6 leaderboard/points + §6 solvency split + §7 anti-cheat + §5 hold-eligibility + §6 Merkle settlement input):**
- §6 "hourly points metric" → Task 5 `rankHour`/`matchPoints`. ✅
- §6 "budgeted % of actual vault, top 10, never over-draw" → Task 6 `computeAwards` (pool = bps×balance, sum ≤ pool). ✅
- §7 "tier-1 heuristics" → Task 7 `screenPlayer`. ✅
- §5 "hold ≥1000 eligibility, fail closed" → Task 8 `isHoldEligible`. ✅
- §6 "Merkle root the program consumes" → Task 4 `buildTree` + cross-compat lock; consumed in Task 9. ✅
- §6 settlement flow → Task 9 `settleHour`. ✅
- Deferred (correctly out of scope, noted in README): on-chain publisher, HTTP API, MMR matchmaking (own plan), KYC gating, N+1 verification buffer.

**Placeholder scan:** one intentional, explicitly-instructed placeholder — `EXPECTED = "<<PASTE_HEX_FROM_ANCHOR_HELPER>>"` in Task 4 Step 1, resolved by Task 4 Step 4 (generate the hex from the anchor helper). Not a silent TODO.

**Type consistency:** `Award{index,wallet,amount:bigint}`, `RankedEntry{wallet,points,matches,rank}`, `MatchPlayer`/`MatchResult` as defined in Task 2 and used identically in Tasks 5/6/7/9. `buildTree` signature matches between `merkle.ts` and `settle.ts`/tests. Amounts are `bigint` lamports throughout; `computeAwards` and `settleHour` both sum to `bigint`. Merkle byte-layout matches the on-chain `claim` (u64 LE index, 32-byte key, u64 LE amount, sorted parent).

**Known follow-ups (not blockers):** on-chain publisher integration test against localnet belongs to the integration plan once the Go server/client stubs exist; the leaderboard/payout constants (weights, points formula, budgetBps, minMatches) are tunable per spec §14.
