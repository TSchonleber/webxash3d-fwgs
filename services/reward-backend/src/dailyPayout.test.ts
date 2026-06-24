import { describe, it, expect } from "vitest";
import { computeScoreWeightedAwards } from "./payout";
import { settleDay } from "./settle";
import type { MatchResult } from "./types";
import { PublicKey } from "@solana/web3.js";

const W = (i: number) => new PublicKey(Buffer.alloc(32, i + 1)).toBase58();

const match = (id: string, end: number, winners: number[], losers: number[]): MatchResult => ({
  matchId: id,
  endedAtMs: end,
  players: [
    ...winners.map((i) => ({ wallet: W(i), team: "A" as const, won: true, kills: 15, deaths: 5, headshots: 3, shotsFired: 150, shotsHit: 60, avgReactionMs: 250 })),
    ...losers.map((i) => ({ wallet: W(i), team: "B" as const, won: false, kills: 6, deaths: 12, headshots: 1, shotsFired: 150, shotsHit: 55, avgReactionMs: 280 })),
  ],
});

describe("computeScoreWeightedAwards", () => {
  it("splits the pool in proportion to each player's score, full pool distributed", () => {
    const { awards, pool } = computeScoreWeightedAwards(
      [{ wallet: "A", score: 30 }, { wallet: "B", score: 10 }],
      { vaultLamports: 1_000_000_000n, budgetBps: 10_000 },
    );
    expect(pool).toBe(1_000_000_000n);
    expect(awards.find((x) => x.wallet === "A")!.amount).toBe(750_000_000n); // 30/40
    expect(awards.find((x) => x.wallet === "B")!.amount).toBe(250_000_000n); // 10/40
    expect(awards.reduce((s, a) => s + a.amount, 0n)).toBe(pool); // exact, no leakage
  });

  it("a higher score never earns less than a lower score", () => {
    const { awards } = computeScoreWeightedAwards(
      [{ wallet: "A", score: 50 }, { wallet: "B", score: 30 }, { wallet: "C", score: 20 }],
      { vaultLamports: 1_000_000_000n, budgetBps: 1000 },
    );
    for (let i = 1; i < awards.length; i++) expect(awards[i - 1].amount >= awards[i].amount).toBe(true);
  });

  it("handles 1-decimal scores exactly and an empty board", () => {
    const { awards } = computeScoreWeightedAwards(
      [{ wallet: "A", score: 15.5 }, { wallet: "B", score: 4.5 }],
      { vaultLamports: 1_000_000_000n, budgetBps: 10_000 },
    );
    expect(awards.reduce((s, a) => s + a.amount, 0n)).toBe(1_000_000_000n); // 155+45 weights
    expect(computeScoreWeightedAwards([], { vaultLamports: 1n, budgetBps: 10_000 }).awards).toHaveLength(0);
  });
});

describe("settleDay", () => {
  it("settles the daily top-10 score-weighted, descending amounts, full pool, proofs for each", async () => {
    const matches = [
      match("m1", 0, [0], [1, 2]),
      match("m2", 1000, [0], [1, 2]),
      match("m3", 2000, [1], [2]),
    ];
    const out = await settleDay(matches, {
      vaultLamports: 1_000_000_000n,
      budgetBps: 10_000,
      minMatches: 1,
      isEligible: async () => true,
    });
    expect(out.awards.length).toBeGreaterThan(0);
    expect(out.awards.length).toBeLessThanOrEqual(10);
    // awards come in rank (score-desc) order → amounts non-increasing
    for (let i = 1; i < out.awards.length; i++) expect(out.awards[i - 1].amount >= out.awards[i].amount).toBe(true);
    expect(out.awards.reduce((s, a) => s + a.amount, 0n)).toBe(out.totalAmount);
    for (const a of out.awards) expect(out.proofsByWallet[a.wallet]).toBeDefined();
  });

  it("drops hold-ineligible players before paying", async () => {
    const matches = [match("m1", 0, [0], [1, 2]), match("m2", 1000, [0], [1, 2])];
    const out = await settleDay(matches, {
      vaultLamports: 1_000_000_000n,
      budgetBps: 10_000,
      minMatches: 1,
      isEligible: async (w) => w !== W(0), // exclude the top scorer
    });
    expect(out.awards.find((a) => a.wallet === W(0))).toBeUndefined();
  });
});
