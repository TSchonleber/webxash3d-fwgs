import type { RankedEntry, Award } from "./types";

export const WEIGHTS = [30, 22, 16, 12, 9, 7, 4]; // top 7, sliding scale, sum = 100

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

/**
 * Score-weighted distribution for the daily payout: each player earns the pool in
 * proportion to their skill rating. Scores carry one decimal, so they're scaled to
 * integer weights for exact BigInt math; the rounding remainder goes to the top
 * scorer so the full pool is always distributed.
 */
export function computeScoreWeightedAwards(
  board: { wallet: string; score: number }[],
  cfg: PayoutConfig,
): { awards: Award[]; pool: bigint } {
  const pool = (cfg.vaultLamports * BigInt(cfg.budgetBps)) / 10_000n;
  if (board.length === 0) return { awards: [], pool };
  const weights = board.map((e) => BigInt(Math.max(0, Math.round(e.score * 10))));
  const weightSum = weights.reduce((s, w) => s + w, 0n);
  if (weightSum === 0n || pool === 0n)
    return { awards: board.map((e, i) => ({ index: i, wallet: e.wallet, amount: 0n })), pool };
  const amounts = weights.map((w) => (pool * w) / weightSum);
  amounts[0] += pool - amounts.reduce((s, a) => s + a, 0n); // remainder -> top scorer
  return { awards: board.map((e, i) => ({ index: i, wallet: e.wallet, amount: amounts[i] })), pool };
}
