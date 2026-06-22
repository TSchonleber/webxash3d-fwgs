import { describe, it, expect } from "vitest";
import { settleHour } from "./settle";
import type { MatchResult } from "./types";
import { PublicKey } from "@solana/web3.js";

const W = (i: number) => new PublicKey(Buffer.alloc(32, i + 1)).toBase58();
const match = (id: string, end: number, winners: number[], losers: number[]): MatchResult => ({
  matchId: id, endedAtMs: end,
  players: [
    ...winners.map((i) => ({ wallet: W(i), team: "A" as const, won: true, kills: 15, deaths: 5, headshots: 3, shotsFired: 150, shotsHit: 60, avgReactionMs: 250 })),
    ...losers.map((i) => ({ wallet: W(i), team: "B" as const, won: false, kills: 6, deaths: 12, headshots: 1, shotsFired: 150, shotsHit: 55, avgReactionMs: 280 })),
  ],
});

describe("settleHour", () => {
  it("ranks, gates, splits, and builds a coherent root", async () => {
    const matches = [match("m1", 0, [0, 1, 2, 3, 4], [5, 6, 7, 8, 9])];
    const out = await settleHour(matches, {
      vaultLamports: 1_000_000_000n,
      budgetBps: 1000,
      minMatches: 1,
      isEligible: async () => true,
    });
    expect(out.awards.length).toBeGreaterThan(0);
    expect(out.awards.length).toBeLessThanOrEqual(10);
    const sum = out.awards.reduce((s, a) => s + a.amount, 0n);
    expect(sum).toBe(out.totalAmount);
    // every award has a proof
    for (const a of out.awards) expect(out.proofsByWallet[a.wallet]).toBeDefined();
  });

  it("drops hold-ineligible winners before paying", async () => {
    const matches = [match("m1", 0, [0, 1, 2, 3, 4], [5, 6, 7, 8, 9])];
    const out = await settleHour(matches, {
      vaultLamports: 1_000_000_000n, budgetBps: 1000, minMatches: 1,
      isEligible: async (w) => w !== W(0), // top winner ineligible
    });
    expect(out.awards.find((a) => a.wallet === W(0))).toBeUndefined();
  });
});
