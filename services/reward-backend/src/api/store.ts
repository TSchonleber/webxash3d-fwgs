import type { MatchResult } from "../types";
import type { Settlement } from "../settle";
import { utcHourBucket } from "../period";

/** Shared surface so the in-memory and SQLite stores are interchangeable. */
export interface MatchStoreApi {
  addMatch(r: MatchResult): void;
  matchesForHour(hour: number): MatchResult[];
  saveSettlement(hour: number, s: Settlement): void;
  getSettlement(hour: number): Settlement | undefined;
}

export class MatchStore implements MatchStoreApi {
  private byHour = new Map<number, Map<string, MatchResult>>();
  private settlements = new Map<number, Settlement>();

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

  saveSettlement(hour: number, s: Settlement): void { this.settlements.set(hour, s); }
  getSettlement(hour: number): Settlement | undefined { return this.settlements.get(hour); }
}
