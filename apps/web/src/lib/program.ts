// Builds an anchor Program for the distributor from the vendored IDL.
// Imported lazily (only on claim) so anchor's Buffer usage never runs on the
// main render path. The Privy -> Solana signer wiring is the documented
// follow-up; until then signing throws a clear, actionable error.
import { AnchorProvider, Program } from "@coral-xyz/anchor";
import { Connection, PublicKey, type Transaction, type VersionedTransaction } from "@solana/web3.js";

/** Minimal browser wallet shape anchor needs for Program construction. */
interface BrowserWallet {
  publicKey: PublicKey;
  signTransaction<T extends Transaction | VersionedTransaction>(tx: T): Promise<T>;
  signAllTransactions<T extends Transaction | VersionedTransaction>(txs: T[]): Promise<T[]>;
}
import idl from "../idl/distributor.json";
import type { Distributor } from "../idl/distributor";
import type { ClaimProgram } from "./claim";
import { RPC_URL } from "./config";

const SIGNER_TODO =
  "Wallet signing is not yet wired. Connect a Privy Solana wallet and a signer " +
  "to enable on-chain claims (follow-up).";

/**
 * A wallet shell that satisfies anchor's Wallet interface for Program
 * construction. Real signing is delegated to the Privy wallet in a follow-up;
 * for now the sign methods reject explicitly rather than silently no-op.
 */
function shellWallet(owner: PublicKey): BrowserWallet {
  return {
    publicKey: owner,
    signTransaction<T extends Transaction | VersionedTransaction>(_tx: T): Promise<T> {
      return Promise.reject(new Error(SIGNER_TODO));
    },
    signAllTransactions<T extends Transaction | VersionedTransaction>(_txs: T[]): Promise<T[]> {
      return Promise.reject(new Error(SIGNER_TODO));
    },
  };
}

export async function buildClaimProgram(walletAddress: string): Promise<ClaimProgram> {
  const owner = new PublicKey(walletAddress);
  const connection = new Connection(RPC_URL, "confirmed");
  const provider = new AnchorProvider(connection, shellWallet(owner) as never, {
    commitment: "confirmed",
  });
  const program = new Program<Distributor>(idl as Distributor, provider);
  // The anchor Program's `.methods.claim(...).accounts(...).rpc()` chain matches
  // the structural ClaimProgram type consumed by submitClaim.
  return program as unknown as ClaimProgram;
}
