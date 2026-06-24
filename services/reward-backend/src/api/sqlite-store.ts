import { createRequire } from "node:module";
import type { MatchResult, Award } from "../types";
import type { Settlement } from "../settle";
import type { MatchStoreApi } from "./store";
import { utcHourBucket, WINDOW_MS } from "../period";

// Loaded via createRequire (not a static import) so bundlers/vitest don't try to
// pre-resolve node:sqlite, which is newer than their builtin module lists.
interface SqliteStatement {
  run(...params: unknown[]): unknown;
  get(...params: unknown[]): unknown;
  all(...params: unknown[]): unknown[];
}
interface SqliteDatabase {
  exec(sql: string): void;
  prepare(sql: string): SqliteStatement;
  close(): void;
}
type DatabaseSyncCtor = new (path: string) => SqliteDatabase;
const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite") as {
  DatabaseSync: DatabaseSyncCtor;
};

/**
 * Disk-backed MatchStore so the leaderboard and settlements survive a backend
 * restart. Same surface as the in-memory MatchStore (addMatch / matchesForHour /
 * saveSettlement / getSettlement) — wire this one in production and keep the
 * in-memory store for unit tests.
 *
 * Uses Node's built-in node:sqlite (no native dependency to compile). Settlements
 * carry Buffers and bigints, neither of which is JSON-native, so they are encoded
 * to hex / decimal strings on the way in and rebuilt on the way out.
 */
export class SqliteMatchStore implements MatchStoreApi {
  private db: SqliteDatabase;

  constructor(path = ":memory:") {
    this.db = new DatabaseSync(path);
    this.db.exec("PRAGMA journal_mode = WAL");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS matches (
        hour        INTEGER NOT NULL,
        match_id    TEXT    NOT NULL,
        ended_at_ms INTEGER NOT NULL,
        json        TEXT    NOT NULL,
        PRIMARY KEY (hour, match_id)
      );
      CREATE INDEX IF NOT EXISTS idx_matches_hour ON matches (hour);
      CREATE TABLE IF NOT EXISTS settlements (
        hour INTEGER PRIMARY KEY,
        json TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS registrations (
        name   TEXT PRIMARY KEY,
        wallet TEXT NOT NULL
      );
    `);
  }

  registerName(name: string, wallet: string): void {
    this.db
      .prepare(
        `INSERT INTO registrations (name, wallet) VALUES (?, ?)
         ON CONFLICT(name) DO UPDATE SET wallet = excluded.wallet`
      )
      .run(name, wallet);
  }

  resolveName(name: string): string | undefined {
    const row = this.db
      .prepare(`SELECT wallet FROM registrations WHERE name = ?`)
      .get(name) as { wallet: string } | undefined;
    return row?.wallet;
  }

  addMatch(r: MatchResult): void {
    const hour = utcHourBucket(r.endedAtMs);
    // Upsert by (hour, matchId): persistent servers post a live cumulative
    // snapshot for the same matchId every few seconds; the latest replaces it.
    this.db
      .prepare(
        `INSERT INTO matches (hour, match_id, ended_at_ms, json) VALUES (?, ?, ?, ?)
         ON CONFLICT(hour, match_id) DO UPDATE SET
           ended_at_ms = excluded.ended_at_ms,
           json        = excluded.json`
      )
      .run(hour, r.matchId, r.endedAtMs, JSON.stringify(r));
  }

  matchesForHour(hour: number): MatchResult[] {
    const rows = this.db
      .prepare(`SELECT json FROM matches WHERE hour = ? ORDER BY ended_at_ms, match_id`)
      .all(hour) as { json: string }[];
    return rows.map((row) => JSON.parse(row.json) as MatchResult);
  }

  matchesForWindow(day: number): MatchResult[] {
    const start = day * WINDOW_MS;
    const end = start + WINDOW_MS;
    const rows = this.db
      .prepare(`SELECT json FROM matches WHERE ended_at_ms >= ? AND ended_at_ms < ? ORDER BY ended_at_ms, match_id`)
      .all(start, end) as { json: string }[];
    return rows.map((row) => JSON.parse(row.json) as MatchResult);
  }

  saveSettlement(hour: number, s: Settlement): void {
    this.db
      .prepare(
        `INSERT INTO settlements (hour, json) VALUES (?, ?)
         ON CONFLICT(hour) DO UPDATE SET json = excluded.json`
      )
      .run(hour, serializeSettlement(s));
  }

  getSettlement(hour: number): Settlement | undefined {
    const row = this.db
      .prepare(`SELECT json FROM settlements WHERE hour = ?`)
      .get(hour) as { json: string } | undefined;
    return row ? deserializeSettlement(row.json) : undefined;
  }

  close(): void {
    this.db.close();
  }
}

function serializeSettlement(s: Settlement): string {
  return JSON.stringify({
    periodId: s.periodId,
    root: s.root.toString("hex"),
    totalAmount: s.totalAmount.toString(),
    awards: s.awards.map((a) => ({ index: a.index, wallet: a.wallet, amount: a.amount.toString() })),
    proofsByWallet: Object.fromEntries(
      Object.entries(s.proofsByWallet).map(([w, proofs]) => [w, proofs.map((b) => b.toString("hex"))])
    ),
  });
}

function deserializeSettlement(json: string): Settlement {
  const o = JSON.parse(json) as {
    periodId: number;
    root: string;
    totalAmount: string;
    awards: { index: number; wallet: string; amount: string }[];
    proofsByWallet: Record<string, string[]>;
  };
  const awards: Award[] = o.awards.map((a) => ({ index: a.index, wallet: a.wallet, amount: BigInt(a.amount) }));
  const proofsByWallet: Record<string, Buffer[]> = Object.fromEntries(
    Object.entries(o.proofsByWallet).map(([w, proofs]) => [w, proofs.map((h) => Buffer.from(h, "hex"))])
  );
  return { periodId: o.periodId, root: Buffer.from(o.root, "hex"), totalAmount: BigInt(o.totalAmount), awards, proofsByWallet };
}
