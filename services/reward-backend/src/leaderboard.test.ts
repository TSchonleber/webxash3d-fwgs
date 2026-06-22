import { describe, it, expect } from "vitest";
import { rankHour } from "./leaderboard";
import type { MatchResult } from "./types";

const mk = (matchId: string, endedAtMs: number, rows: any[]): MatchResult => ({
  matchId, endedAtMs,
  players: rows.map((r) => ({
    wallet: r.w, team: "A", won: r.won, kills: r.k ?? 0, deaths: r.d ?? 0,
    headshots: r.hs ?? 0, shotsFired: 100, shotsHit: 50, avgReactionMs: 300,
  })),
});

describe("rankHour", () => {
  it("sums match points and ranks descending", () => {
    const matches: MatchResult[] = [
      mk("m1", 0, [{ w: "A", won: true, k: 10, d: 2, hs: 4 }, { w: "B", won: false, k: 5, d: 8 }]),
      mk("m2", 1000, [{ w: "A", won: false, k: 3, d: 5 }, { w: "B", won: true, k: 9, d: 3, hs: 2 }]),
    ];
    // A: (100+100-4+20)=216 + (0+30-10)=20 => 236 ; B: (0+50-16)=34 + (100+90-6+10)=194 => 228
    const board = rankHour(matches, { minMatches: 1 });
    expect(board[0]).toMatchObject({ wallet: "A", rank: 1, points: 236, matches: 2 });
    expect(board[1]).toMatchObject({ wallet: "B", rank: 2, points: 228, matches: 2 });
  });

  it("excludes players below minMatches", () => {
    const matches: MatchResult[] = [ mk("m1", 0, [{ w: "A", won: true, k: 1 }, { w: "B", won: false }]) ];
    const board = rankHour(matches, { minMatches: 2 });
    expect(board).toHaveLength(0);
  });
});
