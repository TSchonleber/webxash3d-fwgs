import { describe, it, expect } from "vitest";
import { utcHourBucket } from "./period";

describe("utcHourBucket", () => {
  it("maps a timestamp to its UTC clock-hour index", () => {
    // 1970-01-01T02:30:00Z => hour 2
    expect(utcHourBucket(2 * 3600_000 + 30 * 60_000)).toBe(2);
  });
  it("is stable within an hour and increments across the boundary", () => {
    const base = 100 * 3600_000;
    expect(utcHourBucket(base)).toBe(100);
    expect(utcHourBucket(base + 3599_999)).toBe(100);
    expect(utcHourBucket(base + 3600_000)).toBe(101);
  });
});
