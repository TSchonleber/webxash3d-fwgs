import BN from "bn.js";
import type { ClaimData } from "./api";

export interface ClaimProgram {
  methods: {
    claim(periodId: BN, index: BN, amount: BN, proof: number[][]): {
      accounts(a: { claimant: unknown }): { rpc(): Promise<string> };
    };
  };
}

const hexToBytes = (h: string): number[] => {
  const out: number[] = [];
  for (let i = 0; i < h.length; i += 2) out.push(parseInt(h.slice(i, i + 2), 16));
  return out;
};

export async function submitClaim(program: ClaimProgram, claimant: unknown, data: ClaimData): Promise<string> {
  return program.methods
    .claim(new BN(data.periodId), new BN(data.index), new BN(data.amount), data.proof.map(hexToBytes))
    .accounts({ claimant })
    .rpc();
}
