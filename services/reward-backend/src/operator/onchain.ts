import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Connection, Keypair } from "@solana/web3.js";
import { AnchorProvider, Program, Wallet, BN, type Idl } from "@coral-xyz/anchor";

// Load the distributor IDL via JSON.parse(readFileSync(...)) rather than a JSON
// import-attribute: keeps tsc happy without `resolveJsonModule` and works for an
// IDL that lives outside this package's `include` (../../../../solana/...).
const idlPath = fileURLToPath(new URL("../../../../solana/distributor/target/idl/distributor.json", import.meta.url));
const idl = JSON.parse(readFileSync(idlPath, "utf8")) as Idl;

export function loadKeypair(path: string): Keypair {
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(path, "utf8"))));
}

export interface OnchainConfig { rpcUrl: string; oracleKeypairPath: string; }

// Returns a publish(periodId, rootHex, total) that signs publish_period as the oracle.
export function makePublisher(cfg: OnchainConfig) {
  const connection = new Connection(cfg.rpcUrl, "confirmed");
  const oracle = loadKeypair(cfg.oracleKeypairPath);
  const provider = new AnchorProvider(connection, new Wallet(oracle), { commitment: "confirmed" });
  const program = new Program(idl, provider);

  return async (periodId: number, rootHex: string, total: string): Promise<string> => {
    const root = [...Buffer.from(rootHex, "hex")];
    return program.methods
      .publishPeriod(new BN(periodId), root, new BN(total))
      .accounts({ oracle: oracle.publicKey })
      .signers([oracle])
      .rpc();
  };
}
