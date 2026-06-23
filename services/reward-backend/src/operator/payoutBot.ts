// payoutBot — custodial payout for ChainStrike.
//
// Reads the kills leaderboard for a closed 30-min period and sends SOL from the
// treasury hot wallet directly to the top fraggers. No on-chain program, no
// claims — the operator funds a normal wallet and this bot disburses it.
//
// Idempotent: each period is recorded in PAID_LOG and never paid twice.
//
// Run (one period — defaults to the just-closed one):
//   TREASURY_KEY=~/chainstrike-treasury.json RPC_URL=... PER_ROUND_SOL=0.1 \
//   npx tsx src/operator/payoutBot.ts [periodHour]
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
const PER_ROUND_SOL = Number(process.env.PER_ROUND_SOL ?? 0.1); // total pot disbursed per round
const TOP_N = Number(process.env.TOP_N ?? 7);
const WEIGHTS = (process.env.WEIGHTS ?? "30,22,16,12,9,7,4").split(",").map(Number);
const MIN_KILLS = Number(process.env.MIN_KILLS ?? 1);
// Only run the (full-pool) payout when at least this many players are on the
// board — otherwise skip and let the pool accumulate for a busier round.
const MIN_PLAYERS = Number(process.env.MIN_PLAYERS ?? 7);
const FEE_BUFFER_SOL = Number(process.env.FEE_BUFFER_SOL ?? 0.01);
const PERIOD_MS = 1_800_000;   // 30-min payout periods

interface Entry { wallet: string; kills?: number; rank?: number; }
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
    // base58 32-byte pubkey; name-fallback identities ("R4vager") fail here and
    // are skipped — they have no wallet to pay until name->wallet is registered.
    const pk = new PublicKey(s);
    return pk.toBytes().length === 32 && s.length >= 32 && s.length <= 44;
  } catch {
    return false;
  }
}

async function payPeriod(hour: number): Promise<void> {
  const paid = loadPaid();
  if (paid[hour]) {
    console.log(`period ${hour}: already paid, skipping`);
    return;
  }

  const res = await fetch(`${API}/leaderboard/${hour}`);
  if (!res.ok) throw new Error(`leaderboard fetch failed: ${res.status}`);
  const entries = (await res.json()) as Entry[];

  // Gate: the full-pool payout only fires with real competition. Fewer than
  // MIN_PLAYERS on the board -> skip this round, leaving the pool to grow.
  if (entries.length < MIN_PLAYERS) {
    console.log(`period ${hour}: ${entries.length} players on board (<${MIN_PLAYERS}) — skipped, pool preserved`);
    return;
  }

  const winners = entries
    .filter((e) => isWallet(e.wallet) && (e.kills ?? 0) >= MIN_KILLS)
    .slice(0, TOP_N);

  const skipped = entries.length - entries.filter((e) => isWallet(e.wallet)).length;
  if (skipped > 0) console.log(`period ${hour}: ${skipped} entries skipped (no registered wallet)`);

  if (winners.length === 0) {
    console.log(`period ${hour}: no payable winners`);
    paid[hour] = { winners: [], ts: Date.now() };
    savePaid(paid);
    return;
  }

  const treasury = loadTreasury();
  const conn = new Connection(RPC, "confirmed");
  const bal = await conn.getBalance(treasury.publicKey);
  // Available pot = treasury minus a fee buffer (PER_ROUND_SOL > 0 caps it).
  const fullPot = Math.max(0, bal - Math.floor(FEE_BUFFER_SOL * LAMPORTS_PER_SOL));
  const cappedPot = PER_ROUND_SOL > 0 ? Math.min(Math.floor(PER_ROUND_SOL * LAMPORTS_PER_SOL), fullPot) : fullPot;
  // Scale by how full the top-7 is: the FULL pot only goes out with 7 winners.
  // Fewer winners get a proportional slice (winners/7) so a 2-3 player round
  // doesn't drain the whole pool — the remainder stays in the treasury.
  const pot = Math.floor((cappedPot * Math.min(winners.length, TOP_N)) / TOP_N);
  if (pot <= 0) {
    console.log(`period ${hour}: treasury too low (${bal / LAMPORTS_PER_SOL} SOL) — fund it`);
    return;
  }
  console.log(`period ${hour}: ${winners.length}/${TOP_N} winners -> pot ${(pot / LAMPORTS_PER_SOL).toFixed(4)} of ${(cappedPot / LAMPORTS_PER_SOL).toFixed(4)} SOL available`);

  const w = WEIGHTS.slice(0, winners.length);
  const wSum = w.reduce((a, b) => a + b, 0);

  // Send all payouts in PARALLEL off a single blockhash so the whole round
  // disperses in ~1-2s instead of one-tx-at-a-time. Each settles independently.
  const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash();
  const results = await Promise.all(
    winners.map(async (winner, i) => {
      const lamports = Math.floor((pot * w[i]) / wSum);
      if (lamports <= 0) return { rank: i + 1, wallet: winner.wallet, sol: 0 };
      const tx = new Transaction({ feePayer: treasury.publicKey, blockhash, lastValidBlockHeight }).add(
        SystemProgram.transfer({
          fromPubkey: treasury.publicKey,
          toPubkey: new PublicKey(winner.wallet),
          lamports,
        }),
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

  paid[hour] = { winners: results, ts: Date.now() };
  savePaid(paid);
  console.log(`period ${hour}: done`);
}

const arg = process.argv[2];
const hour = arg ? Number(arg) : Math.floor(Date.now() / PERIOD_MS) - 1;
payPeriod(hour)
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
