import { describe, it, expect } from "vitest";
import { computeAwards, WEIGHTS } from "./payout";
import type { RankedEntry } from "./types";

const board = (n: number): RankedEntry[] =>
  Array.from({ length: n }, (_, i) => ({ wallet: `w${i}`, kills: 1000 - i, deaths: i, matches: 5, rank: i + 1 }));

describe("computeAwards", () => {
  it("splits a 10% pool across top 7 by weight, remainder to rank 1, sum == pool", () => {
    const vault = 1_000_000_000n; // 1 SOL
    const { awards, pool } = computeAwards(board(12), { vaultLamports: vault, budgetBps: 1000 });
    expect(pool).toBe(100_000_000n); // 0.1 SOL
    expect(awards).toHaveLength(7);
    expect(awards[0].index).toBe(0);
    const sum = awards.reduce((s, a) => s + a.amount, 0n);
    expect(sum).toBe(pool); // exact, no leakage
    // weight ordering: rank1 (incl remainder) >= rank2 >= ... rank10
    for (let i = 1; i < awards.length; i++) expect(awards[i - 1].amount >= awards[i].amount).toBe(true);
  });

  it("pays fewer than 7 when the board is short and never exceeds pool", () => {
    const { awards, pool } = computeAwards(board(3), { vaultLamports: 500_000_000n, budgetBps: 2000 });
    expect(awards).toHaveLength(3);
    const sum = awards.reduce((s, a) => s + a.amount, 0n);
    expect(sum <= pool).toBe(true);
  });

  it("returns no awards for an empty board", () => {
    const { awards } = computeAwards([], { vaultLamports: 1_000_000_000n, budgetBps: 1000 });
    expect(awards).toHaveLength(0);
  });
});
