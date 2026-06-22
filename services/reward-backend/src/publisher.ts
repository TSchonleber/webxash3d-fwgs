import BN from "bn.js";
import type { Settlement } from "./settle";

// Minimal structural type of the Anchor program method chain we use (keeps this unit-testable).
export interface PublishProgram {
  methods: {
    publishPeriod(periodId: BN, root: number[], total: BN): {
      accounts(a: { oracle: unknown }): {
        signers(s: unknown[]): { rpc(): Promise<string> };
      };
    };
  };
}

export interface OracleSigner { publicKey: unknown; }

export async function publishSettlement(
  program: PublishProgram,
  oracle: OracleSigner,
  s: Settlement
): Promise<string> {
  return program.methods
    .publishPeriod(new BN(s.periodId), [...s.root], new BN(s.totalAmount.toString()))
    .accounts({ oracle: oracle.publicKey })
    .signers([oracle])
    .rpc();
}

export interface ClaimArgs { periodId: BN; index: BN; amount: BN; proof: number[][]; }

export function buildClaimArgs(s: Settlement, wallet: string): ClaimArgs {
  const award = s.awards.find((a) => a.wallet === wallet);
  if (!award) throw new Error(`not a winner: ${wallet}`);
  return {
    periodId: new BN(s.periodId),
    index: new BN(award.index),
    amount: new BN(award.amount.toString()),
    proof: s.proofsByWallet[wallet].map((b) => [...b]),
  };
}
