import type { RankedEntry, Award } from "./types";

export const WEIGHTS = [30, 18, 12, 9, 7, 5, 5, 5, 5, 4]; // sum = 100

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
