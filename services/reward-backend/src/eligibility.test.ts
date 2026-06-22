import { describe, it, expect } from "vitest";
import { isHoldEligible, type BalanceReader } from "./eligibility";

const reader = (uiAmount: number | null): BalanceReader => ({
  async uiBalance() { if (uiAmount === null) throw new Error("rpc down"); return uiAmount; },
});

describe("isHoldEligible", () => {
  it("true when balance >= min", async () => {
    expect(await isHoldEligible(reader(1500), "w", "mint", 1000)).toBe(true);
  });
  it("false when balance below min", async () => {
    expect(await isHoldEligible(reader(999), "w", "mint", 1000)).toBe(false);
  });
  it("fails closed on reader error", async () => {
    expect(await isHoldEligible(reader(null), "w", "mint", 1000)).toBe(false);
  });
});
