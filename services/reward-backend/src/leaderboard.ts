import type { MatchResult, RankedEntry } from "./types";

export interface RankOptions { minMatches: number; }

interface Tally { kills: number; deaths: number; matches: number; }

/**
 * Ranks players for a payout period by KILLS (the primary metric): most kills is
 * rank 1 and earns the largest reward, trickling down the payout scale to rank 7.
 * Ties are broken by fewer deaths, then fewer matches (kill efficiency), then
 * wallet for a fully deterministic order.
 */
export function rankHour(matches: MatchResult[], opts: RankOptions): RankedEntry[] {
  const tallies = new Map<string, Tally>();
  for (const m of matches) {
    for (const p of m.players ?? []) {
      const t = tallies.get(p.wallet) ?? { kills: 0, deaths: 0, matches: 0 };
      t.kills += p.kills;
      t.deaths += p.deaths;
      t.matches += 1;
      tallies.set(p.wallet, t);
    }
  }
  const rows = [...tallies.entries()]
    .filter(([, t]) => t.matches >= opts.minMatches)
    .map(([wallet, t]) => ({ wallet, kills: t.kills, deaths: t.deaths, matches: t.matches }))
    .sort(
      (a, b) =>
        b.kills - a.kills ||
        a.deaths - b.deaths ||
        a.matches - b.matches ||
        a.wallet.localeCompare(b.wallet)
    );
  return rows.map((r, i) => ({ ...r, rank: i + 1 }));
}
