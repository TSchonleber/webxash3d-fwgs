import { describe, it, expect } from "vitest";
import { MatchStore } from "./store";
import type { MatchResult } from "../types";

const m = (id: string, endedAtMs: number): MatchResult => ({ matchId: id, endedAtMs, players: [] });

describe("MatchStore", () => {
  it("buckets matches by UTC hour", () => {
    const s = new MatchStore();
    s.addMatch(m("a", 100 * 3600_000 + 5));
    s.addMatch(m("b", 100 * 3600_000 + 999));
    s.addMatch(m("c", 101 * 3600_000));
    expect(s.matchesForHour(100).map((x) => x.matchId)).toEqual(["a", "b"]);
    expect(s.matchesForHour(101).map((x) => x.matchId)).toEqual(["c"]);
  });
  it("dedupes by matchId within an hour", () => {
    const s = new MatchStore();
    s.addMatch(m("a", 100 * 3600_000));
    s.addMatch(m("a", 100 * 3600_000)); // same id, ignored
    expect(s.matchesForHour(100)).toHaveLength(1);
  });
  it("stores and returns a settlement for an hour", () => {
    const s = new MatchStore();
    const settlement: any = { periodId: 100, root: Buffer.alloc(32), totalAmount: 0n, awards: [], proofsByWallet: {} };
    s.saveSettlement(100, settlement);
    expect(s.getSettlement(100)).toBe(settlement);
    expect(s.getSettlement(999)).toBeUndefined();
  });
});
