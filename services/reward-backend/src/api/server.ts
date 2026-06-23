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

const app = createApp({
  allowlist: ALLOWLIST,
  minMatches: Number(process.env.MIN_MATCHES || 1),
  vaultLamports: BigInt(process.env.VAULT_LAMPORTS || "0"),
  budgetBps: Number(process.env.BUDGET_BPS || 1000),
  isEligible: (w) => (MINT ? isHoldEligible(reader, w, MINT, MIN_TOKENS) : Promise.resolve(true)),
  poolReader: async () => ({ vaultAddress: POOL.toBase58(), lamports: await conn.getBalance(POOL) }),
  store,
});

serve({ fetch: app.fetch, port: PORT });
console.log(`reward-backend API on http://localhost:${PORT}`);
