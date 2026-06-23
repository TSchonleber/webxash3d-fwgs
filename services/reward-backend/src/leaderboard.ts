import type { MatchResult, RankedEntry } from "./types";

export interface RankOptions { minMatches: number; }

export function matchPoints(p: { won: boolean; kills: number; deaths: number; headshots: number }): number {
  return Math.max(0, 100 * (p.won ? 1 : 0) + 10 * p.kills - 2 * p.deaths + 5 * p.headshots);
}

export function rankHour(matches: MatchResult[], opts: RankOptions): RankedEntry[] {
  const points = new Map<string, number>();
  const counts = new Map<string, number>();
  for (const m of matches) {
    for (const p of m.players ?? []) {
      points.set(p.wallet, (points.get(p.wallet) ?? 0) + matchPoints(p));
      counts.set(p.wallet, (counts.get(p.wallet) ?? 0) + 1);
    }
  }
  const rows = [...points.entries()]
    .filter(([w]) => (counts.get(w) ?? 0) >= opts.minMatches)
    .map(([wallet, pts]) => ({ wallet, points: pts, matches: counts.get(wallet)! }))
    .sort((a, b) => b.points - a.points || a.matches - b.matches || a.wallet.localeCompare(b.wallet));
  return rows.map((r, i) => ({ ...r, rank: i + 1 }));
}
