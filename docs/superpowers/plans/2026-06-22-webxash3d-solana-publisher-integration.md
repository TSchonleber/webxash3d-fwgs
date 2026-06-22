# webxash3d Solana — Phase 0 / Plan 3: On-chain Publisher + End-to-End Settlement Integration

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Connect the reward-backend's settlement output (Plan 2) to the deployed distributor program (Plan 1) and prove the entire money loop end-to-end against a real validator: synthetic matches → `settleHour` → `publish_period` (as oracle) → each winner `claim`s real lamports with the backend-produced Merkle proof.

**Architecture:** A small `publisher` module in the backend wraps the Anchor `publishPeriod` call and produces client claim args. A backend fixture generator runs the real `settleHour` (with real keypairs as winners) and writes a JSON fixture into the anchor workspace. An Anchor integration test reads that fixture and drives publish + claim on a local validator — decoupling the ESM backend runtime from the CJS ts-mocha runtime via a JSON artifact, so the test exercises genuine backend output against the genuine program (not a re-implementation).

**Tech Stack:** TypeScript, `@coral-xyz/anchor` 0.31.1, `bn.js`; Anchor localnet (`anchor test`); vitest for the publisher unit test.

**Prereqs:** Plan 1 (`solana/distributor`, green) and Plan 2 (`services/reward-backend`, green) complete. Repo root `/Users/r4vager/Desktop/webxash3d-fwgs`, branch `feat/solana-rewards`.

---

## File Structure
- Create: `services/reward-backend/src/publisher.ts` — publish wrapper + client claim args
- Create: `services/reward-backend/src/publisher.test.ts` — unit test with a mock program
- Create: `services/reward-backend/scripts/gen-fixture.ts` — writes the integration fixture
- Modify: `services/reward-backend/package.json` — add `tsx` dev dep + `gen-fixture` script
- Create: `solana/distributor/tests/integration.ts` — reads fixture, publish + claim loop
- Create: `solana/distributor/tests/.gitignore` — ignore the generated fixture

---

### Task 1: Publisher module (publish wrapper + claim args)

**Files:** Create `src/publisher.ts`, `src/publisher.test.ts`

- [ ] **Step 1: Write the failing test** — `services/reward-backend/src/publisher.test.ts`
```ts
import { describe, it, expect } from "vitest";
import BN from "bn.js";
import { publishSettlement, buildClaimArgs } from "./publisher";
import type { Settlement } from "./settle";

const settlement: Settlement = {
  periodId: 42,
  root: Buffer.alloc(32, 7),
  totalAmount: 900_000_000n,
  awards: [
    { index: 0, wallet: "Wa", amount: 500_000_000n },
    { index: 1, wallet: "Wb", amount: 400_000_000n },
  ],
  proofsByWallet: { Wa: [Buffer.alloc(32, 1)], Wb: [Buffer.alloc(32, 2)] },
};

describe("publisher", () => {
  it("calls publishPeriod with periodId BN, root as byte array, total BN, signed by oracle", async () => {
    const calls: any = {};
    const program = {
      methods: {
        publishPeriod(periodId: BN, root: number[], total: BN) {
          calls.periodId = periodId; calls.root = root; calls.total = total;
          return { accounts(a: any) { calls.accounts = a; return { signers(s: any[]) { calls.signers = s; return { rpc: async () => "sig123" }; } }; } };
        },
      },
    };
    const oracle = { publicKey: "ORACLE_PK" };
    const sig = await publishSettlement(program as any, oracle as any, settlement);
    expect(sig).toBe("sig123");
    expect(calls.periodId.toNumber()).toBe(42);
    expect(calls.root).toHaveLength(32);
    expect(calls.root[0]).toBe(7);
    expect(calls.total.toString()).toBe("900000000");
    expect(calls.accounts.oracle).toBe("ORACLE_PK");
    expect(calls.signers[0]).toBe(oracle);
  });

  it("builds claim args for a winner (index, amount, proof as byte arrays)", () => {
    const args = buildClaimArgs(settlement, "Wb");
    expect(args.index.toNumber()).toBe(1);
    expect(args.amount.toString()).toBe("400000000");
    expect(args.proof[0]).toHaveLength(32);
    expect(args.proof[0][0]).toBe(2);
  });

  it("throws for a non-winner", () => {
    expect(() => buildClaimArgs(settlement, "nobody")).toThrow();
  });
});
```

- [ ] **Step 2: Run & verify fail** — `cd services/reward-backend && npm test`. Expected: FAIL, `publisher` missing.

- [ ] **Step 3: Implement** — `services/reward-backend/src/publisher.ts`
```ts
import BN from "bn.js";
import type { Settlement } from "./settle";

// Minimal structural type of the Anchor program method chain we use (keeps this unit-testable).
export interface PublishProgram {
  methods: {
    publishPeriod(periodId: BN, root: number[], total: BN): {
      accounts(a: { oracle: unknown }): {
        signers(s: unknown[]): { rpc(): Promise<string> };
      };
    };
  };
}

export interface OracleSigner { publicKey: unknown; }

export async function publishSettlement(
  program: PublishProgram,
  oracle: OracleSigner,
  s: Settlement
): Promise<string> {
  return program.methods
    .publishPeriod(new BN(s.periodId), [...s.root], new BN(s.totalAmount.toString()))
    .accounts({ oracle: oracle.publicKey })
    .signers([oracle])
    .rpc();
}

export interface ClaimArgs { periodId: BN; index: BN; amount: BN; proof: number[][]; }

export function buildClaimArgs(s: Settlement, wallet: string): ClaimArgs {
  const award = s.awards.find((a) => a.wallet === wallet);
  if (!award) throw new Error(`not a winner: ${wallet}`);
  return {
    periodId: new BN(s.periodId),
    index: new BN(award.index),
    amount: new BN(award.amount.toString()),
    proof: s.proofsByWallet[wallet].map((b) => [...b]),
  };
}
```

- [ ] **Step 4: Run & verify pass** — `npm test`. Expected: publisher tests PASS (and all prior 19 still pass → 22 total).

- [ ] **Step 5: Commit**
```bash
git add services/reward-backend/src/publisher.ts services/reward-backend/src/publisher.test.ts
git commit -m "feat(reward-backend): on-chain publisher wrapper + client claim args"
```

---

### Task 2: Fixture generator

**Files:** Create `scripts/gen-fixture.ts`, modify `package.json`

The generator creates real winner keypairs, builds deterministic synthetic matches where those wallets win, runs the real `settleHour`, and writes a fixture the anchor test can both publish and sign claims with. `vaultLamports: 1 SOL`, `budgetBps: 1000` → pool 0.1 SOL.

- [ ] **Step 1: Add `tsx` + script to `services/reward-backend/package.json`**

Add to `devDependencies`: `"tsx": "^4.16.0"`. Add to `scripts`:
```json
"gen-fixture": "tsx scripts/gen-fixture.ts"
```
Run: `cd services/reward-backend && npm install`

- [ ] **Step 2: Create `services/reward-backend/scripts/gen-fixture.ts`**
```ts
import { Keypair } from "@solana/web3.js";
import { writeFileSync, mkdirSync } from "node:fs";
import { settleHour } from "../src/settle";
import type { MatchResult } from "../src/types";

const OUT = new URL("../../../solana/distributor/tests/settlement.fixture.json", import.meta.url);

async function main() {
  // 10 deterministic winners (seeded) + 10 losers
  const winners = Array.from({ length: 10 }, (_, i) => Keypair.fromSeed(Uint8Array.from({ length: 32 }, () => i + 1)));
  const losers = Array.from({ length: 10 }, (_, i) => Keypair.fromSeed(Uint8Array.from({ length: 32 }, () => i + 100)));

  const matches: MatchResult[] = [{
    matchId: "m1", endedAtMs: 1_000_000,
    players: [
      ...winners.map((k) => ({ wallet: k.publicKey.toBase58(), team: "A" as const, won: true, kills: 18, deaths: 6, headshots: 3, shotsFired: 180, shotsHit: 70, avgReactionMs: 240 })),
      ...losers.map((k) => ({ wallet: k.publicKey.toBase58(), team: "B" as const, won: false, kills: 7, deaths: 14, headshots: 1, shotsFired: 180, shotsHit: 60, avgReactionMs: 270 })),
    ],
  }];

  const s = await settleHour(matches, { vaultLamports: 1_000_000_000n, budgetBps: 1000, minMatches: 1, isEligible: async () => true, periodId: 777 });

  const byWallet = new Map(winners.map((k) => [k.publicKey.toBase58(), k]));
  const fixture = {
    periodId: s.periodId,
    rootHex: s.root.toString("hex"),
    total: s.totalAmount.toString(),
    awards: s.awards.map((a) => ({
      index: a.index,
      wallet: a.wallet,
      amount: a.amount.toString(),
      secretKey: Array.from(byWallet.get(a.wallet)!.secretKey),
      proofHex: s.proofsByWallet[a.wallet].map((b) => b.toString("hex")),
    })),
  };
  mkdirSync(new URL("./", OUT), { recursive: true });
  writeFileSync(OUT, JSON.stringify(fixture, null, 2));
  console.log(`wrote ${fixture.awards.length} awards, total ${fixture.total} lamports -> ${OUT.pathname}`);
}
main();
```

- [ ] **Step 3: Generate the fixture**

Run: `cd services/reward-backend && npm run gen-fixture`
Expected: prints "wrote 10 awards, total 100000000 lamports" and creates `solana/distributor/tests/settlement.fixture.json`.

- [ ] **Step 4: Ignore the generated fixture** — create `solana/distributor/tests/.gitignore`
```
settlement.fixture.json
```

- [ ] **Step 5: Commit**
```bash
git add services/reward-backend/scripts/gen-fixture.ts services/reward-backend/package.json services/reward-backend/package-lock.json solana/distributor/tests/.gitignore
git commit -m "feat(reward-backend): settlement fixture generator for on-chain integration"
```

---

### Task 3: End-to-end Anchor integration test

**Files:** Create `solana/distributor/tests/integration.ts`

Reads the fixture, initializes config+vault if needed, funds the vault, publishes the period as the oracle, then each winner claims with the backend-produced proof. Asserts the vault drops by exactly `total` and each winner is paid.

- [ ] **Step 1: Write the test** — `solana/distributor/tests/integration.ts`
```ts
import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Distributor } from "../target/types/distributor";
import { PublicKey, Keypair } from "@solana/web3.js";
import { assert } from "chai";
import { readFileSync } from "fs";

describe("integration: backend settlement -> on-chain publish+claim", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.Distributor as Program<Distributor>;
  const admin = provider.wallet;

  const configPda = () => PublicKey.findProgramAddressSync([Buffer.from("config")], program.programId)[0];
  const vaultPda = () => PublicKey.findProgramAddressSync([Buffer.from("vault")], program.programId)[0];
  const periodPda = (id: number) => PublicKey.findProgramAddressSync(
    [Buffer.from("period"), new anchor.BN(id).toArrayLike(Buffer, "le", 8)], program.programId)[0];

  it("publishes the backend root and pays every winner the backend amount", async () => {
    const fx = JSON.parse(readFileSync(__dirname + "/settlement.fixture.json", "utf8"));
    const oracle = Keypair.generate();
    await provider.connection.confirmTransaction(await provider.connection.requestAirdrop(oracle.publicKey, 2e9));

    // init config+vault if this is a fresh validator; ignore "already in use"
    try { await program.methods.initialize(oracle.publicKey).accounts({ admin: admin.publicKey }).rpc(); }
    catch { await program.methods.setOracle(oracle.publicKey).accounts({ admin: admin.publicKey }).rpc(); }
    try { await program.methods.initVault().accounts({ admin: admin.publicKey }).rpc(); } catch {}

    await provider.connection.confirmTransaction(await provider.connection.requestAirdrop(vaultPda(), 1e9));

    const root = [...Buffer.from(fx.rootHex, "hex")];
    await program.methods.publishPeriod(new anchor.BN(fx.periodId), root, new anchor.BN(fx.total))
      .accounts({ oracle: oracle.publicKey }).signers([oracle]).rpc();

    const vaultBefore = await provider.connection.getBalance(vaultPda());
    for (const a of fx.awards) {
      const kp = Keypair.fromSecretKey(Uint8Array.from(a.secretKey));
      assert.equal(kp.publicKey.toBase58(), a.wallet, "fixture keypair matches award wallet");
      await provider.connection.confirmTransaction(await provider.connection.requestAirdrop(kp.publicKey, 1e7)); // rent
      const proof = a.proofHex.map((h: string) => [...Buffer.from(h, "hex")]);
      await program.methods.claim(new anchor.BN(fx.periodId), new anchor.BN(a.index), new anchor.BN(a.amount), proof)
        .accounts({ claimant: kp.publicKey }).signers([kp]).rpc();
    }
    const vaultAfter = await provider.connection.getBalance(vaultPda());
    assert.equal(vaultBefore - vaultAfter, Number(fx.total), "vault decreased by exactly the published total");

    const p = await program.account.period.fetch(periodPda(fx.periodId));
    assert.equal(p.claimedAmount.toString(), fx.total);
  });
});
```

- [ ] **Step 2: Ensure fixture exists, then run**

Run:
```bash
cd ~/Desktop/webxash3d-fwgs/services/reward-backend && npm run gen-fixture
cd ~/Desktop/webxash3d-fwgs/solana/distributor && anchor test
```
Expected: the existing 5 tests PASS plus the new integration test PASS — vault decreases by exactly 100000000 lamports, every winner paid, `claimedAmount == total`. This proves the backend's Merkle output verifies against the real on-chain program.

- [ ] **Step 3: Commit**
```bash
git add solana/distributor/tests/integration.ts
git commit -m "test(distributor): end-to-end backend-settlement -> on-chain publish+claim integration"
```

---

## Self-Review

**Spec coverage (this plan = spec §6 end-to-end settlement path, the integration of §4 program + §6 backend):**
- Backend produces root/proofs the program accepts → Task 3 proves it on a real validator (stronger than Plan 2's fixed-vector lock). ✅
- `publish_period` as oracle + `claim` with proof → Tasks 1+3. ✅
- Solvency: published `total` (0.1 SOL) ≤ funded vault (1 SOL) → Task 3 funds accordingly. ✅
- Deferred (correctly): HTTP API to ingest results / serve proofs, the N+1 verification buffer, devnet deploy — later plans.

**Placeholder scan:** none. The fixture JSON is generated (gitignored), not a placeholder.

**Type consistency:** `Settlement{periodId,root:Buffer,totalAmount:bigint,awards,proofsByWallet}` from Plan 2 used unchanged. `publishSettlement` passes `[...root]` (number[]) and `new BN(totalAmount.toString())` — matching the program's `publish_period(period_id: u64, merkle_root: [u8;32], total_amount: u64)`. `buildClaimArgs` proof shape `number[][]` matches the program's `claim(..., proof: Vec<[u8;32]>)`. Fixture `amount`/`total` are decimal lamport strings parsed by `new anchor.BN(...)`. Winner keypairs are seeded so the fixture is deterministic and the secret keys reconstruct the exact award wallets (asserted in-test).

**Known follow-ups:** the publisher's real wiring to a deployed devnet program (with a persisted oracle keypair + config) belongs to the deployment/ops plan; this plan proves correctness on localnet.
