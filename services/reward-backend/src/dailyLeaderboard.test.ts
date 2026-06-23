import { describe, it, expect } from "vitest";
import { rankDaily, skillScore } from "./dailyLeaderboard";
import type { MatchResult } from "./types";

const mk = (matchId: string, endedAtMs: number, rows: any[]): MatchResult => ({
  matchId,
  endedAtMs,
  players: rows.map((r) => ({
    wallet: r.w,
    team: "A",
    won: r.won ?? false,
    kills: r.k ?? 0,
    deaths: r.d ?? 0,
    bestStreak: r.streak ?? 0,
    headshots: r.hs ?? 0,
    shotsFired: r.sf ?? 0,
    shotsHit: r.sh ?? 0,
    avgReactionMs: 300,
  })),
});

describe("skillScore", () => {
  it("rewards accuracy — a sharper shooter outscores an equal fragger who sprays", () => {
    const sprayer = skillScore({ kills: 10, deaths: 5, wins: 0, bestStreak: 0, headshots: 0, shotsFired: 100, shotsHit: 20 });
    const sharp = skillScore({ kills: 10, deaths: 5, wins: 0, bestStreak: 0, headshots: 0, shotsFired: 100, shotsHit: 60 });
    expect(sharp).toBeGreaterThan(sprayer);
  });

  it("accuracy term is phase-2 safe — 0 shot data adds nothing and never yields NaN", () => {
    const s = skillScore({ kills: 10, deaths: 0, wins: 0, bestStreak: 0, headshots: 0, shotsFired: 0, shotsHit: 0 });
    expect(s).toBe(10);
  });
});

describe("rankDaily", () => {
  it("exposes per-player accuracy % (shotsHit/shotsFired)", () => {
    const board = rankDaily([mk("m1", 0, [{ w: "A", k: 10, sf: 100, sh: 45 }])]);
    expect(board[0].accuracy).toBe(45);
  });

  it("accuracy is 0 with no shot data (no NaN)", () => {
    const board = rankDaily([mk("m1", 0, [{ w: "A", k: 5 }])]);
    expect(board[0].accuracy).toBe(0);
  });

  it("aggregates shots across a player's matches before computing accuracy", () => {
    const board = rankDaily([
      mk("m1", 0, [{ w: "A", k: 5, sf: 50, sh: 30 }]),
      mk("m2", 1000, [{ w: "A", k: 5, sf: 50, sh: 10 }]),
    ]);
    // 40 hits / 100 fired = 40%, not the mean of the two per-match rates
    expect(board[0].accuracy).toBe(40);
  });
});
