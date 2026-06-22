# webxash3d Solana — Phase 0 / Plan 6: Web Client

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. For the visual layer, ALSO use the frontend-design skill. Steps use checkbox (`- [ ]`) syntax.

**Goal:** The player-facing web app: Privy login (email or wallet), a hold-eligibility badge, the live hourly leaderboard + prize pool (from the real local API), a claim button (builds the on-chain `claim` tx from `/claim` data), and the playable WASM CS 1.6 panel (reusing the existing `Xash3DWebRTC` embed).

**Architecture:** A Vite + React + TS app at `apps/web`. Framework-agnostic, fully unit-tested logic in `src/lib` (the REST client + claim-tx builder). React UI in `src/components` built with the frontend-design skill. A `VITE_DEV_BYPASS` flag renders the main screen without a real Privy app id so the UI is viewable/screenshot-able during development. Talks to the Plan 5 API at `VITE_API_BASE` (default `http://localhost:8787`) — no domain needed.

**Tech Stack:** Vite, React 19, TypeScript, `@privy-io/react-auth`, `@solana/web3.js`, `@coral-xyz/anchor`, `vitest`. Reuses `xash3d-fwgs` + `cs16-client` for the game.

**Prereqs:** Plan 5 API exists (`services/reward-backend`). Distributor IDL at `solana/distributor/target/idl/distributor.json`.

**Honest scope:** the WASM game needs CS assets (`valve.zip`) + a running server to actually play; this plan integrates the game panel (load/connect UI) but full gameplay is an asset/ops step. Everything else (auth, leaderboard, prize pool, claim) is real against the local API.

---

## File Structure
- Create: `apps/web/` (Vite scaffold): `package.json`, `vite.config.ts`, `tsconfig.json`, `index.html`, `.env.example`
- Create: `apps/web/src/lib/api.ts` + `api.test.ts` — REST client
- Create: `apps/web/src/lib/claim.ts` + `claim.test.ts` — claim-tx builder
- Create: `apps/web/src/idl/distributor.json` (+ `distributor.ts` type) — copied from the program
- Create: `apps/web/src/components/{Providers,AuthGate,EligibilityBadge,Leaderboard,PrizePool,ClaimPanel,GamePanel}.tsx`
- Create: `apps/web/src/App.tsx`, `src/main.tsx`, `src/theme.css`
- Create: `apps/web/README.md`

---

### Task 1: Scaffold the Vite app

- [ ] **Step 1: Scaffold + deps**
```bash
cd ~/Desktop/webxash3d-fwgs
mkdir -p apps && cd apps
npm create vite@latest web -- --template react-ts
cd web
npm install
npm install @privy-io/react-auth @solana/web3.js @coral-xyz/anchor bn.js
npm install -D vitest @types/bn.js
```

- [ ] **Step 2: Add test script** to `apps/web/package.json` scripts: `"test": "vitest run"`.

- [ ] **Step 3: Verify build + dev** — `npm run build` (tsc+vite) succeeds.

- [ ] **Step 4: Commit**
```bash
cd ~/Desktop/webxash3d-fwgs
printf '%s\n' "node_modules/" "dist/" ".env" > apps/web/.gitignore
git add apps/web/package.json apps/web/package-lock.json apps/web/vite.config.ts apps/web/tsconfig*.json apps/web/index.html apps/web/.gitignore apps/web/src apps/web/public
git commit -m "chore(web): scaffold vite react-ts app"
```

---

### Task 2: Copy the distributor IDL

- [ ] **Step 1: Copy IDL + types**
```bash
mkdir -p ~/Desktop/webxash3d-fwgs/apps/web/src/idl
cp ~/Desktop/webxash3d-fwgs/solana/distributor/target/idl/distributor.json ~/Desktop/webxash3d-fwgs/apps/web/src/idl/distributor.json
cp ~/Desktop/webxash3d-fwgs/solana/distributor/target/types/distributor.ts ~/Desktop/webxash3d-fwgs/apps/web/src/idl/distributor.ts
```

- [ ] **Step 2: Commit**
```bash
git add apps/web/src/idl
git commit -m "chore(web): vendor distributor IDL + types"
```

---

### Task 3: REST API client (TDD)

- [ ] **Step 1: Write the failing test** — `apps/web/src/lib/api.test.ts`
```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { RewardApi } from "./api";

const json = (data: unknown, status = 200) =>
  Promise.resolve({ ok: status < 300, status, json: () => Promise.resolve(data) } as Response);

describe("RewardApi", () => {
  beforeEach(() => { vi.restoreAllMocks(); });

  it("fetches the leaderboard for an hour", async () => {
    const fetchMock = vi.fn().mockReturnValue(json([{ wallet: "W", points: 10, matches: 1, rank: 1 }]));
    vi.stubGlobal("fetch", fetchMock);
    const api = new RewardApi("http://localhost:8787");
    const board = await api.leaderboard(100);
    expect(fetchMock).toHaveBeenCalledWith("http://localhost:8787/leaderboard/100");
    expect(board[0].wallet).toBe("W");
  });

  it("returns null claim for a non-winner (404)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockReturnValue(json({ error: "not a winner" }, 404)));
    const api = new RewardApi("http://localhost:8787");
    expect(await api.claim(100, "W")).toBeNull();
  });

  it("returns claim args for a winner", async () => {
    vi.stubGlobal("fetch", vi.fn().mockReturnValue(json({ periodId: 100, index: 0, amount: "500000000", proof: ["aa"] })));
    const api = new RewardApi("http://localhost:8787");
    const claim = await api.claim(100, "W");
    expect(claim?.amount).toBe("500000000");
  });
});
```

- [ ] **Step 2: Run & verify fail** — `npm test`. Expected: FAIL, `RewardApi` missing.

- [ ] **Step 3: Implement** — `apps/web/src/lib/api.ts`
```ts
export interface RankedEntry { wallet: string; points: number; matches: number; rank: number; }
export interface ClaimData { periodId: number; index: number; amount: string; proof: string[]; }

export class RewardApi {
  constructor(private base: string) {}

  async leaderboard(hour: number): Promise<RankedEntry[]> {
    const res = await fetch(`${this.base}/leaderboard/${hour}`);
    if (!res.ok) return [];
    return (await res.json()) as RankedEntry[];
  }

  async claim(hour: number, wallet: string): Promise<ClaimData | null> {
    const res = await fetch(`${this.base}/claim/${hour}/${wallet}`);
    if (!res.ok) return null;
    return (await res.json()) as ClaimData;
  }
}
```

- [ ] **Step 4: Run & verify pass** — `npm test`. Expected: api tests PASS.

- [ ] **Step 5: Commit**
```bash
git add apps/web/src/lib/api.ts apps/web/src/lib/api.test.ts
git commit -m "feat(web): reward API client"
```

---

### Task 4: Claim-tx builder (TDD with a mock program)

Converts `/claim` data into a call on the distributor program. Uses a minimal structural program type so it's unit-testable without a chain.

- [ ] **Step 1: Write the failing test** — `apps/web/src/lib/claim.test.ts`
```ts
import { describe, it, expect } from "vitest";
import BN from "bn.js";
import { submitClaim } from "./claim";
import type { ClaimData } from "./api";

describe("submitClaim", () => {
  it("calls claim with periodId/index/amount BN and proof byte arrays", async () => {
    const calls: any = {};
    const program = { methods: { claim(periodId: BN, index: BN, amount: BN, proof: number[][]) {
      calls.args = { periodId, index, amount, proof };
      return { accounts(a: any) { calls.accounts = a; return { rpc: async () => "sig" }; } };
    } } };
    const data: ClaimData = { periodId: 100, index: 2, amount: "500000000", proof: ["aabb", "ccdd"] };
    const sig = await submitClaim(program as any, "ClaimantPubkey", data);
    expect(sig).toBe("sig");
    expect(calls.args.periodId.toNumber()).toBe(100);
    expect(calls.args.index.toNumber()).toBe(2);
    expect(calls.args.amount.toString()).toBe("500000000");
    expect(calls.args.proof[0]).toEqual([0xaa, 0xbb]);
    expect(calls.accounts.claimant).toBe("ClaimantPubkey");
  });
});
```

- [ ] **Step 2: Run & verify fail** — `npm test`. Expected: FAIL, `submitClaim` missing.

- [ ] **Step 3: Implement** — `apps/web/src/lib/claim.ts`
```ts
import BN from "bn.js";
import type { ClaimData } from "./api";

export interface ClaimProgram {
  methods: {
    claim(periodId: BN, index: BN, amount: BN, proof: number[][]): {
      accounts(a: { claimant: unknown }): { rpc(): Promise<string> };
    };
  };
}

const hexToBytes = (h: string): number[] => {
  const out: number[] = [];
  for (let i = 0; i < h.length; i += 2) out.push(parseInt(h.slice(i, i + 2), 16));
  return out;
};

export async function submitClaim(program: ClaimProgram, claimant: unknown, data: ClaimData): Promise<string> {
  return program.methods
    .claim(new BN(data.periodId), new BN(data.index), new BN(data.amount), data.proof.map(hexToBytes))
    .accounts({ claimant })
    .rpc();
}
```

- [ ] **Step 4: Run & verify pass** — `npm test`. Expected: ALL web tests PASS.

- [ ] **Step 5: Commit**
```bash
git add apps/web/src/lib/claim.ts apps/web/src/lib/claim.test.ts
git commit -m "feat(web): on-chain claim tx builder"
```

---

### Task 5: UI (use the frontend-design skill)

**Invoke the frontend-design skill** for this task. Build a distinctive, polished dark **esports × degen-crypto** aesthetic — the live leaderboard is the hero, with a prominent prize-pool number and an hourly countdown. High contrast, tasteful neon accent, monospace for numbers/wallets. Avoid generic AI-template look.

Components (all in `apps/web/src/components/`):
- `Providers.tsx` — wraps the app in `PrivyProvider` using `import.meta.env.VITE_PRIVY_APP_ID`, configured for Solana embedded wallets + external wallet login. Also provides a Solana `Connection` (`VITE_RPC_URL`, default devnet) and the API base via context.
- `AuthGate.tsx` — if `VITE_DEV_BYPASS === "1"`, render children directly (so the main screen is viewable without a Privy app id). Otherwise show a clean login screen (email + connect wallet) until authenticated; then render children.
- `EligibilityBadge.tsx` — shows "Eligible ✓ / Need ≥1000 $TOKEN" based on the connected wallet's balance (use a stub/`VITE_DEV_BYPASS` → eligible for now; real balance read is wired later).
- `PrizePool.tsx` — big prize-pool figure + hourly countdown to the next settlement (top of the UTC hour).
- `Leaderboard.tsx` — polls `RewardApi.leaderboard(currentUtcHour)` every ~10s; ranked table (rank, wallet short, points, matches); highlights the connected wallet's row.
- `ClaimPanel.tsx` — for the previous (settled) hour, calls `RewardApi.claim(hour, wallet)`; if a winner, shows the amount + a "Claim" button that calls `submitClaim` with an anchor `Program` built from `src/idl/distributor.json` and the Privy wallet; shows tx state.
- `GamePanel.tsx` — port the `Xash3DWebRTC` start-button + canvas from `examples/react-typescript-cs16-webrtc/src/App.tsx` + `webrtc.ts`; show a "Connecting…/assets required" state if it can't load. Gameplay needs assets/server (documented).

- [ ] **Step 1:** Implement `theme.css` + the components above + assemble in `App.tsx` (layout: top bar with auth + eligibility; hero with PrizePool + countdown; main grid: Leaderboard | GamePanel; ClaimPanel for last hour). Wire `main.tsx` to `Providers`.
- [ ] **Step 2:** `npm run build` must succeed (tsc clean). `npm test` still green.
- [ ] **Step 3: Commit**
```bash
git add apps/web/src apps/web/index.html
git commit -m "feat(web): Privy auth, leaderboard, prize pool, claim, game panel (frontend-design)"
```

---

### Task 6: Env + README

- [ ] **Step 1: Create `apps/web/.env.example`**
```
VITE_API_BASE=http://localhost:8787
VITE_PRIVY_APP_ID=your-privy-app-id
VITE_RPC_URL=https://api.devnet.solana.com
VITE_DISTRIBUTOR_PROGRAM_ID=6jSjkNJg2ap9Mxmj6prQ7bEnBQsSWvf6t5p5vWLBzSx4
VITE_DEV_BYPASS=1
```

- [ ] **Step 2: Create `apps/web/README.md`**
```markdown
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
```

- [ ] **Step 3: Commit**
```bash
git add apps/web/.env.example apps/web/README.md
git commit -m "docs(web): env example + README"
```

---

## Self-Review

**Spec coverage (this plan = the player-facing surface of §5 auth/eligibility, §6 leaderboard/claim, the game):**
- §5 Privy auth (email + wallet) + hold-eligibility badge → `Providers`/`AuthGate`/`EligibilityBadge`. ✅
- §6 hourly leaderboard + prize pool + countdown → `Leaderboard`/`PrizePool` (real API). ✅
- §6 winners claim with proof → `ClaimPanel` + `submitClaim` (Task 4, on-chain claim via IDL). ✅
- Game → `GamePanel` (reuses the proven `Xash3DWebRTC` embed). ✅
- No domain dependency — all localhost; `VITE_DEV_BYPASS` makes the UI demoable without external setup. ✅
- Deferred: real hold-balance read in the badge (stubbed now; `rpcBalanceReader` exists in the backend and can move client-side or via an API endpoint); full Privy→anchor signer wiring for `submitClaim` (built against a structural program type; live signer wiring iterated with a real Privy app id); actual gameplay assets/server.

**Placeholder scan:** `.env.example` holds example values (intended). No code placeholders.

**Type consistency:** `RankedEntry`/`ClaimData` in `api.ts` match the API's JSON (`/leaderboard` RankedEntry, `/claim` `{periodId,index,amount(string),proof(hex[])}`). `submitClaim` maps `ClaimData` → the program's `claim(period_id,index,amount,proof:Vec<[u8;32]>)` (BN + number[][] from hex) — matching the distributor IDL. Program id default matches `Anchor.toml`.

**Known follow-ups:** wire Privy's Solana signer into an anchor `AnchorProvider` for real `submitClaim`; replace the stub eligibility with a live balance read; bundle/serve game assets; point `VITE_API_BASE` at a deployed API (free subdomain/tunnel) for non-local demos.
```
