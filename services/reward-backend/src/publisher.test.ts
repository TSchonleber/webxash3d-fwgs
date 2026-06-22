import { describe, it, expect } from "vitest";
import BN from "bn.js";
import { publishSettlement, buildClaimArgs } from "./publisher";
import type { Settlement } from "./settle";

const settlement: Settlement = {
  periodId: 42,
  root: Buffer.alloc(32, 7),
  totalAmount: 900_000_000n,
  awards: [
    { index: 0, wallet: "Wa", amount: 500_000_000n },
    { index: 1, wallet: "Wb", amount: 400_000_000n },
  ],
  proofsByWallet: { Wa: [Buffer.alloc(32, 1)], Wb: [Buffer.alloc(32, 2)] },
};

describe("publisher", () => {
  it("calls publishPeriod with periodId BN, root as byte array, total BN, signed by oracle", async () => {
    const calls: any = {};
    const program = {
      methods: {
        publishPeriod(periodId: BN, root: number[], total: BN) {
          calls.periodId = periodId; calls.root = root; calls.total = total;
          return { accounts(a: any) { calls.accounts = a; return { signers(s: any[]) { calls.signers = s; return { rpc: async () => "sig123" }; } }; } };
        },
      },
    };
    const oracle = { publicKey: "ORACLE_PK" };
    const sig = await publishSettlement(program as any, oracle as any, settlement);
    expect(sig).toBe("sig123");
    expect(calls.periodId.toNumber()).toBe(42);
    expect(calls.root).toHaveLength(32);
    expect(calls.root[0]).toBe(7);
    expect(calls.total.toString()).toBe("900000000");
    expect(calls.accounts.oracle).toBe("ORACLE_PK");
    expect(calls.signers[0]).toBe(oracle);
  });

  it("builds claim args for a winner (index, amount, proof as byte arrays)", () => {
    const args = buildClaimArgs(settlement, "Wb");
    expect(args.index.toNumber()).toBe(1);
    expect(args.amount.toString()).toBe("400000000");
    expect(args.proof[0]).toHaveLength(32);
    expect(args.proof[0][0]).toBe(2);
  });

  it("throws for a non-winner", () => {
    expect(() => buildClaimArgs(settlement, "nobody")).toThrow();
  });
});
