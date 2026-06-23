import { describe, it, expect, afterEach } from "vitest";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { rmSync } from "node:fs";
import { SqliteMatchStore } from "./sqlite-store";
import type { MatchResult } from "../types";
import type { Settlement } from "../settle";

const HOUR = 100 * 1_800_000; // start of period 100 (30-min buckets)
const mk = (id: string, endedAtMs: number, kills = 0): MatchResult => ({
  matchId: id, endedAtMs,
  players: [{ wallet: "Wallet111", team: "A", won: true, kills, deaths: 1, headshots: 0, shotsFired: 10, shotsHit: 5, avgReactionMs: 300 }],
});

const dbs: SqliteMatchStore[] = [];
const paths: string[] = [];
const tmpPath = () => {
  const p = join(tmpdir(), `cs-lb-test-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
  paths.push(p);
  return p;
};
const open = (p: string) => { const s = new SqliteMatchStore(p); dbs.push(s); return s; };

afterEach(() => {
  for (const s of dbs.splice(0)) try { s.close(); } catch { /* already closed */ }
  for (const p of paths.splice(0)) for (const f of [p, `${p}-wal`, `${p}-shm`]) try { rmSync(f); } catch { /* missing */ }
});

describe("SqliteMatchStore", () => {
  it("persists matches across a backend restart (new instance, same file)", () => {
    const path = tmpPath();
    const s1 = open(path);
    s1.addMatch(mk("m1", HOUR + 5, 12));
    s1.close();

    const s2 = open(path); // simulate process restart
    const matches = s2.matchesForHour(100);
    expect(matches).toHaveLength(1);
    expect(matches[0].matchId).toBe("m1");
    expect(matches[0].players[0].kills).toBe(12);
  });

  it("buckets by 30-minute period and orders within a bucket", () => {
    const s = open(tmpPath());
    s.addMatch(mk("a", HOUR + 5));
    s.addMatch(mk("b", HOUR + 999));
    s.addMatch(mk("c", 101 * 1_800_000));
    expect(s.matchesForHour(100).map((x) => x.matchId)).toEqual(["a", "b"]);
    expect(s.matchesForHour(101).map((x) => x.matchId)).toEqual(["c"]);
  });

  it("upserts a match by id so live cumulative snapshots replace earlier ones", () => {
    const s = open(tmpPath());
    s.addMatch(mk("live", HOUR, 3));
    s.addMatch(mk("live", HOUR, 18)); // later snapshot, higher cumulative kills
    const matches = s.matchesForHour(100);
    expect(matches).toHaveLength(1);
    expect(matches[0].players[0].kills).toBe(18);
  });

  it("round-trips a settlement with bigint amounts and Buffer proofs across restart", () => {
    const path = tmpPath();
    const settlement: Settlement = {
      periodId: 100,
      root: Buffer.from("deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef", "hex"),
      totalAmount: 123456789012345678n,
      awards: [
        { index: 0, wallet: "WinnerAAA", amount: 100000000000000n },
        { index: 1, wallet: "WinnerBBB", amount: 23456789012345678n },
      ],
      proofsByWallet: {
        WinnerAAA: [Buffer.from("aa".repeat(32), "hex"), Buffer.from("bb".repeat(32), "hex")],
        WinnerBBB: [Buffer.from("cc".repeat(32), "hex")],
      },
    };
    const s1 = open(path);
    s1.saveSettlement(100, settlement);
    s1.close();

    const got = open(path).getSettlement(100);
    expect(got).toBeDefined();
    expect(got!.periodId).toBe(100);
    expect(got!.totalAmount).toBe(123456789012345678n);
    expect(Buffer.isBuffer(got!.root)).toBe(true);
    expect(got!.root.equals(settlement.root)).toBe(true);
    expect(got!.awards[1].amount).toBe(23456789012345678n);
    expect(got!.proofsByWallet.WinnerAAA[1].equals(settlement.proofsByWallet.WinnerAAA[1])).toBe(true);
  });

  it("returns undefined for an unsettled period", () => {
    expect(open(tmpPath()).getSettlement(999)).toBeUndefined();
  });
});
