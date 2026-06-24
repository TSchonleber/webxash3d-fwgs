import type { MatchResult } from "./types";
import { WINDOW_MS } from "./period";

/** One row of the reward-window Top-N board. */
export interface DailyEntry {
  wallet: string;
  kills: number;
  deaths: number;
  kd: number;            // kills/deaths (kills if 0 deaths)
  headshots: number;
  hsPct: number;         // headshots/kills %  (0 until the oracle captures HS — phase 2)
  accuracy: number;      // shotsHit/shotsFired %  (0 until the oracle captures shots — phase 2)
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
  shotsFired: number;
  shotsHit: number;
  wins: number;
  matches: number;
  bestStreak: number;
}

// --- Hardcore skill rating (tunable) -----------------------------------------
// Efficiency-weighted: rewards K/D, lobby win-rate and precision over raw volume,
// so a sharp short session can outrank an all-day grind. Caps blunt the main
// exploits (feeder/aimbot K/D, volume grinding); an activity gate (in rankDaily)
// removes flukes. The HS% and accuracy terms read 0 until phase-2 hit logging,
// then light up automatically. Streak is intentionally NOT scored — it's the most
// feedable stat — but is kept as a display-only column.
export const RATING = {
  kdCap: 4, //     K/D contribution maxes here — caps feeder/aimbot ratios
  killCap: 100, // volume credit plateaus here — grinding past it stops helping
  wKd: 0.3, wWin: 0.35, wHs: 0.1, wAcc: 0.1, wVol: 0.15, // weights, sum = 1
  minMatches: 1, minKills: 1, // tournament: count all players in the window (a 1h window = ~1 match/player, so the old minMatches:2 gate dropped everyone who stayed on one server)
};

/** Efficiency-weighted skill rating in [0,100] — the daily ranking metric. */
export function skillScore(
  a: Pick<Agg, "kills" | "deaths" | "wins" | "matches" | "headshots" | "shotsFired" | "shotsHit">,
): number {
  const kd = a.deaths > 0 ? a.kills / a.deaths : a.kills;
  const kdNorm = Math.min(kd, RATING.kdCap) / RATING.kdCap;
  const winRate = a.matches > 0 ? a.wins / a.matches : 0;
  const hsRate = a.kills > 0 ? a.headshots / a.kills : 0;
  const acc = a.shotsFired > 0 ? a.shotsHit / a.shotsFired : 0;
  const volNorm = Math.min(a.kills, RATING.killCap) / RATING.killCap;
  const rating =
    RATING.wKd * kdNorm + RATING.wWin * winRate + RATING.wHs * hsRate +
    RATING.wAcc * acc + RATING.wVol * volNorm;
  return Math.max(0, Math.min(100, 100 * rating));
}

/**
 * Ranks the daily Top-N by efficiency skill rating. A "win" = finishing a match
 * as the top-fragger (most kills, >0). Players below the activity gate
 * (minMatches/minKills) are excluded so flukes and low-volume gaming can't rank.
 * Ties break by kills, then fewer deaths, then wallet. Pure over the day's matches.
 */
export function rankDaily(
  matches: MatchResult[],
  top = 10,
  minMatches = RATING.minMatches,
  minKills = RATING.minKills,
): DailyEntry[] {
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
      const a = agg.get(p.wallet) ?? { kills: 0, deaths: 0, headshots: 0, shotsFired: 0, shotsHit: 0, wins: 0, matches: 0, bestStreak: 0 };
      a.kills += p.kills;
      a.deaths += p.deaths;
      a.headshots += p.headshots ?? 0;
      a.shotsFired += p.shotsFired ?? 0;
      a.shotsHit += p.shotsHit ?? 0;
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
    accuracy: a.shotsFired ? Math.round((100 * a.shotsHit) / a.shotsFired) : 0,
    winPct: a.matches ? Math.round((100 * a.wins) / a.matches) : 0,
    score: Number(skillScore(a).toFixed(1)),
  })).filter((r) => r.matches >= minMatches && r.kills >= minKills);
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
export function utcWindow(unixMs: number): number {
  return Math.floor(unixMs / WINDOW_MS);
}
