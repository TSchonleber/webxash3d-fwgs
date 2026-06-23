import type { MatchResult } from "./types";

/** One row of the daily Top-N board. */
export interface DailyEntry {
  wallet: string;
  kills: number;
  deaths: number;
  kd: number;            // kills/deaths (kills if 0 deaths)
  headshots: number;
  hsPct: number;         // headshots/kills %  (0 until the oracle captures HS — phase 2)
  bestStreak: number;    // longest kills-without-dying streak in the day
  wins: number;          // matches finished top-fragger
  matches: number;
  winPct: number;        // wins/matches %
  score: number;         // weighted skill score (ranking metric)
  rank: number;          // 1-based
}

interface Agg {
  kills: number;
  deaths: number;
  headshots: number;
  wins: number;
  matches: number;
  bestStreak: number;
}

/**
 * Weighted skill score (tunable) — the daily ranking metric. Rewards fragging,
 * winning lobbies, and kill streaks; penalizes dying. The headshot term stays at
 * 0 until the oracle starts capturing headshots (phase 2), at which point it lights
 * up automatically with no further changes here.
 */
export function skillScore(a: Pick<Agg, "kills" | "deaths" | "wins" | "bestStreak" | "headshots">): number {
  return Math.max(0, a.kills + 2 * a.wins + 0.5 * a.bestStreak + 0.5 * a.headshots - 0.5 * a.deaths);
}

/**
 * Ranks the daily Top-N by weighted skill score. A "win" = finishing the match as
 * the top-fragger (most kills, >0). Ties break by kills, then fewer deaths, then
 * wallet for a deterministic order. Pure function over the day's matches.
 */
export function rankDaily(matches: MatchResult[], top = 10): DailyEntry[] {
  const agg = new Map<string, Agg>();
  for (const m of matches) {
    const players = m.players ?? [];
    // Winner of this match = the top-fragger (most kills, and at least one kill).
    let winner: string | null = null;
    let maxKills = 0;
    for (const p of players) {
      if (p.kills > maxKills) { maxKills = p.kills; winner = p.wallet; }
    }
    for (const p of players) {
      const a = agg.get(p.wallet) ?? { kills: 0, deaths: 0, headshots: 0, wins: 0, matches: 0, bestStreak: 0 };
      a.kills += p.kills;
      a.deaths += p.deaths;
      a.headshots += p.headshots ?? 0;
      a.matches += 1;
      a.bestStreak = Math.max(a.bestStreak, p.bestStreak ?? 0);
      if (p.wallet === winner) a.wins += 1;
      agg.set(p.wallet, a);
    }
  }
  const rows = [...agg.entries()].map(([wallet, a]) => ({
    wallet,
    kills: a.kills,
    deaths: a.deaths,
    headshots: a.headshots,
    bestStreak: a.bestStreak,
    wins: a.wins,
    matches: a.matches,
    kd: a.deaths ? Number((a.kills / a.deaths).toFixed(2)) : a.kills,
    hsPct: a.kills ? Math.round((100 * a.headshots) / a.kills) : 0,
    winPct: a.matches ? Math.round((100 * a.wins) / a.matches) : 0,
    score: Number(skillScore(a).toFixed(1)),
  }));
  rows.sort(
    (x, y) =>
      y.score - x.score ||
      y.kills - x.kills ||
      x.deaths - y.deaths ||
      x.wallet.localeCompare(y.wallet)
  );
  return rows.slice(0, top).map((r, i) => ({ ...r, rank: i + 1 }));
}

/** UTC day index for a unix-ms timestamp (matches the /leaderboard/daily bucketing). */
export function utcDay(unixMs: number): number {
  return Math.floor(unixMs / 86_400_000);
}
