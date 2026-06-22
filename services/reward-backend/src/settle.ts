import type { MatchResult, Award } from "./types";
import { rankHour } from "./leaderboard";
import { computeAwards } from "./payout";
import { screenPlayer } from "./anticheat";
import { buildTree } from "./merkle";

export interface SettleCtx {
  vaultLamports: bigint;
  budgetBps: number;
  minMatches: number;
  isEligible: (wallet: string) => Promise<boolean>;
  periodId?: number;
}

export interface Settlement {
  periodId: number;
  root: Buffer;
  totalAmount: bigint;
  awards: Award[];
  proofsByWallet: Record<string, Buffer[]>;
}

export async function settleHour(matches: MatchResult[], ctx: SettleCtx): Promise<Settlement> {
  // flag wallets that were suspicious in ANY match this hour
  const flagged = new Set<string>();
  for (const m of matches) for (const p of m.players) if (screenPlayer(p).suspicious) flagged.add(p.wallet);

  const board = rankHour(matches, { minMatches: ctx.minMatches }).filter((e) => !flagged.has(e.wallet));

  // hold-eligibility gate (sequential keeps the injected predicate simple/deterministic)
  const eligible = [];
  for (const e of board) if (await ctx.isEligible(e.wallet)) eligible.push(e);

  const reindexed = eligible.slice(0, 10).map((e, i) => ({ ...e, rank: i + 1 }));
  const { awards } = computeAwards(reindexed, { vaultLamports: ctx.vaultLamports, budgetBps: ctx.budgetBps });

  const proofsByWallet: Record<string, Buffer[]> = {};
  let root = Buffer.alloc(32);
  let totalAmount = 0n;
  if (awards.length > 0) {
    const tree = buildTree(awards);
    root = tree.root;
    awards.forEach((a, i) => (proofsByWallet[a.wallet] = tree.proofs[i]));
    totalAmount = awards.reduce((s, a) => s + a.amount, 0n);
  }
  return { periodId: ctx.periodId ?? 0, root, totalAmount, awards, proofsByWallet };
}
