import { describe, it, expect, vi } from "vitest";
import { runSettlement } from "./runSettlement";

describe("runSettlement", () => {
  it("settles, fetches the settlement, and publishes it; returns a summary", async () => {
    const settle = vi.fn().mockResolvedValue({ winners: 10, total: "100000000" });
    const fetchSettlement = vi.fn().mockResolvedValue({
      periodId: 100, rootHex: "ab".repeat(32), total: "100000000",
      awards: [{ index: 0, wallet: "W", amount: "50000000", proofHex: ["cd".repeat(32)] }],
    });
    const publish = vi.fn().mockResolvedValue("txsig123");

    const out = await runSettlement(100, { settle, fetchSettlement, publish });
    expect(settle).toHaveBeenCalledWith(100);
    expect(fetchSettlement).toHaveBeenCalledWith(100);
    expect(publish).toHaveBeenCalledTimes(1);
    const [periodId, rootHex, total] = publish.mock.calls[0];
    expect(periodId).toBe(100);
    expect(rootHex).toBe("ab".repeat(32));
    expect(total).toBe("100000000");
    expect(out).toMatchObject({ periodId: 100, winners: 1, total: "100000000", signature: "txsig123" });
  });

  it("skips publishing when there are no winners", async () => {
    const settle = vi.fn().mockResolvedValue({ winners: 0, total: "0" });
    const fetchSettlement = vi.fn().mockResolvedValue({ periodId: 100, rootHex: "00".repeat(32), total: "0", awards: [] });
    const publish = vi.fn();
    const out = await runSettlement(100, { settle, fetchSettlement, publish });
    expect(publish).not.toHaveBeenCalled();
    expect(out.signature).toBeNull();
  });
});
