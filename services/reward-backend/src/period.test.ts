import { describe, it, expect } from "vitest";
import { utcHourBucket } from "./period";

describe("utcHourBucket (30-min periods)", () => {
  it("maps a timestamp to its 30-minute period index", () => {
    expect(utcHourBucket(2 * 1_800_000 + 10 * 60_000)).toBe(2);
  });
  it("is stable within a period and increments across the boundary", () => {
    const base = 100 * 1_800_000;
    expect(utcHourBucket(base)).toBe(100);
    expect(utcHourBucket(base + 1_799_999)).toBe(100);
    expect(utcHourBucket(base + 1_800_000)).toBe(101);
  });
});
