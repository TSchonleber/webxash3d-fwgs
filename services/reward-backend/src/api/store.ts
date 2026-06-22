import type { MatchResult } from "../types";
import type { Settlement } from "../settle";
import { utcHourBucket } from "../period";

export class MatchStore {
  private byHour = new Map<number, Map<string, MatchResult>>();
  private settlements = new Map<number, Settlement>();

  addMatch(r: MatchResult): void {
    const hour = utcHourBucket(r.endedAtMs);
    let bucket = this.byHour.get(hour);
    if (!bucket) { bucket = new Map(); this.byHour.set(hour, bucket); }
    if (!bucket.has(r.matchId)) bucket.set(r.matchId, r);
  }

  matchesForHour(hour: number): MatchResult[] {
    return [...(this.byHour.get(hour)?.values() ?? [])];
  }

  saveSettlement(hour: number, s: Settlement): void { this.settlements.set(hour, s); }
  getSettlement(hour: number): Settlement | undefined { return this.settlements.get(hour); }
}
