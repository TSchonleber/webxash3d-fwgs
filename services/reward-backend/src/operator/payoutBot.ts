// payoutBot — custodial payout for ChainStrike.
//
// Reads the 8-hour reward window's Top-10 skill board and sends SOL from the
// treasury hot wallet directly to the winners, SCORE-WEIGHTED (each winner earns
// in proportion to their skill rating). No on-chain program, no claims — the
// operator funds a normal wallet and this bot disburses it.
//
// Fires once per 8h window (driven by payout-scheduler.sh at the window boundary
// + offset, in lockstep with the website countdown). Idempotent: each window is
// recorded in PAID_LOG and never paid twice.
//
// Run (one window — defaults to the just-closed one):
//   TREASURY_KEY=~/chainstrike-treasury.json RPC_URL=... \
//   npx tsx src/operator/payoutBot.ts [windowIndex]
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  LAMPORTS_PER_SOL,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import { readFileSync, existsSync, writeFileSync } from "node:fs";

const RPC = process.env.RPC_URL ?? "https://api.devnet.solana.com";
const API = process.env.API_BASE ?? "http://localhost:8787";
const TREASURY_KEY = process.env.TREASURY_KEY ?? `${process.env.HOME}/chainstrike-treasury.json`;
const PAID_LOG = process.env.PAID_LOG ?? `${process.env.HOME}/chainstrike-payouts.json`;
// Pot per window: 0 = the WHOLE treasury (minus fee buffer); >0 caps it to that many SOL.
const PER_WINDOW_SOL = Number(process.env.PER_WINDOW_SOL ?? process.env.PER_ROUND_SOL ?? 0);
const TOP_N = Number(process.env.TOP_N ?? 10);
// Only pay when at least this many qualified winners are on the board — otherwise
// skip and let the pot roll to a busier window.
const MIN_PLAYERS = Number(process.env.MIN_PLAYERS ?? 3);
const FEE_BUFFER_SOL = Number(process.env.FEE_BUFFER_SOL ?? 0.01);
const DRY_RUN = process.env.DRY_RUN === "1"; // log the split without sending SOL
const WINDOW_MS = 28_800_000; // 8-hour reward window — MUST match period.ts

interface Entry { wallet: string; score?: number; kills?: number; }
type PaidLog = Record<string, { winners: unknown; ts: number }>;

function loadTreasury(): Keypair {
  const raw = JSON.parse(readFileSync(TREASURY_KEY.replace(/^~/, process.env.HOME ?? ""), "utf8"));
  return Keypair.fromSecretKey(Uint8Array.from(raw));
}
function loadPaid(): PaidLog {
  return existsSync(PAID_LOG) ? (JSON.parse(readFileSync(PAID_LOG, "utf8")) as PaidLog) : {};
}
function savePaid(p: PaidLog): void {
  writeFileSync(PAID_LOG, JSON.stringify(p, null, 2));
}
function isWallet(s: string): boolean {
  try {
    const pk = new PublicKey(s); // name-fallback identities fail here and are skipped
    return pk.toBytes().length === 32 && s.length >= 32 && s.length <= 44;
  } catch {
    return false;
  }
}

async function payWindow(win: number): Promise<void> {
  const key = `w${win}`;
  const paid = loadPaid();
  if (paid[key]) {
    console.log(`window ${win}: already paid, skipping`);
    return;
  }

  // The 8h window's gated, efficiency-ranked Top-10 (DailyEntry carries `score`).
  const res = await fetch(`${API}/leaderboard/daily?day=${win}`);
  if (!res.ok) throw new Error(`leaderboard fetch failed: ${res.status}`);
  const board = (await res.json()) as Entry[];

  const winners = board.filter((e) => isWallet(e.wallet) && (e.score ?? 0) > 0).slice(0, TOP_N);
  const skipped = board.length - board.filter((e) => isWallet(e.wallet)).length;
  if (skipped > 0) console.log(`window ${win}: ${skipped} entries skipped (no registered wallet)`);

  if (winners.length < MIN_PLAYERS) {
    console.log(`window ${win}: ${winners.length} payable winners (<${MIN_PLAYERS}) — skipped, pot preserved`);
    return;
  }

  const treasury = loadTreasury();
  const conn = new Connection(RPC, "confirmed");
  const bal = await conn.getBalance(treasury.publicKey);
  const fullPot = Math.max(0, bal - Math.floor(FEE_BUFFER_SOL * LAMPORTS_PER_SOL));
  const pot = PER_WINDOW_SOL > 0 ? Math.min(Math.floor(PER_WINDOW_SOL * LAMPORTS_PER_SOL), fullPot) : fullPot;
  if (pot <= 0) {
    console.log(`window ${win}: treasury too low (${bal / LAMPORTS_PER_SOL} SOL) — fund it`);
    return;
  }

  // SCORE-WEIGHTED split: scores carry one decimal → scale to integer weights for
  // exact lamport math; the rounding remainder goes to the top scorer.
  const weights = winners.map((w) => Math.max(0, Math.round((w.score ?? 0) * 10)));
  const wSum = weights.reduce((a, b) => a + b, 0);
  if (wSum === 0) {
    console.log(`window ${win}: zero total score — skipped`);
    return;
  }
  const amounts = weights.map((w) => Math.floor((pot * w) / wSum));
  amounts[0] += pot - amounts.reduce((a, b) => a + b, 0); // remainder -> top scorer

  console.log(
    `window ${win}: ${winners.length} winners, pot ${(pot / LAMPORTS_PER_SOL).toFixed(4)} SOL (score-weighted)` +
      (DRY_RUN ? " [DRY RUN]" : ""),
  );
  if (DRY_RUN) {
    winners.forEach((w, i) => console.log(`  ${i + 1}. ${w.wallet} score=${w.score} -> ${(amounts[i] / LAMPORTS_PER_SOL).toFixed(4)} SOL`));
    return;
  }

  // Send all payouts in PARALLEL off a single blockhash so the window disperses
  // in ~1-2s. Each settles independently.
  const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash();
  const results = await Promise.all(
    winners.map(async (winner, i) => {
      const lamports = amounts[i];
      if (lamports <= 0) return { rank: i + 1, wallet: winner.wallet, sol: 0 };
      const tx = new Transaction({ feePayer: treasury.publicKey, blockhash, lastValidBlockHeight }).add(
        SystemProgram.transfer({ fromPubkey: treasury.publicKey, toPubkey: new PublicKey(winner.wallet), lamports }),
      );
      try {
        const sig = await sendAndConfirmTransaction(conn, tx, [treasury], { commitment: "confirmed" });
        console.log(`  #${i + 1} ${winner.wallet} <- ${lamports / LAMPORTS_PER_SOL} SOL  ${sig}`);
        return { rank: i + 1, wallet: winner.wallet, sol: lamports / LAMPORTS_PER_SOL, sig };
      } catch (e) {
        console.error(`  #${i + 1} ${winner.wallet} FAILED: ${e instanceof Error ? e.message : e}`);
        return { rank: i + 1, wallet: winner.wallet, error: String(e) };
      }
    }),
  );

  paid[key] = { winners: results, ts: Date.now() };
  savePaid(paid);
  console.log(`window ${win}: done`);
}

// Default to the just-closed window (the scheduler fires just after the boundary).
const arg = process.argv[2];
const win = arg ? Number(arg) : Math.floor(Date.now() / WINDOW_MS) - 1;
payWindow(win)
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
