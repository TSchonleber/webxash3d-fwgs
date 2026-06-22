import { serve } from "@hono/node-server";
import { createApp } from "./app";
import { rpcBalanceReader, isHoldEligible } from "../eligibility";
import { Connection } from "@solana/web3.js";

const PORT = Number(process.env.PORT ?? 8787);
const ALLOWLIST = (process.env.OPERATOR_PUBKEYS ?? "").split(",").filter(Boolean);
const MIN_TOKENS = Number(process.env.MIN_TOKENS ?? 1000);
const MINT = process.env.GAME_MINT ?? "";
const RPC = process.env.RPC_URL ?? "https://api.devnet.solana.com";

const reader = rpcBalanceReader(new Connection(RPC));
const app = createApp({
  allowlist: ALLOWLIST,
  minMatches: Number(process.env.MIN_MATCHES ?? 1),
  vaultLamports: BigInt(process.env.VAULT_LAMPORTS ?? "0"),
  budgetBps: Number(process.env.BUDGET_BPS ?? 1000),
  isEligible: (w) => (MINT ? isHoldEligible(reader, w, MINT, MIN_TOKENS) : Promise.resolve(true)),
});

serve({ fetch: app.fetch, port: PORT });
console.log(`reward-backend API on http://localhost:${PORT}`);
