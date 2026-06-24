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

// skillScore takes a per-day aggregate. Helper to build one tersely.
const agg = (o: Partial<Record<"kills" | "deaths" | "wins" | "matches" | "headshots" | "shotsFired" | "shotsHit", number>>) => ({
  kills: 0, deaths: 0, wins: 0, matches: 1, headshots: 0, shotsFired: 0, shotsHit: 0, ...o,
});

describe("skillScore (efficiency-weighted, hardcore)", () => {
  it("a sharp, winning player outscores a high-volume grinder", () => {
    const sharp = skillScore(agg({ kills: 30, deaths: 5, wins: 2, matches: 3 }));
    const grinder = skillScore(agg({ kills: 200, deaths: 180, wins: 1, matches: 10 }));
    expect(sharp).toBeGreaterThan(grinder);
  });

  it("win-rate is the heaviest lever — topping lobbies beats raw fragging", () => {
    const winner = skillScore(agg({ kills: 50, deaths: 50, wins: 8, matches: 10 }));
    const fragger = skillScore(agg({ kills: 50, deaths: 50, wins: 1, matches: 10 }));
    expect(winner).toBeGreaterThan(fragger);
  });

  it("K/D is capped — a feeder's absurd ratio can't outrun an honest one at the cap", () => {
    const feeder = skillScore(agg({ kills: 100, deaths: 1, wins: 5, matches: 5 })); // K/D 100
    const honest = skillScore(agg({ kills: 100, deaths: 25, wins: 5, matches: 5 })); // K/D 4 (== cap)
    expect(feeder).toBe(honest);
  });

  it("volume is capped — grinding past the cap stops helping", () => {
    const capped = skillScore(agg({ kills: 100, deaths: 50, wins: 3, matches: 6 }));
    const beyond = skillScore(agg({ kills: 400, deaths: 200, wins: 3, matches: 6 })); // same K/D, 4x kills
    expect(beyond).toBe(capped);
  });

  it("rewards precision — headshots + accuracy raise the score (phase 2)", () => {
    const base = skillScore(agg({ kills: 50, deaths: 25, wins: 3, matches: 5, headshots: 0, shotsFired: 100, shotsHit: 20 }));
    const sharp = skillScore(agg({ kills: 50, deaths: 25, wins: 3, matches: 5, headshots: 25, shotsFired: 100, shotsHit: 60 }));
    expect(sharp).toBeGreaterThan(base);
  });

  it("is bounded and finite with degenerate input (0 deaths/shots/matches)", () => {
    const s = skillScore(agg({ kills: 10, deaths: 0, wins: 0, matches: 0, shotsFired: 0, shotsHit: 0 }));
    expect(Number.isFinite(s)).toBe(true);
    expect(s).toBeGreaterThanOrEqual(0);
    expect(s).toBeLessThanOrEqual(100);
  });
});

describe("rankDaily — activity gate + display stats", () => {
  it("excludes players below the activity floor (min matches / min kills)", () => {
    const board = rankDaily([
      mk("m1", 0, [{ w: "QUAL", k: 30, d: 10, won: true }]),
      mk("m2", 1000, [{ w: "QUAL", k: 30, d: 10, won: true }]),
      mk("m3", 2000, [{ w: "LOWKILLS", k: 5, d: 2, won: true }, { w: "QUAL", k: 5, d: 1 }]),
    ]);
    // QUAL: 3 matches, 65 kills -> ranked. LOWKILLS: 1 match, 5 kills -> gated out.
    expect(board.find((e) => e.wallet === "QUAL")).toBeDefined();
    expect(board.find((e) => e.wallet === "LOWKILLS")).toBeUndefined();
  });

  it("still exposes per-player accuracy %, K/D, win% as display stats", () => {
    const board = rankDaily([
      mk("m1", 0, [{ w: "A", k: 40, d: 10, sf: 100, sh: 45, won: true }]),
      mk("m2", 1000, [{ w: "A", k: 40, d: 10, won: true }]),
    ]);
    expect(board[0].accuracy).toBe(45);
    expect(board[0].kd).toBe(4);
    expect(board[0].winPct).toBe(100);
  });
});
