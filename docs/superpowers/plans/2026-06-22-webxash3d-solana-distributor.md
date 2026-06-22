# webxash3d Solana — Phase 0 / Plan 1: On-Chain Merkle Leaderboard Distributor

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An Anchor program that holds a SOL prize vault and pays each hour's top-10 leaderboard winners from an oracle-signed Merkle root, with double-claim protection and an on-chain solvency cap.

**Architecture:** A single `distributor` program. A `Config` PDA stores the admin and the oracle authority pubkey. Each hour the backend (signing as the oracle) calls `publish_period` to store that hour's Merkle root and total payout, which must not exceed the vault's current balance (solvency). Winners call `claim` with a Merkle proof; the program verifies the proof against the stored root, enforces one claim per winner per period, caps cumulative claims at the period total, and moves lamports from the vault PDA to the winner. Native SOL is used for Phase 0 (USDC/SPL is deferred to Phase 1).

**Tech Stack:** Rust, Anchor 0.30.x, `@coral-xyz/anchor` + TypeScript/mocha tests, `keccak256` for the Merkle tree, Solana localnet (`anchor test`).

**Prerequisite (blocking):** local git + build tools require the Xcode license to be accepted once: `sudo xcodebuild -license accept`. Then clone the fork: `gh repo clone TSchonleber/webxash3d-fwgs ~/Desktop/webxash3d-solana/repo` (or set the worktree per the using-git-worktrees skill). All paths below are relative to that repo root.

**Merkle convention (must match the backend in Plan 2):**
- Leaf: `keccak256( index_u64_LE || claimant_pubkey_32 || amount_u64_LE )`
- Parent: `keccak256( sort(a,b).0 || sort(a,b).1 )` (sorted pair, lexicographic by bytes)
- Proof verification recomputes the root from leaf + proof and compares to the stored root.

---

## File Structure

- Create: `solana/distributor/Anchor.toml` — Anchor workspace config
- Create: `solana/distributor/programs/distributor/Cargo.toml` — program crate
- Create: `solana/distributor/programs/distributor/src/lib.rs` — the whole program (single focused file: state, instructions, errors, merkle verify)
- Create: `solana/distributor/tests/distributor.ts` — TS integration tests (one file; the program surface is small)
- Create: `solana/distributor/tests/merkle.ts` — TS Merkle tree helper used by tests (mirrors the on-chain convention)
- Create: `solana/distributor/package.json` — test deps

---

### Task 1: Scaffold the Anchor workspace

**Files:**
- Create: `solana/distributor/` (via `anchor init`)

- [ ] **Step 1: Initialize the Anchor workspace**

Run:
```bash
cd ~/Desktop/webxash3d-solana/repo
mkdir -p solana && cd solana
anchor init distributor --no-git
```
Expected: creates `solana/distributor/` with `Anchor.toml`, `programs/distributor/`, `tests/`.

- [ ] **Step 2: Pin versions and confirm build**

Run:
```bash
cd ~/Desktop/webxash3d-solana/repo/solana/distributor
anchor --version    # expect anchor-cli 0.30.x
solana --version
anchor build
```
Expected: build succeeds; a program keypair is generated under `target/deploy/distributor-keypair.json`.

- [ ] **Step 3: Sync the declared program id**

Run:
```bash
anchor keys sync
anchor build
```
Expected: `declare_id!` in `lib.rs` and `[programs.localnet]` in `Anchor.toml` show the same pubkey.

- [ ] **Step 4: Add test dependencies**

Create `solana/distributor/package.json`:
```json
{
  "name": "distributor-tests",
  "version": "0.0.0",
  "private": true,
  "scripts": { "test": "anchor test" },
  "dependencies": {
    "@coral-xyz/anchor": "^0.30.1"
  },
  "devDependencies": {
    "@types/mocha": "^10.0.6",
    "@types/node": "^20.11.0",
    "chai": "^4.4.1",
    "@types/chai": "^4.3.11",
    "js-sha3": "^0.9.3",
    "ts-mocha": "^10.0.0",
    "typescript": "^5.4.0"
  }
}
```
Run:
```bash
npm install
```
Expected: `node_modules` present, no errors.

- [ ] **Step 5: Commit**

```bash
git add solana/distributor
git commit -m "chore(distributor): scaffold anchor workspace"
```

---

### Task 2: Merkle helper for tests

**Files:**
- Create: `solana/distributor/tests/merkle.ts`

- [ ] **Step 1: Write the helper (mirrors the on-chain convention exactly)**

Create `solana/distributor/tests/merkle.ts`:
```ts
import { keccak_256 } from "js-sha3";
import { PublicKey } from "@solana/web3.js";
import BN from "bn.js";

export interface Award { index: number; claimant: PublicKey; amount: BN; }

const u64le = (n: BN): Buffer => n.toArrayLike(Buffer, "le", 8);
const u64leNum = (n: number): Buffer => new BN(n).toArrayLike(Buffer, "le", 8);
const kc = (b: Buffer): Buffer => Buffer.from(keccak_256.arrayBuffer(b));

export function leafHash(a: Award): Buffer {
  return kc(Buffer.concat([u64leNum(a.index), a.claimant.toBuffer(), u64le(a.amount)]));
}

function parent(a: Buffer, b: Buffer): Buffer {
  const [lo, hi] = Buffer.compare(a, b) <= 0 ? [a, b] : [b, a];
  return kc(Buffer.concat([lo, hi]));
}

export function buildTree(awards: Award[]): { root: Buffer; proofs: Buffer[][] } {
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
  const root = layers[layers.length - 1][0];
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
  return { root, proofs };
}
```

- [ ] **Step 2: Commit**

```bash
git add solana/distributor/tests/merkle.ts
git commit -m "test(distributor): add merkle tree helper matching on-chain convention"
```

> Note: there is no separate unit test for the helper — it is validated end-to-end by the `claim` tests in Task 5 (a wrong helper makes those proofs fail against the on-chain root).

---

### Task 3: `initialize` and `set_oracle`

**Files:**
- Modify: `solana/distributor/programs/distributor/src/lib.rs`
- Test: `solana/distributor/tests/distributor.ts`

- [ ] **Step 1: Write the failing test**

Create `solana/distributor/tests/distributor.ts`:
```ts
import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Distributor } from "../target/types/distributor";
import { PublicKey, Keypair } from "@solana/web3.js";
import { assert } from "chai";

describe("distributor", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.Distributor as Program<Distributor>;
  const admin = provider.wallet;

  const configPda = () =>
    PublicKey.findProgramAddressSync([Buffer.from("config")], program.programId)[0];

  it("initializes config with admin and oracle", async () => {
    const oracle = Keypair.generate();
    await program.methods
      .initialize(oracle.publicKey)
      .accounts({ admin: admin.publicKey })
      .rpc();
    const cfg = await program.account.config.fetch(configPda());
    assert.ok(cfg.admin.equals(admin.publicKey));
    assert.ok(cfg.oracle.equals(oracle.publicKey));
  });

  it("lets admin rotate the oracle and rejects non-admin", async () => {
    const newOracle = Keypair.generate();
    await program.methods.setOracle(newOracle.publicKey).accounts({ admin: admin.publicKey }).rpc();
    let cfg = await program.account.config.fetch(configPda());
    assert.ok(cfg.oracle.equals(newOracle.publicKey));

    const stranger = Keypair.generate();
    await provider.connection.confirmTransaction(
      await provider.connection.requestAirdrop(stranger.publicKey, 1e9)
    );
    let failed = false;
    try {
      await program.methods.setOracle(Keypair.generate().publicKey)
        .accounts({ admin: stranger.publicKey }).signers([stranger]).rpc();
    } catch { failed = true; }
    assert.isTrue(failed, "non-admin must not rotate oracle");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `anchor test`
Expected: FAIL — `initialize`/`setOracle` not defined / type `Config` missing.

- [ ] **Step 3: Implement `Config`, `initialize`, `set_oracle`**

Replace `solana/distributor/programs/distributor/src/lib.rs` with:
```rust
use anchor_lang::prelude::*;

declare_id!("REPLACE_WITH_anchor keys sync OUTPUT");

#[program]
pub mod distributor {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>, oracle: Pubkey) -> Result<()> {
        let cfg = &mut ctx.accounts.config;
        cfg.admin = ctx.accounts.admin.key();
        cfg.oracle = oracle;
        cfg.bump = ctx.bumps.config;
        Ok(())
    }

    pub fn set_oracle(ctx: Context<SetOracle>, new_oracle: Pubkey) -> Result<()> {
        ctx.accounts.config.oracle = new_oracle;
        Ok(())
    }
}

#[account]
pub struct Config {
    pub admin: Pubkey,
    pub oracle: Pubkey,
    pub bump: u8,
}
impl Config { pub const LEN: usize = 8 + 32 + 32 + 1; }

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(
        init, payer = admin, space = Config::LEN,
        seeds = [b"config"], bump
    )]
    pub config: Account<'info, Config>,
    #[account(mut)]
    pub admin: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct SetOracle<'info> {
    #[account(mut, seeds = [b"config"], bump = config.bump, has_one = admin)]
    pub config: Account<'info, Config>,
    pub admin: Signer<'info>,
}

#[error_code]
pub enum DistributorError {
    #[msg("unauthorized")] Unauthorized,
    #[msg("solvency: total exceeds vault balance")] InsufficientVault,
    #[msg("invalid merkle proof")] InvalidProof,
    #[msg("already claimed")] AlreadyClaimed,
    #[msg("period total exceeded")] PeriodTotalExceeded,
}
```
Then run `anchor keys sync` and paste the printed id into `declare_id!`.

- [ ] **Step 4: Run test to verify it passes**

Run: `anchor test`
Expected: both tests in "distributor" PASS.

- [ ] **Step 5: Commit**

```bash
git add solana/distributor/programs/distributor/src/lib.rs solana/distributor/tests/distributor.ts
git commit -m "feat(distributor): config init + oracle rotation"
```

---

### Task 4: Vault + `publish_period` with oracle auth and solvency cap

**Files:**
- Modify: `solana/distributor/programs/distributor/src/lib.rs`
- Test: `solana/distributor/tests/distributor.ts`

- [ ] **Step 1: Write the failing test (append to the describe block)**

Append inside `describe("distributor", ...)` in `tests/distributor.ts`:
```ts
  const vaultPda = () =>
    PublicKey.findProgramAddressSync([Buffer.from("vault")], program.programId)[0];
  const periodPda = (id: number) =>
    PublicKey.findProgramAddressSync(
      [Buffer.from("period"), new anchor.BN(id).toArrayLike(Buffer, "le", 8)],
      program.programId
    )[0];

  it("funds the vault and publishes a period under the solvency cap", async () => {
    // fund the vault PDA with 2 SOL
    const tx = await provider.connection.requestAirdrop(vaultPda(), 2e9);
    await provider.connection.confirmTransaction(tx);

    // current oracle from prior test is `newOracle`; re-set a known oracle we control
    const oracle = Keypair.generate();
    await provider.connection.confirmTransaction(
      await provider.connection.requestAirdrop(oracle.publicKey, 1e9)
    );
    await program.methods.setOracle(oracle.publicKey).accounts({ admin: admin.publicKey }).rpc();

    const root = Buffer.alloc(32, 1);
    // over-cap publish must fail (3 SOL > 2 SOL vault)
    let failed = false;
    try {
      await program.methods.publishPeriod(new anchor.BN(100), [...root], new anchor.BN(3e9))
        .accounts({ oracle: oracle.publicKey }).signers([oracle]).rpc();
    } catch { failed = true; }
    assert.isTrue(failed, "over-cap publish must fail");

    // within-cap publish by oracle succeeds
    await program.methods.publishPeriod(new anchor.BN(100), [...root], new anchor.BN(1e9))
      .accounts({ oracle: oracle.publicKey }).signers([oracle]).rpc();
    const p = await program.account.period.fetch(periodPda(100));
    assert.equal(p.totalAmount.toNumber(), 1e9);
    assert.equal(p.claimedAmount.toNumber(), 0);

    // non-oracle publish must fail
    const stranger = Keypair.generate();
    await provider.connection.confirmTransaction(
      await provider.connection.requestAirdrop(stranger.publicKey, 1e9)
    );
    let failed2 = false;
    try {
      await program.methods.publishPeriod(new anchor.BN(101), [...root], new anchor.BN(1e8))
        .accounts({ oracle: stranger.publicKey }).signers([stranger]).rpc();
    } catch { failed2 = true; }
    assert.isTrue(failed2, "non-oracle publish must fail");
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `anchor test`
Expected: FAIL — `publishPeriod` / `Period` not defined.

- [ ] **Step 3: Implement vault init, `Period`, and `publish_period`**

In `lib.rs`, add a `Vault` marker account and an init instruction, the `Period` account, and `publish_period`. Add to the `#[program]` module:
```rust
    pub fn init_vault(ctx: Context<InitVault>) -> Result<()> {
        ctx.accounts.vault.bump = ctx.bumps.vault;
        Ok(())
    }

    pub fn publish_period(
        ctx: Context<PublishPeriod>,
        period_id: u64,
        merkle_root: [u8; 32],
        total_amount: u64,
    ) -> Result<()> {
        require_keys_eq!(
            ctx.accounts.oracle.key(),
            ctx.accounts.config.oracle,
            DistributorError::Unauthorized
        );
        let vault_balance = ctx.accounts.vault.to_account_info().lamports();
        let rent = Rent::get()?.minimum_balance(Vault::LEN);
        let available = vault_balance.saturating_sub(rent);
        require!(total_amount <= available, DistributorError::InsufficientVault);

        let p = &mut ctx.accounts.period;
        p.period_id = period_id;
        p.merkle_root = merkle_root;
        p.total_amount = total_amount;
        p.claimed_amount = 0;
        p.bump = ctx.bumps.period;
        Ok(())
    }
```
Add the account types:
```rust
#[account]
pub struct Vault { pub bump: u8 }
impl Vault { pub const LEN: usize = 8 + 1; }

#[account]
pub struct Period {
    pub period_id: u64,
    pub merkle_root: [u8; 32],
    pub total_amount: u64,
    pub claimed_amount: u64,
    pub bump: u8,
}
impl Period { pub const LEN: usize = 8 + 8 + 32 + 8 + 8 + 1; }

#[derive(Accounts)]
pub struct InitVault<'info> {
    #[account(init, payer = admin, space = Vault::LEN, seeds = [b"vault"], bump)]
    pub vault: Account<'info, Vault>,
    #[account(mut, seeds = [b"config"], bump = config.bump, has_one = admin)]
    pub config: Account<'info, Config>,
    #[account(mut)]
    pub admin: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(period_id: u64)]
pub struct PublishPeriod<'info> {
    #[account(seeds = [b"config"], bump = config.bump)]
    pub config: Account<'info, Config>,
    #[account(seeds = [b"vault"], bump = vault.bump)]
    pub vault: Account<'info, Vault>,
    #[account(
        init, payer = oracle, space = Period::LEN,
        seeds = [b"period", period_id.to_le_bytes().as_ref()], bump
    )]
    pub period: Account<'info, Period>,
    #[account(mut)]
    pub oracle: Signer<'info>,
    pub system_program: Program<'info, System>,
}
```

- [ ] **Step 4: Add a vault-init call to the test setup**

In `tests/distributor.ts`, inside the "funds the vault" test, BEFORE the airdrop, ensure the vault account exists:
```ts
    await program.methods.initVault().accounts({ admin: admin.publicKey }).rpc();
```
(Place once; if a prior test already created it, wrap in try/catch to ignore "already in use".)

- [ ] **Step 5: Run test to verify it passes**

Run: `anchor test`
Expected: the "funds the vault and publishes a period" test PASSES (over-cap rejected, in-cap accepted, non-oracle rejected).

- [ ] **Step 6: Commit**

```bash
git add solana/distributor/programs/distributor/src/lib.rs solana/distributor/tests/distributor.ts
git commit -m "feat(distributor): vault + publish_period with oracle auth and solvency cap"
```

---

### Task 5: `claim` with Merkle proof, replay guard, and period-total cap

**Files:**
- Modify: `solana/distributor/programs/distributor/src/lib.rs`
- Test: `solana/distributor/tests/distributor.ts`

- [ ] **Step 1: Write the failing test (append to the describe block)**

Append to `tests/distributor.ts` (imports at top: `import { buildTree, Award } from "./merkle";`):
```ts
  const claimStatusPda = (id: number, who: PublicKey) =>
    PublicKey.findProgramAddressSync(
      [Buffer.from("claim"), new anchor.BN(id).toArrayLike(Buffer, "le", 8), who.toBuffer()],
      program.programId
    )[0];

  it("pays a valid claim, rejects bad proof, blocks double-claim", async () => {
    const oracle = Keypair.generate();
    await provider.connection.confirmTransaction(
      await provider.connection.requestAirdrop(oracle.publicKey, 2e9));
    await program.methods.setOracle(oracle.publicKey).accounts({ admin: admin.publicKey }).rpc();

    const winner = Keypair.generate();
    const other = Keypair.generate();
    const awards: Award[] = [
      { index: 0, claimant: winner.publicKey, amount: new anchor.BN(5e8) },
      { index: 1, claimant: other.publicKey, amount: new anchor.BN(3e8) },
    ];
    const { root, proofs } = buildTree(awards);

    const PERIOD = 200;
    await program.methods
      .publishPeriod(new anchor.BN(PERIOD), [...root], new anchor.BN(8e8))
      .accounts({ oracle: oracle.publicKey }).signers([oracle]).rpc();

    const before = await provider.connection.getBalance(winner.publicKey);
    await program.methods
      .claim(new anchor.BN(PERIOD), new anchor.BN(0), new anchor.BN(5e8),
        proofs[0].map((b) => [...b]))
      .accounts({ claimant: winner.publicKey }).signers([winner]).rpc();
    const after = await provider.connection.getBalance(winner.publicKey);
    assert.equal(after - before, 5e8);

    // double-claim must fail
    let dbl = false;
    try {
      await program.methods.claim(new anchor.BN(PERIOD), new anchor.BN(0), new anchor.BN(5e8),
        proofs[0].map((b) => [...b]))
        .accounts({ claimant: winner.publicKey }).signers([winner]).rpc();
    } catch { dbl = true; }
    assert.isTrue(dbl, "double claim must fail");

    // wrong amount / bad proof must fail
    let bad = false;
    try {
      await program.methods.claim(new anchor.BN(PERIOD), new anchor.BN(1), new anchor.BN(9e8),
        proofs[1].map((b) => [...b]))
        .accounts({ claimant: other.publicKey }).signers([other]).rpc();
    } catch { bad = true; }
    assert.isTrue(bad, "claim with wrong amount must fail");
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `anchor test`
Expected: FAIL — `claim` / `ClaimStatus` not defined.

- [ ] **Step 3: Implement `claim`, `ClaimStatus`, and Merkle verify**

Add to the `#[program]` module in `lib.rs`:
```rust
    pub fn claim(
        ctx: Context<Claim>,
        period_id: u64,
        index: u64,
        amount: u64,
        proof: Vec<[u8; 32]>,
    ) -> Result<()> {
        let claimant = ctx.accounts.claimant.key();

        // leaf = keccak(index_le || claimant || amount_le)
        let mut leaf_pre = Vec::with_capacity(8 + 32 + 8);
        leaf_pre.extend_from_slice(&index.to_le_bytes());
        leaf_pre.extend_from_slice(claimant.as_ref());
        leaf_pre.extend_from_slice(&amount.to_le_bytes());
        let mut node = anchor_lang::solana_program::keccak::hash(&leaf_pre).0;

        for sib in proof.iter() {
            let (lo, hi) = if node <= *sib { (node, *sib) } else { (*sib, node) };
            let mut buf = [0u8; 64];
            buf[..32].copy_from_slice(&lo);
            buf[32..].copy_from_slice(&hi);
            node = anchor_lang::solana_program::keccak::hash(&buf).0;
        }
        require!(node == ctx.accounts.period.merkle_root, DistributorError::InvalidProof);

        let period = &mut ctx.accounts.period;
        require!(
            period.claimed_amount.checked_add(amount).unwrap() <= period.total_amount,
            DistributorError::PeriodTotalExceeded
        );
        period.claimed_amount = period.claimed_amount.checked_add(amount).unwrap();

        // move lamports from program-owned vault PDA to claimant
        **ctx.accounts.vault.to_account_info().try_borrow_mut_lamports()? -= amount;
        **ctx.accounts.claimant.to_account_info().try_borrow_mut_lamports()? += amount;

        ctx.accounts.claim_status.claimed = true;
        Ok(())
    }
```
Add account types:
```rust
#[account]
pub struct ClaimStatus { pub claimed: bool }
impl ClaimStatus { pub const LEN: usize = 8 + 1; }

#[derive(Accounts)]
#[instruction(period_id: u64)]
pub struct Claim<'info> {
    #[account(mut, seeds = [b"period", period_id.to_le_bytes().as_ref()], bump = period.bump)]
    pub period: Account<'info, Period>,
    #[account(mut, seeds = [b"vault"], bump = vault.bump)]
    pub vault: Account<'info, Vault>,
    #[account(
        init, payer = claimant, space = ClaimStatus::LEN,
        seeds = [b"claim", period_id.to_le_bytes().as_ref(), claimant.key().as_ref()], bump
    )]
    pub claim_status: Account<'info, ClaimStatus>,
    #[account(mut)]
    pub claimant: Signer<'info>,
    pub system_program: Program<'info, System>,
}
```
The replay guard is the `init` on `claim_status`: a second claim for the same `(period_id, claimant)` fails because the PDA already exists.

- [ ] **Step 4: Run test to verify it passes**

Run: `anchor test`
Expected: the claim test PASSES — valid claim pays exactly 0.5 SOL, double-claim fails, wrong-amount proof fails.

- [ ] **Step 5: Commit**

```bash
git add solana/distributor/programs/distributor/src/lib.rs solana/distributor/tests/distributor.ts
git commit -m "feat(distributor): merkle claim with replay guard and period cap"
```

---

### Task 6: Full hourly-flow integration test + devnet deploy notes

**Files:**
- Test: `solana/distributor/tests/distributor.ts`
- Create: `solana/distributor/README.md`

- [ ] **Step 1: Write an end-to-end "one hour" test**

Append to `tests/distributor.ts`:
```ts
  it("end-to-end: fund -> publish hour -> top-10 each claim once", async () => {
    const oracle = Keypair.generate();
    await provider.connection.confirmTransaction(
      await provider.connection.requestAirdrop(oracle.publicKey, 2e9));
    await program.methods.setOracle(oracle.publicKey).accounts({ admin: admin.publicKey }).rpc();
    await provider.connection.confirmTransaction(
      await provider.connection.requestAirdrop(vaultPda(), 2e9));

    const winners = Array.from({ length: 10 }, () => Keypair.generate());
    const per = new anchor.BN(1e8); // 0.1 SOL each => 1 SOL total
    const awards: Award[] = winners.map((w, i) => ({ index: i, claimant: w.publicKey, amount: per }));
    const { root, proofs } = buildTree(awards);

    const HOUR = 481968; // example UTC hour bucket
    await program.methods.publishPeriod(new anchor.BN(HOUR), [...root], new anchor.BN(1e9))
      .accounts({ oracle: oracle.publicKey }).signers([oracle]).rpc();

    for (let i = 0; i < winners.length; i++) {
      const w = winners[i];
      await provider.connection.confirmTransaction(
        await provider.connection.requestAirdrop(w.publicKey, 1e7)); // rent for claim_status
      const before = await provider.connection.getBalance(w.publicKey);
      await program.methods.claim(new anchor.BN(HOUR), new anchor.BN(i), per, proofs[i].map((b) => [...b]))
        .accounts({ claimant: w.publicKey }).signers([w]).rpc();
      const after = await provider.connection.getBalance(w.publicKey);
      assert.isAbove(after, before); // received payout (net of claim_status rent)
    }
    const p = await program.account.period.fetch(periodPda(HOUR));
    assert.equal(p.claimedAmount.toNumber(), 1e9);
  });
```

- [ ] **Step 2: Run the full suite**

Run: `anchor test`
Expected: ALL tests PASS.

- [ ] **Step 3: Write deploy notes**

Create `solana/distributor/README.md`:
```markdown
# distributor

Hourly Merkle leaderboard payout program (Phase 0, native SOL).

## Test
    anchor test

## Devnet deploy
    solana config set --url devnet
    anchor build && anchor deploy --provider.cluster devnet
    # then: initialize(oracle_pubkey), init_vault, fund the vault PDA

## Merkle convention
- leaf = keccak256(index_u64_le || claimant_32 || amount_u64_le)
- parent = keccak256(sorted(a,b))
The Plan-2 backend MUST build roots identically (see tests/merkle.ts).
```

- [ ] **Step 4: Commit**

```bash
git add solana/distributor/tests/distributor.ts solana/distributor/README.md
git commit -m "test(distributor): end-to-end hourly flow + deploy notes"
```

---

## Self-Review

**Spec coverage (this plan = spec §4 on-chain distributor, §6 settlement, the §6 solvency cap, §9 replay guard):**
- §4 "verifies hourly Merkle root signed by oracle key" → Task 4 (`publish_period` requires `config.oracle` signer) + Task 5 (root verify). ✅
- §6 "pays a budgeted % … never over-draw" → Task 4 solvency cap (`total_amount <= vault available`) + Task 5 period-total cap. ✅
- §6 "winners claim with a proof" → Task 5 `claim`. ✅
- §9 "per-root replay guard / double-claim" → Task 5 `claim_status` init-PDA guard. ✅
- §9 "oracle key compromise → caps" → solvency + period caps bound blast radius. ✅
- Deferred to other plans (correctly out of scope here): USDC/SPL payout (Phase 1), the off-chain oracle signer + root builder (Plan 2), KYC/eligibility gating (Plan 2), fee keeper (Plan 5).

**Placeholder scan:** the only intentional placeholder is `declare_id!("REPLACE_WITH_…")`, resolved by `anchor keys sync` in Task 1/Task 3 — flagged explicitly, not a silent TODO.

**Type consistency:** `Config{admin,oracle,bump}`, `Vault{bump}`, `Period{period_id,merkle_root,total_amount,claimed_amount,bump}`, `ClaimStatus{claimed}`; instructions `initialize/set_oracle/init_vault/publish_period/claim`; PDAs `config|vault|period|claim` — all consistent across tasks. Merkle convention identical in `tests/merkle.ts` (Task 2) and the on-chain verify (Task 5).

**Known follow-ups (not blockers for Plan 1):** the oracle currently pays rent for `Period` (it's the signer) — fine for Phase 0; Phase 1 may switch to a dedicated payer. SPL/USDC payout, period expiry, and admin-reclaim of unclaimed funds are Phase 1 items tracked in spec §14.
