import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Distributor } from "../target/types/distributor";
import { PublicKey, Keypair } from "@solana/web3.js";
import { assert } from "chai";

describe("distributor", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.Distributor as Program<Distributor>;
  const admin = provider.wallet;

  const configPda = () =>
    PublicKey.findProgramAddressSync([Buffer.from("config")], program.programId)[0];

  it("initializes config with admin and oracle", async () => {
    const oracle = Keypair.generate();
    await program.methods
      .initialize(oracle.publicKey)
      .accounts({ admin: admin.publicKey })
      .rpc();
    const cfg = await program.account.config.fetch(configPda());
    assert.ok(cfg.admin.equals(admin.publicKey));
    assert.ok(cfg.oracle.equals(oracle.publicKey));
  });

  it("lets admin rotate the oracle and rejects non-admin", async () => {
    const newOracle = Keypair.generate();
    await program.methods.setOracle(newOracle.publicKey).accounts({ admin: admin.publicKey }).rpc();
    let cfg = await program.account.config.fetch(configPda());
    assert.ok(cfg.oracle.equals(newOracle.publicKey));

    const stranger = Keypair.generate();
    await provider.connection.confirmTransaction(
      await provider.connection.requestAirdrop(stranger.publicKey, 1e9)
    );
    let failed = false;
    try {
      await program.methods.setOracle(Keypair.generate().publicKey)
        .accounts({ admin: stranger.publicKey }).signers([stranger]).rpc();
    } catch { failed = true; }
    assert.isTrue(failed, "non-admin must not rotate oracle");
  });
});
