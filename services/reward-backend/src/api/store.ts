import type { MatchResult } from "../types";
import type { Settlement } from "../settle";
import { utcHourBucket } from "../period";

/** Shared surface so the in-memory and SQLite stores are interchangeable. */
export interface MatchStoreApi {
  addMatch(r: MatchResult): void;
  matchesForHour(hour: number): MatchResult[];
  /** All matches that ended on the given UTC day (day index = floor(unixMs/86_400_000)). */
  matchesForDay(day: number): MatchResult[];
  saveSettlement(hour: number, s: Settlement): void;
  getSettlement(hour: number): Settlement | undefined;
  /** Bind an in-game callsign to a payout wallet. */
  registerName(name: string, wallet: string): void;
  /** Resolve a callsign to its wallet, or undefined if unregistered. */
  resolveName(name: string): string | undefined;
}

export class MatchStore implements MatchStoreApi {
  private byHour = new Map<number, Map<string, MatchResult>>();
  private settlements = new Map<number, Settlement>();
  private registrations = new Map<string, string>();

  addMatch(r: MatchResult): void {
    const hour = utcHourBucket(r.endedAtMs);
    let bucket = this.byHour.get(hour);
    if (!bucket) { bucket = new Map(); this.byHour.set(hour, bucket); }
    // Upsert by matchId. Persistent (never-ending) servers post a live snapshot
    // for the same period matchId every few seconds; later snapshots carry the
    // cumulative tally and replace the earlier one so the leaderboard tracks live.
    bucket.set(r.matchId, r);
  }

  matchesForHour(hour: number): MatchResult[] {
    return [...(this.byHour.get(hour)?.values() ?? [])];
  }

  matchesForDay(day: number): MatchResult[] {
    const start = day * 86_400_000;
    const end = start + 86_400_000;
    const out: MatchResult[] = [];
    for (const bucket of this.byHour.values())
      for (const m of bucket.values())
        if (m.endedAtMs >= start && m.endedAtMs < end) out.push(m);
    return out;
  }

  saveSettlement(hour: number, s: Settlement): void { this.settlements.set(hour, s); }
  getSettlement(hour: number): Settlement | undefined { return this.settlements.get(hour); }

  registerName(name: string, wallet: string): void { this.registrations.set(name, wallet); }
  resolveName(name: string): string | undefined { return this.registrations.get(name); }
}
