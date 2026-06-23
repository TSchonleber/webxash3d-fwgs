import { serve } from "@hono/node-server";
import { createApp } from "./app";
import { MatchStore } from "./store";
import { SqliteMatchStore } from "./sqlite-store";
import { rpcBalanceReader, isHoldEligible } from "../eligibility";
import { Connection, PublicKey } from "@solana/web3.js";

// Use || (not ??) for string envs: container runtimes (docker compose ${VAR:-})
// pass *empty strings* for unset vars, and "" must fall back to the default —
// e.g. new PublicKey("") throws and crash-loops the server.
const PORT = Number(process.env.PORT || 8787);
const ALLOWLIST = (process.env.OPERATOR_PUBKEYS ?? "").split(",").filter(Boolean);
const MIN_TOKENS = Number(process.env.MIN_TOKENS || 1000);
const MINT = process.env.GAME_MINT ?? "";
const RPC = process.env.RPC_URL || "https://api.devnet.solana.com";

const PROGRAM = new PublicKey(process.env.DISTRIBUTOR_PROGRAM_ID || "6jSjkNJg2ap9Mxmj6prQ7bEnBQsSWvf6t5p5vWLBzSx4");
const [VAULT] = PublicKey.findProgramAddressSync([Buffer.from("vault")], PROGRAM);
// The displayed prize pool reads the custodial treasury that funds payouts, so
// the pool the players see == the wallet the operator funds == the wallet the
// payout bot sends from. Falls back to the legacy distributor vault PDA only if
// POOL_ADDRESS is unset. (Empty string is treated as unset to avoid PublicKey("").)
const POOL = process.env.POOL_ADDRESS ? new PublicKey(process.env.POOL_ADDRESS) : VAULT;
const conn = new Connection(RPC, "confirmed");
const reader = rpcBalanceReader(conn);

// Persist the leaderboard to disk when LEADERBOARD_DB_PATH is set so matches and
// settlements survive a restart; fall back to in-memory otherwise.
const DB_PATH = process.env.LEADERBOARD_DB_PATH ?? "";
const store = DB_PATH ? new SqliteMatchStore(DB_PATH) : new MatchStore();
console.log(DB_PATH ? `leaderboard persisted to ${DB_PATH}` : "leaderboard in-memory (set LEADERBOARD_DB_PATH to persist)");

// Read the treasury's recent outgoing SOL transfers (the payouts) straight from
// chain so the transparency page reflects what actually happened on-chain.
async function readPayouts() {
  const sigs = await conn.getSignaturesForAddress(POOL, { limit: 15 });
  const treasury = POOL.toBase58();
  const out: { sig: string; to: string; lamports: number; blockTime: number }[] = [];
  // Fetch one at a time — the free RPC plan forbids batch requests (which the
  // plural getParsedTransactions uses). The /payouts route caches this for 60s.
  for (const s of sigs) {
    let tx;
    try {
      tx = await conn.getParsedTransaction(s.signature, { maxSupportedTransactionVersion: 0 });
    } catch {
      continue; // skip a tx the RPC hiccups on; keep the rest
    }
    if (!tx || tx.meta?.err) continue;
    for (const ix of tx.transaction.message.instructions as {
      parsed?: { type?: string; info?: { source?: string; destination?: string; lamports?: number } };
    }[]) {
      const p = ix.parsed;
      if (p?.type === "transfer" && p.info?.source === treasury && p.info?.destination && p.info.destination !== treasury) {
        out.push({ sig: s.signature, to: p.info.destination, lamports: Number(p.info.lamports ?? 0), blockTime: s.blockTime ?? 0 });
      }
    }
  }
  return out;
}

const app = createApp({
  allowlist: ALLOWLIST,
  minMatches: Number(process.env.MIN_MATCHES || 1),
  vaultLamports: BigInt(process.env.VAULT_LAMPORTS || "0"),
  budgetBps: Number(process.env.BUDGET_BPS || 1000),
  isEligible: (w) => (MINT ? isHoldEligible(reader, w, MINT, MIN_TOKENS) : Promise.resolve(true)),
  poolReader: async () => ({ vaultAddress: POOL.toBase58(), lamports: await conn.getBalance(POOL) }),
  payoutsReader: readPayouts,
  store,
});

serve({ fetch: app.fetch, port: PORT });
console.log(`reward-backend API on http://localhost:${PORT}`);
