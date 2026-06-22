import { describe, it, expect } from "vitest";
import { screenPlayer } from "./anticheat";
import type { MatchPlayer } from "./types";

const base: MatchPlayer = {
  wallet: "w", team: "A", won: true, kills: 20, deaths: 10,
  headshots: 5, shotsFired: 200, shotsHit: 80, avgReactionMs: 300,
};

describe("screenPlayer", () => {
  it("passes a normal stat line", () => {
    expect(screenPlayer(base).suspicious).toBe(false);
  });
  it("flags impossible accuracy", () => {
    const r = screenPlayer({ ...base, shotsFired: 100, shotsHit: 99 });
    expect(r.suspicious).toBe(true);
    expect(r.reasons).toContain("accuracy");
  });
  it("flags inhuman reaction time", () => {
    expect(screenPlayer({ ...base, avgReactionMs: 40 }).reasons).toContain("reaction");
  });
  it("flags headshot-only kills", () => {
    expect(screenPlayer({ ...base, kills: 10, headshots: 10 }).reasons).toContain("headshot_ratio");
  });
});
