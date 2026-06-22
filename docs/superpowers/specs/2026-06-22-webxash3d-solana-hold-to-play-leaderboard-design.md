# webxash3d Solana — Hold-to-Play Skill Leaderboard with Creator-Reward-Funded Prizes

**Date:** 2026-06-22
**Status:** Design — pending user review
**Base game:** [yohimik/webxash3d-fwgs](https://github.com/yohimik/webxash3d-fwgs) (Xash3D-FWGS / GoldSrc engine compiled to WASM; CS 1.6 via `cs16-client`)
**Supersedes:** burn-to-play design (removed)

---

## 1. Summary

A browser-based Counter-Strike 1.6 skill competition:

- **Access = hold-to-play.** Players authenticate with **Privy** and must **hold ≥1000 game tokens** in their wallet to be eligible. Gameplay is otherwise free — no entry fee, no burn, no stake.
- **Auth = Privy.io.** One layer covers **email login → embedded Solana wallet** *and* **external wallet connect** (Phantom, etc.). Email users get a custodial-style embedded wallet they fully control via Privy.
- **Prizes = creator rewards.** An **hourly leaderboard** pays the **top 10** from the pump.fun **creator-fee pool**, in **SOL/USDC**.
- The **Go game server is the sole authority** for match results that feed the leaderboard; reward-eligible matches run only on operator-controlled instances.

No escrow, no custody of player stakes, no peer-vs-peer wagering. The token's job is the **access gate** (hold ≥1000 to play), which drives the buy/hold demand that generates the trading volume that funds the prizes.

## 2. Why this model (decision trail)

Converged after several iterations (brainctl decisions #259 → #260 → #261):

- **Rejected — player-staked PvP wagering:** regulated gambling, escrow/custody, existential anti-cheat (cheats steal peers' SOL).
- **Rejected — burn-to-play:** strong tokenomics but irreversible-burn edge cases and heavier "consideration" legal posture.
- **Rejected — pure free play:** legally cleanest, but the token loses all demand (nothing funds the fee engine) and sybil farming becomes uncapped.
- **Chosen — hold-to-play + Privy + hourly leaderboard:** best balance.

| Property | Result |
|---|---|
| Token demand | **Restored** — must buy+hold 1000 to play → buy pressure → volume → creator fees → prizes; holders keep tokens (no burn/forced-sell death-spiral) |
| Sybil resistance | **Capital wall** — N accounts require N×1000 tokens held simultaneously; reinforced by KYC-at-payout + MMR |
| Custody / money-transmitter | **None** — eligibility is a balance read; no held player funds |
| Legal class | **Mild "consideration" gray zone** — must buy token to be prize-eligible; far lighter than wagering/burn (holders keep+can sell, skill not chance) but not pure-free-play-clean |
| Onboarding | **Low friction** via Privy email; cost = a buy-1000-tokens flow for embedded-wallet users |

**Core economic bet:** trading volume (driven by hold-to-play demand + speculation) generates the creator fees that fund the hourly prizes. The flywheel rests on that volume being real.

## 3. Goals / Non-Goals

**Goals**
- Loop: Privy login → acquire/hold ≥1000 tokens → matched 5v5 by MMR → play on operator server → climb hourly points board → top 10 paid SOL/USDC to Privy wallet.
- Server-authoritative results; no client-reported value trusted.
- Hourly payouts that are solvency-safe and only pay verified, non-sybil winners.
- Devnet dry-run exercising the real on-chain leaderboard-payout path, then mainnet beta.

**Non-Goals (v1)**
- No burn, no stake, no escrow, no peer pot, no custodial balances.
- No modes beyond 5v5; no spectator features; no NFT marketplace.
- No perfect anti-cheat (managed, not solved); no real-time manual review of every hourly winner.

## 4. Architecture

| Component | Responsibility | Stack |
|---|---|---|
| **Web client** | Privy auth (email embedded + external connect); buy-1000-tokens onboarding (on-ramp + swap); hold-eligibility status; 5v5 MMR lobby; live match (wraps `Xash3D`); hourly leaderboard UI; payout/claim | TypeScript, Privy SDK, `@solana/web3.js`, webxash3d packages |
| **Go game server** | Sole result oracle; operator-only reward instances; Privy-session↔wallet binding; server-side demo recording; authoritative scoring | Go (extends `cs-web-server`) |
| **Reward backend** | Verify hold-eligibility (RPC balance read); MMR matchmaking; ingest signed results; compute hourly points board; tier-1 anti-cheat; payout-eligibility gating (KYC + reputation); compute solvency-capped prize split; publish hourly Merkle root | TypeScript/Node service |
| **Fee keeper** | Periodically claim pump.fun creator rewards → prize vault (SOL/USDC) | Cron + backend signer |
| **On-chain: distributor** (Anchor) | Holds prize vault; verifies hourly Merkle root signed by oracle key; winners claim SOL/USDC with a proof; per-root replay guard | Anchor program |
| **KYC provider** | Distinct-human verification before payout above threshold | 3rd-party (TBD) |
| **On-ramp + swap** | Fiat/SOL → token into embedded wallet to reach 1000 | Provider on-ramp + Jupiter |

### Trust model
Players trust *"the operator ran fair servers and the distributor only pays the hourly Merkle root the operator's oracle key signed."* The oracle key is the root of trust — backend signer/HSM, never the browser.

## 5. Eligibility & identity
- **Auth:** Privy. Email login provisions an embedded Solana wallet; external wallets connect through the same Privy layer. Backend trusts a verified Privy session bound to a wallet address.
- **Hold gate:** at **match-join**, backend reads the wallet's token balance (RPC `getTokenAccountBalance`); `< 1000` ⇒ ineligible to start. (Checked at join; selling mid-match doesn't void an in-progress game.)
- **Server binding:** Privy session ↔ wallet ↔ server slot. Reward-eligible matches accepted **only** from operator-controlled, identity-signed server instances (players can't self-host and forge results).
- **1000 is a fixed token count** — its USD cost floats with price. Early/low-price, the barrier is trivial; revisit the number (or add a USD floor) once a price exists.

## 6. Leaderboard & payout

- **Two separate numbers:**
  - **MMR (Glicko):** long-run skill rating, used only for **matchmaking fairness** (similar-skill 5v5).
  - **Hourly points:** the **payout metric** — points earned within the clock hour (UTC), weighted toward wins + performance (kills/objectives), with a minimum-games floor to qualify. ELO is *not* used for payout (can't converge in an hour).
- **Cadence:** leaderboard refreshes every **clock hour (UTC)**; the **top 10** of each hour are paid.
- **Payout sizing (solvency):** each hour pays a budgeted `% of creator fees accumulated since the last payout`, split across the top 10 (steeply weighted to #1). Never a fixed promise → the pool can't be over-drawn. Low-volume hours ⇒ small or carried-over pools (carry-over configurable).
- **Verification buffer:** to leave room for the anti-cheat/KYC sweep, **hour N is paid at the end of hour N+1** after the sweep completes. Once SOL leaves, clawback is effectively impossible, so all gating happens *before* payment.
- **Settlement:** backend publishes an hourly **Merkle root** signed by the oracle key; the distributor verifies the signature, replay-guards the root, and lets each verified winner claim SOL/USDC to their Privy wallet (backend can auto-submit for UX).

## 7. Anti-cheat & anti-sybil (the sharpened risk under hourly money)

Hourly real-money prizes attract continuous bot/cheat farming. Defense is layered and **pre-payment**:

- **Server-authoritative** scoring; client reports nothing that affects ranking.
- **Tier-1 inline heuristics** (accuracy, headshot %, reaction time, impossible-stat + known-signature checks) run automatically each match.
- **Payout-eligibility gating:** only **KYC-verified + established** wallets are *paid*. New/anonymous/suspicious wallets may appear on the board but their payout is **withheld** until cleared. This is the primary sybil/farming defense given no time for live manual review.
- **Capital wall:** hold-to-play (N×1000 per account) raises farming cost.
- **MMR gating** prevents stacked teams farming casuals.
- **Demo retention + post-hoc bans** for cheats caught after the fact (money already paid only to *pre-cleared* wallets, bounding loss).
- Honest ceiling: aim-assist on a client-trusting WASM engine can't be fully eliminated; this is risk management, and hourly cadence makes it the co-dominant risk alongside sustainability.

## 8. Tokenomics & sustainability
- **Demand:** hold-to-play forces buy+hold of ≥1000 tokens per active player.
- **No forced sell pressure:** prizes pay in SOL/USDC, not the token; holders aren't compelled to sell.
- **Prize pool = f(creator-fee volume)** → cold-start/death-spiral is a top risk. Disciplines: pay only a budgeted % of *actual* accumulated fees (enforced by the solvency cap); optionally route a fee slice into token buybacks.
- pump.fun chosen for distribution/virality; claim automation is off the gameplay critical path (keeper claims on schedule into the vault).

## 9. Error handling & edge cases
- **Embedded wallet empty** → buy-1000-tokens onboarding (on-ramp + Jupiter) before eligibility.
- **Sells tokens mid-session** → current match completes (gate is at join); next join re-checks.
- **Hour-boundary / tie-breaks** → UTC clock hours; documented tie-break (e.g., higher win-rate, then earlier achieved).
- **Insufficient hourly fees** → small or carried-over pool; UI shows live pool size.
- **Top-10 winner not KYC'd** → rank shown, payout withheld until KYC (claim window before forfeiture).
- **Replay/double-claim** → per-root nonce in distributor.
- **Oracle key compromise** → backend signer/HSM, rotation, per-root expiry, on-chain caps.
- **RPC/balance-read failure or stale** → fail closed (ineligible) rather than open.

## 10. Security & streaming safety
- Oracle / creator-fee / treasury keys in a backend signer, **never** in the browser.
- Per operator's streaming context: **never connect oracle/treasury/creator wallets on camera**; burner display wallet for demos; devnet for on-stream walkthroughs.

## 11. Legal & compliance (flag-and-proceed)
- Hold-to-play = **mild "consideration"** (must buy a token to be prize-eligible). Far lighter than wagering/burn — holders keep and can resell tokens, outcome is skill not chance — but **not** the pure-free-play "no consideration" safe zone.
- Build: clean **ToS**, **geofence** (prohibited US states + countries), **age-gate**, **KYC at payout** (already required for sybil).
- A **quick gaming/crypto legal read** is prudent before mainnet payouts (lighter than the wagering lawyer gate). The textbook softener if needed is a **free alternate entry path (AMOE)** — but it weakens sybil resistance, so treat as a deferred tension.

## 12. Phasing
- **Phase 0 — Devnet dry-run:** test token mint, Privy integration, hold-eligibility read, one Go server, MMR stub, hourly points board, distributor + hourly Merkle settlement. Exercises the real on-chain path. Stream-safe.
- **Phase 1 — Mainnet beta:** real pump.fun token, fee keeper, tier-1 anti-cheat, KYC + payout-eligibility gating, solvency cap, ToS/geofence/age-gate, legal read.
- **Phase 2 — Scale:** demo-replay dispute tooling, deeper anomaly detection, buyback routing, more maps/servers, leaderboard tuning.

## 13. Testing strategy
- **On-chain:** Anchor tests for distributor (Merkle verify, oracle-sig, replay guard, solvency cap, expiry) on localnet + devnet.
- **Backend:** unit tests for MMR, hourly points math, solvency split, anti-cheat heuristics (labeled fixtures), KYC/eligibility gating, oracle signing, hold-eligibility read (incl. fail-closed).
- **Auth:** Privy email + external connect; session↔wallet binding; operator-only server identity.
- **E2E (devnet):** full loop login → acquire 1000 → match → hourly board → buffered payout, plus each §9 edge case.
- **Real-browser smoke test** of the client (WASM render + Privy + wallet flow) — jsdom can't catch WASM/CSS/wallet issues.

## 14. Open questions / deferred
- Hourly points formula weights (win vs performance) + minimum-games floor.
- Payout split curve across top 10; carry-over policy for low-fee hours.
- KYC provider + payout threshold that triggers it.
- Whether to add a USD floor to the 1000-token gate.
- Buyback routing % (Phase 2); AMOE decision (legal-dependent).
- Confirm whether pump.fun fees arrive as SOL or USDC (affects payout denomination handling).

## 15. Risks (ranked)
1. **Economic sustainability** — hourly prize pool depends on fee volume; cold-start/death-spiral. Mitigated by solvency cap + hold-to-play demand, but it's the core bet.
2. **Sybil / cheat farming** — hourly real money runs 24/7; sharpened by free-ish accounts. Mitigated by hold-to-play capital wall + KYC-at-payout + payout-eligibility gating + MMR + post-hoc bans.
3. **Anti-cheat ceiling** — client-trusting WASM; managed, not solved.
4. **Legal** — mild consideration; ToS + geofence + KYC + quick legal read.
5. **Oracle key compromise** — backend signer + caps + rotation.
