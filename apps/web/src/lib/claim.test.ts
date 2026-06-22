import { describe, it, expect } from "vitest";
import BN from "bn.js";
import { submitClaim } from "./claim";
import type { ClaimData } from "./api";

describe("submitClaim", () => {
  it("calls claim with periodId/index/amount BN and proof byte arrays", async () => {
    const calls: any = {};
    const program = { methods: { claim(periodId: BN, index: BN, amount: BN, proof: number[][]) {
      calls.args = { periodId, index, amount, proof };
      return { accounts(a: any) { calls.accounts = a; return { rpc: async () => "sig" }; } };
    } } };
    const data: ClaimData = { periodId: 100, index: 2, amount: "500000000", proof: ["aabb", "ccdd"] };
    const sig = await submitClaim(program as any, "ClaimantPubkey", data);
    expect(sig).toBe("sig");
    expect(calls.args.periodId.toNumber()).toBe(100);
    expect(calls.args.index.toNumber()).toBe(2);
    expect(calls.args.amount.toString()).toBe("500000000");
    expect(calls.args.proof[0]).toEqual([0xaa, 0xbb]);
    expect(calls.accounts.claimant).toBe("ClaimantPubkey");
  });
});
