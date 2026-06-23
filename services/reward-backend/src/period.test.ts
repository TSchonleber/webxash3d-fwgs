import { describe, it, expect } from "vitest";
import { utcHourBucket, PERIOD_MS } from "./period";

describe("utcHourBucket (payout periods)", () => {
  it("maps a timestamp to its period index", () => {
    expect(utcHourBucket(2 * PERIOD_MS + PERIOD_MS / 3)).toBe(2);
  });
  it("is stable within a period and increments across the boundary", () => {
    const base = 100 * PERIOD_MS;
    expect(utcHourBucket(base)).toBe(100);
    expect(utcHourBucket(base + PERIOD_MS - 1)).toBe(100);
    expect(utcHourBucket(base + PERIOD_MS)).toBe(101);
  });
});
