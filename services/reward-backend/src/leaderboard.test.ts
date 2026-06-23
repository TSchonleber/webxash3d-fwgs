import { describe, it, expect } from "vitest";
import { rankHour } from "./leaderboard";
import type { MatchResult } from "./types";

const mk = (matchId: string, endedAtMs: number, rows: any[]): MatchResult => ({
  matchId, endedAtMs,
  players: rows.map((r) => ({
    wallet: r.w, team: "A", won: r.won ?? false, kills: r.k ?? 0, deaths: r.d ?? 0,
    headshots: r.hs ?? 0, shotsFired: 100, shotsHit: 50, avgReactionMs: 300,
  })),
});

describe("rankHour", () => {
  it("ranks by total kills descending — most kills is rank 1", () => {
    const matches: MatchResult[] = [
      mk("m1", 0, [{ w: "A", k: 10, d: 2 }, { w: "B", k: 5, d: 8 }]),
      mk("m2", 1000, [{ w: "A", k: 3, d: 5 }, { w: "B", k: 9, d: 3 }]),
    ];
    // A: 13 kills / 7 deaths ; B: 14 kills / 11 deaths => B ranks first (more kills)
    const board = rankHour(matches, { minMatches: 1 });
    expect(board[0]).toMatchObject({ wallet: "B", rank: 1, kills: 14, deaths: 11, matches: 2 });
    expect(board[1]).toMatchObject({ wallet: "A", rank: 2, kills: 13, deaths: 7, matches: 2 });
  });

  it("kills outrank wins — a winner with fewer kills loses to a fragger", () => {
    const matches: MatchResult[] = [
      mk("m1", 0, [{ w: "winner", won: true, k: 4 }, { w: "fragger", won: false, k: 20 }]),
    ];
    const board = rankHour(matches, { minMatches: 1 });
    expect(board[0].wallet).toBe("fragger");
    expect(board[1].wallet).toBe("winner");
  });

  it("breaks kill ties by fewer deaths", () => {
    const matches: MatchResult[] = [
      mk("m1", 0, [{ w: "clean", k: 10, d: 3 }, { w: "trader", k: 10, d: 9 }]),
    ];
    const board = rankHour(matches, { minMatches: 1 });
    expect(board[0].wallet).toBe("clean");
    expect(board[1].wallet).toBe("trader");
  });

  it("breaks kills+deaths ties by fewer matches, then wallet", () => {
    const matches: MatchResult[] = [
      mk("m1", 0, [{ w: "zeta", k: 10, d: 5 }, { w: "alpha", k: 10, d: 5 }]),
      mk("m2", 1000, [{ w: "zeta", k: 0, d: 0 }]),
    ];
    // zeta played 2 matches, alpha 1; both 10k/5d => alpha (fewer matches) ranks first
    const board = rankHour(matches, { minMatches: 1 });
    expect(board[0]).toMatchObject({ wallet: "alpha", matches: 1 });
    expect(board[1]).toMatchObject({ wallet: "zeta", matches: 2 });
  });

  it("excludes players below minMatches", () => {
    const matches: MatchResult[] = [mk("m1", 0, [{ w: "A", k: 5 }, { w: "B", k: 1 }])];
    const board = rankHour(matches, { minMatches: 2 });
    expect(board).toHaveLength(0);
  });
});
