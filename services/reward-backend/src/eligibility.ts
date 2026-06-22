export interface BalanceReader {
  // returns the wallet's UI (decimal-adjusted) balance of the mint
  uiBalance(wallet: string, mint: string): Promise<number>;
}

export async function isHoldEligible(
  reader: BalanceReader,
  wallet: string,
  mint: string,
  minTokens: number
): Promise<boolean> {
  try {
    const bal = await reader.uiBalance(wallet, mint);
    return bal >= minTokens;
  } catch {
    return false; // fail closed
  }
}

// Production adapter (not unit-tested; needs a live RPC). Wire in the API layer (later plan).
import type { Connection } from "@solana/web3.js";
import { PublicKey } from "@solana/web3.js";
export function rpcBalanceReader(connection: Connection): BalanceReader {
  return {
    async uiBalance(wallet: string, mint: string): Promise<number> {
      const res = await connection.getParsedTokenAccountsByOwner(new PublicKey(wallet), {
        mint: new PublicKey(mint),
      });
      let total = 0;
      for (const { account } of res.value) {
        total += (account.data as any).parsed.info.tokenAmount.uiAmount ?? 0;
      }
      return total;
    },
  };
}
